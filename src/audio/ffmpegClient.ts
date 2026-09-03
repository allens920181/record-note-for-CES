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

interface Silence {
  start: number
  end: number
}

/**
 * Where nobody was speaking, in seconds. Read off the same log lines as the
 * duration and for the same reason: there can be thousands of them in a
 * three-hour lecture, far more than the capped buffer holds.
 */
let silences: Silence[] = []

function noteLine(line: string) {
  const dur = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d+)/.exec(line)
  if (dur) {
    const [, h, m, sec, frac] = dur
    probedDurationSec = Number(h) * 3600 + Number(m) * 60 + Number(sec) + Number(`0.${frac}`)
    return
  }
  // Taken from the end line rather than paired with the start one: the two
  // arrive interleaved with progress output, and end carries both numbers.
  const quiet = /silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/.exec(line)
  if (quiet) {
    const end = Number(quiet[1])
    const length = Number(quiet[2])
    if (Number.isFinite(end) && Number.isFinite(length)) {
      silences.push({ start: Math.max(0, end - length), end })
    }
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

/**
 * A silence long enough to be a pause between sentences rather than the gap
 * between two words. The threshold is in dBFS and deliberately generous: a
 * lecture hall has a noise floor, and a cut point that is merely quiet is no
 * worse than the arbitrary one it replaces.
 */
const SILENCE_FILTER = 'silencedetect=noise=-32dB:d=0.35'

/** How far from the target length a cut may wander to land in a pause. */
const DRIFT = 0.25

/**
 * Where to cut, given where the pauses are.
 *
 * A chunk boundary in the middle of a word damages that word twice — the tail
 * is missing from one request and the head from the next — and it also hands
 * the model a chunk that opens mid-syllable, which is where its worst guessing
 * happens. Landing the cut in a pause costs nothing and removes both.
 *
 * The pause nearest in size, not in position: within the window every candidate
 * is an equally arbitrary place to stop, so the one most likely to be a real
 * breath wins. With no pause to be found the target itself is used, which is
 * exactly the behaviour this replaces.
 */
export function cutPoints(marks: Silence[], durationSec: number, target: number): number[] {
  const points: number[] = []
  const window = target * DRIFT
  let from = 0
  while (durationSec - from > target + window) {
    const want = from + target
    let best: Silence | null = null
    let bestMid = want
    for (const mark of marks) {
      const mid = (Math.max(mark.start, from) + mark.end) / 2
      if (Math.abs(mid - want) > window) continue
      const length = mark.end - Math.max(mark.start, from)
      const bestLength = best ? best.end - Math.max(best.start, from) : 0
      if (length > bestLength || (length === bestLength && Math.abs(mid - want) < Math.abs(bestMid - want))) {
        best = mark
        bestMid = mid
      }
    }
    const at = best ? bestMid : want
    points.push(Number(at.toFixed(3)))
    from = at
  }
  return points
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
      noteLine(message)
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
 * Where each chunk begins in the recording, taken from the muxer's own list.
 *
 * Falls back to the times the cuts were asked for, and then to even spacing:
 * a chunk whose offset is wrong shifts every timestamp in it, which is worse
 * to read than one that is slightly out.
 */
async function readStarts(
  ff: FFmpeg,
  listName: string,
  names: string[],
  points: number[],
): Promise<number[]> {
  const planned = [0, ...points]
  try {
    const csv = await ff.readFile(listName, 'utf8')
    const rows = String(csv)
      .split('\n')
      .map((line) => Number(line.split(',')[1]))
      .filter((n) => Number.isFinite(n))
    if (rows.length === names.length) return rows
  } catch {
    // No list written; the planned times are still close.
  }
  return names.map((_, i) => planned[i] ?? planned[planned.length - 1] ?? 0)
}

/**
 * Turns an uploaded recording into (a) one compact Opus file to play back and
 * (b) chunks small enough for the transcription API's 25 MB limit.
 *
 * The audio is encoded once and the chunks are cut from that encode with
 * `-c copy`, so segmenting costs almost nothing and every chunk's timestamps
 * line up exactly with the file the player is scrubbing.
 *
 * Chunks are contiguous rather than overlapping, and each one ends in a pause
 * where there is a pause to end in — see `cutPoints`. Finding those costs
 * nothing either: `silencedetect` rides along on the encode, which is already
 * decoding every sample, rather than paying for a second pass over the file.
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

  silences = []

  const inputName = `input.${extensionOf(file.name)}`
  const pattern = 'chunk%04d.ogg'
  const listName = 'chunks.csv'
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
      // Analysis only — the filter reports where the pauses are and passes
      // every sample through untouched.
      '-af', SILENCE_FILTER,
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
    const points = cutPoints(silences, durationSec, opts.chunkSeconds)
    const segmentCode = await ff.exec([
      '-i', FULL,
      '-c', 'copy',
      '-f', 'segment',
      // With nothing to cut at, one long segment_time yields the single chunk
      // an empty list could not ask for.
      ...(points.length > 0
        ? ['-segment_times', points.join(',')]
        : ['-segment_time', String(Math.max(opts.chunkSeconds, Math.ceil(durationSec) + 1))]),
      // Where each piece actually starts, rather than where it was asked to.
      // Cuts land on the next Ogg page, so the two differ by a fraction of a
      // second — which is a fraction of a second of drift on every timestamp
      // in the chunk if the requested time is used instead.
      '-segment_list', listName,
      '-segment_list_type', 'csv',
      '-reset_timestamps', '1',
      pattern,
    ])
    if (segmentCode !== 0) throw failure(`音訊切片失敗（代碼 ${segmentCode}）。`)
    written.push(listName)

    stage = 'collecting'
    onProgress({ stage, ratio: 0 })
    const entries = await ff.listDir('/')
    const names = entries
      .filter((e) => !e.isDir && /^chunk\d{4}\.ogg$/.test(e.name))
      .map((e) => e.name)
      .sort()
    written.push(...names)

    if (names.length === 0) throw failure('轉檔沒有產生任何音訊片段。')

    const starts = await readStarts(ff, listName, names, points)

    const chunks: AudioChunk[] = []
    for (let i = 0; i < names.length; i++) {
      chunks.push({
        index: i,
        startSec: starts[i],
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
