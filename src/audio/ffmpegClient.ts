import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

export interface AudioChunk {
  index: number
  /** Offset of this chunk from the start of the recording, in seconds. */
  startSec: number
  blob: Blob
  fileName: string
}

export type PrepareStage = 'loading-core' | 'encoding' | 'segmenting' | 'collecting'

export interface PrepareProgress {
  stage: PrepareStage
  /** 0..1 within the current stage; -1 when the stage has no measurable progress. */
  ratio: number
}

export interface PrepareResult {
  /** One compact Opus file covering the whole recording — what the player uses. */
  playback: Blob
  chunks: AudioChunk[]
  durationSec: number
}

const CORE_BASE = `${import.meta.env.BASE_URL}ffmpeg/`
const FULL = 'full.ogg'

/** If the core never reports back, fail loudly instead of spinning for ever. */
const LOAD_TIMEOUT_MS = 120_000

let instance: FFmpeg | null = null
let loading: Promise<FFmpeg> | null = null
let logBuffer: string[] = []

// Duration is captured as the lines stream past rather than scanned for
// afterwards: the buffer is capped, and a three-hour transcode emits enough
// progress lines to push the header's "Duration:" out of it.
let probedDurationSec = 0
let lastEncodedSec = 0

function noteDuration(line: string) {
  const dur = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d+)/.exec(line)
  if (dur) {
    const [, h, m, sec, frac] = dur
    probedDurationSec = Number(h) * 3600 + Number(m) * 60 + Number(sec) + Number(`0.${frac}`)
    return
  }
  // Streaming WebM from MediaRecorder carries no duration in its header, so
  // fall back to how far the encoder actually got.
  const t = /\btime=\s*(\d+):(\d{2}):(\d{2})\.(\d+)/.exec(line)
  if (t) {
    const [, h, m, sec, frac] = t
    lastEncodedSec = Number(h) * 3600 + Number(m) * 60 + Number(sec) + Number(`0.${frac}`)
  }
}

function absolute(path: string): string {
  return new URL(path, location.href).href
}

async function getFFmpeg(onProgress?: (p: PrepareProgress) => void): Promise<FFmpeg> {
  if (instance) return instance
  if (loading) return loading

  onProgress?.({ stage: 'loading-core', ratio: -1 })
  loading = (async () => {
    const ff = new FFmpeg()
    ff.on('log', ({ message }) => {
      noteDuration(message)
      logBuffer.push(message)
      // Keep the buffer bounded — a long transcode emits thousands of lines.
      if (logBuffer.length > 400) logBuffer.splice(0, logBuffer.length - 400)
    })
    // No classWorkerURL: @ffmpeg/ffmpeg starts its worker with
    // `new Worker(new URL('./worker.js', import.meta.url))`, which Vite bundles
    // correctly on its own. Pointing classWorkerURL at `@ffmpeg/ffmpeg/worker?url`
    // instead ships the *unbundled* source, whose relative imports (./const.js)
    // resolve to nothing under assets/ — the worker then dies silently and load()
    // hangs. Dev needed that workaround only until optimizeDeps.exclude was set.
    await ff.load(
      {
        coreURL: absolute(`${CORE_BASE}ffmpeg-core.js`),
        wasmURL: absolute(`${CORE_BASE}ffmpeg-core.wasm`),
      },
      { signal: AbortSignal.timeout(LOAD_TIMEOUT_MS) },
    )
    instance = ff
    return ff
  })()

  try {
    return await loading
  } catch (err) {
    loading = null
    throw new Error(
      `音訊處理引擎載入失敗：${err instanceof Error ? err.message : String(err)}。請重新整理再試一次。`,
    )
  }
}

function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name)
  return m ? m[1].toLowerCase() : 'bin'
}

function toBlob(data: string | Uint8Array, type: string): Blob {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return new Blob([bytes as BlobPart], { type })
}

function failure(what: string): Error {
  return new Error(`${what}\n\nffmpeg 最後的訊息：\n${logBuffer.slice(-12).join('\n')}`)
}

/**
 * Turns an uploaded recording into (a) one compact Opus file to play back and
 * (b) chunks small enough for the transcription API's 25 MB limit.
 *
 * The audio is encoded once and the chunks are cut from that encode with
 * `-c copy`, so segmenting costs almost nothing and every chunk's timestamps
 * line up exactly with the file the player is scrubbing.
 *
 * Chunks are contiguous rather than overlapping: chunk k starts at exactly
 * k * chunkSeconds. The tradeoff is that a word spoken across a cut can be
 * clipped — a handful of words in a three-hour lecture.
 */
export async function prepareChunks(
  file: File,
  opts: { bitrateKbps: number; chunkSeconds: number },
  onProgress: (p: PrepareProgress) => void,
): Promise<PrepareResult> {
  const ff = await getFFmpeg(onProgress)
  logBuffer = []
  probedDurationSec = 0
  lastEncodedSec = 0

  const inputName = `input.${extensionOf(file.name)}`
  const pattern = 'chunk%04d.ogg'
  const written: string[] = []

  let stage: PrepareStage = 'encoding'
  const onFfProgress = ({ progress }: { progress: number }) => {
    onProgress({ stage, ratio: Math.min(1, Math.max(0, progress)) })
  }
  ff.on('progress', onFfProgress)

  try {
    await ff.writeFile(inputName, await fetchFile(file))
    written.push(inputName)

    // Pass 1 — encode to mono 16 kHz Opus. Speech gains nothing from stereo,
    // and Whisper resamples to 16 kHz regardless.
    stage = 'encoding'
    onProgress({ stage, ratio: 0 })
    const encodeCode = await ff.exec([
      '-i', inputName,
      '-vn', // phone recordings are sometimes .mp4 with a video track
      '-ac', '1',
      '-ar', '16000',
      '-c:a', 'libopus',
      '-b:a', `${opts.bitrateKbps}k`,
      FULL,
    ])
    if (encodeCode !== 0) throw failure(`音訊轉檔失敗（代碼 ${encodeCode}）。`)
    written.push(FULL)

    const durationSec = probedDurationSec || lastEncodedSec
    const playback = toBlob(await ff.readFile(FULL), 'audio/ogg')

    // Pass 2 — cut the encoded file into pieces without re-encoding.
    stage = 'segmenting'
    onProgress({ stage, ratio: 0 })
    const segmentCode = await ff.exec([
      '-i', FULL,
      '-c', 'copy',
      '-f', 'segment',
      '-segment_time', String(opts.chunkSeconds),
      '-reset_timestamps', '1',
      pattern,
    ])
    if (segmentCode !== 0) throw failure(`音訊切片失敗（代碼 ${segmentCode}）。`)

    stage = 'collecting'
    onProgress({ stage, ratio: 0 })
    const entries = await ff.listDir('/')
    const names = entries
      .filter((e) => !e.isDir && /^chunk\d{4}\.ogg$/.test(e.name))
      .map((e) => e.name)
      .sort()
    written.push(...names)

    if (names.length === 0) throw failure('轉檔沒有產生任何音訊片段。')

    const chunks: AudioChunk[] = []
    for (let i = 0; i < names.length; i++) {
      chunks.push({
        index: i,
        startSec: i * opts.chunkSeconds,
        blob: toBlob(await ff.readFile(names[i]), 'audio/ogg'),
        fileName: names[i],
      })
      onProgress({ stage, ratio: (i + 1) / names.length })
    }

    return { playback, chunks, durationSec }
  } finally {
    ff.off('progress', onFfProgress)
    // Free the wasm heap — a lecture leaves tens of megabytes behind.
    for (const name of written) await ff.deleteFile(name).catch(() => {})
  }
}
