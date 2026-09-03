import { db, deleteRecording, getSettings, quotaState, recordUsage } from '../db'
import type { Course, TranscriptSegment } from '../db/schema'
import { newId } from '../lib/id'
import { prepareChunks } from '../audio/ffmpegClient'
import type { PrepareProgress } from '../audio/ffmpegClient'
import { writeFile } from '../storage/fsRoot'
import { SttError, transcribeChunk } from './groq'
import type { SttConfig } from './groq'
import { toTraditional } from './traditional'
import { buildPrompt, stripPromptEcho } from './prompt'

/** 10 minutes at 32 kbps is ~2.4 MB — far under the 25 MB API limit. */
export const CHUNK_SECONDS = 600

/** Groq's free tier allows 20 requests/minute; leave headroom. */
const MIN_REQUEST_SPACING_MS = 3_200
const MAX_ATTEMPTS = 4

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('已取消', 'AbortError'))
      },
      { once: true },
    )
  })

async function withRetry<T>(
  run: () => Promise<T>,
  onWait: (ms: number, attempt: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await run()
    } catch (err) {
      if (signal?.aborted) throw err
      lastError = err
      const retryable = err instanceof SttError ? err.retryable : false
      if (!retryable || attempt === MAX_ATTEMPTS) throw err
      const hinted = (err as SttError & { retryAfterMs?: number }).retryAfterMs
      const backoff = hinted ?? 2_000 * 2 ** (attempt - 1)
      onWait(backoff, attempt)
      await sleep(backoff, signal)
    }
  }
  throw lastError
}

/**
 * The clip's length, read from the browser's own demuxer before any work is
 * done. Cheap enough to ask before downloading a 32 MB engine and encoding the
 * whole file — which is what the quota question used to cost, so answering "no"
 * meant the waiting had already happened.
 */
function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    const done = (value: number | null) => {
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = setTimeout(() => done(null), 8_000)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      clearTimeout(timer)
      done(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null)
    }
    audio.onerror = () => {
      clearTimeout(timer)
      done(null)
    }
    audio.src = url
  })
}

export interface RunProgress {
  stage: string
  done: number
  total: number
}

export interface QuotaWarning {
  /** Seconds of audio this job will send. */
  needSeconds: number
  remainingTodaySeconds: number
  remainingThisHourSeconds: number
}

/**
 * Full path from an uploaded file to a stored transcript: encode, cut,
 * transcribe each piece in turn, then stitch the timings back together.
 *
 * Chunks go out one at a time rather than in parallel. The free tier caps
 * requests per minute, and Groq transcribes an hour of audio in seconds, so
 * spacing them costs little and keeps us inside the limit.
 */
export async function runTranscription(
  sessionId: string,
  file: File,
  onProgress: (p: RunProgress) => void,
  signal?: AbortSignal,
  /** Asked once, before any work is done, if this job would exceed the free tier. */
  confirmOverQuota?: (w: QuotaWarning) => Promise<boolean>,
  /** Recording this run supersedes; removed once the new one is stored. */
  replaces?: string,
): Promise<string> {
  const settings = await getSettings()
  if (!settings.sttApiKey) {
    throw new Error('還沒設定轉錄用的 API key，請先到「設定」填入。')
  }

  const session = await db.sessions.get(sessionId)
  if (!session) throw new Error('找不到這個週次')
  const course: Course | undefined = await db.courses.get(session.courseId)

  const recordingId = newId('rec')
  const jobId = newId('job')
  const now = Date.now()

  await db.jobs.put({
    id: jobId,
    recordingId,
    sessionId,
    status: 'preparing',
    stage: '準備中',
    totalChunks: 0,
    doneChunks: 0,
    createdAt: now,
    updatedAt: now,
  })

  const setJob = (patch: Parameters<typeof db.jobs.update>[1]) =>
    db.jobs.update(jobId, { ...patch, updatedAt: Date.now() })

  try {
    // ── 0. ask about the quota before spending anything ────────────────
    // Only skipped when the browser cannot read the length, in which case the
    // same question is asked after encoding rather than not at all.
    let asked = false
    if (confirmOverQuota) {
      const probed = await probeDuration(file)
      if (probed !== null) {
        asked = true
        if (!(await withinQuota(probed, confirmOverQuota))) {
          throw new DOMException('已取消', 'AbortError')
        }
      }
    }

    // ── 1. encode + cut ────────────────────────────────────────────────
    const stageLabel: Record<PrepareProgress['stage'], string> = {
      'loading-core': '載入音訊處理引擎（第一次約 32 MB）',
      encoding: '壓縮音訊',
      segmenting: '切成片段',
      collecting: '整理片段',
    }
    const prepared = await prepareChunks(
      file,
      {
        bitrateKbps: settings.audioBitrateKbps,
        chunkSeconds: CHUNK_SECONDS,
        enhance: settings.enhanceAudio,
      },
      (p) => {
        const pct = p.ratio >= 0 ? `${Math.round(p.ratio * 100)}%` : ''
        const stage = `${stageLabel[p.stage]}${pct ? ` ${pct}` : ''}`
        onProgress({ stage, done: 0, total: 0 })
        void setJob({ stage })
      },
    )
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError')

    // Fallback for a file the browser could not measure up front.
    if (confirmOverQuota && !asked && !(await withinQuota(prepared.durationSec, confirmOverQuota))) {
      throw new DOMException('已取消', 'AbortError')
    }

    // ── 2. keep the compact copy the player will use ───────────────────
    const storageKey = `audio/${recordingId}.ogg`
    await writeFile(storageKey, prepared.playback)

    await db.recordings.put({
      id: recordingId,
      sessionId,
      fileName: file.name,
      storageKey,
      mimeType: 'audio/ogg',
      bytes: prepared.playback.size,
      durationSec: prepared.durationSec,
      createdAt: Date.now(),
    })

    // The old audio goes only after the new row exists: a deleted file with a
    // row still pointing at it is invisible, and the reverse is merely tidy-up.
    if (replaces) await deleteRecording(replaces)

    // ── 3. transcribe each chunk in turn ───────────────────────────────
    const prompt = buildPrompt(
      course?.glossary ?? [],
      settings.globalGlossary,
      settings.language,
    )
    const cfg: SttConfig = {
      baseUrl: settings.sttBaseUrl,
      apiKey: settings.sttApiKey,
      model: settings.sttModel,
      language: settings.language,
      prompt: prompt.text,
    }

    const total = prepared.chunks.length
    await setJob({ status: 'transcribing', totalChunks: total, doneChunks: 0 })

    const merged: TranscriptSegment[] = []
    let lastRequestAt = 0

    for (const chunk of prepared.chunks) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError')

      const wait = MIN_REQUEST_SPACING_MS - (Date.now() - lastRequestAt)
      if (lastRequestAt > 0 && wait > 0) await sleep(wait, signal)

      const label = `轉錄第 ${chunk.index + 1} / ${total} 段`
      onProgress({ stage: label, done: chunk.index, total })
      await setJob({ stage: label, doneChunks: chunk.index })

      lastRequestAt = Date.now()
      // Measured from where the next chunk begins rather than assumed to be
      // CHUNK_SECONDS: cuts land in whatever pause is nearest the target, so no
      // two chunks are the same length any more.
      const chunkSeconds = Math.max(
        0,
        (prepared.chunks[chunk.index + 1]?.startSec ?? prepared.durationSec) - chunk.startSec,
      )
      const segments = await withRetry(
        () => transcribeChunk(chunk.blob, chunk.fileName, cfg, signal),
        (ms, attempt) => {
          const note = `${label}：等待 ${Math.round(ms / 1000)} 秒後重試（第 ${attempt} 次）`
          onProgress({ stage: note, done: chunk.index, total })
          void setJob({ stage: note })
        },
        signal,
      )

      await recordUsage(chunkSeconds, settings.sttModel, true)

      // Chunk timings are relative to the chunk; shift them onto the recording.
      for (const s of segments) {
        const text = s.text.trim()
        if (!text) continue
        merged.push({
          start: s.start + chunk.startSec,
          end: s.end + chunk.startSec,
          text,
        })
      }
      await setJob({ doneChunks: chunk.index + 1 })
    }

    // ── 4. make it 繁體 ────────────────────────────────────────────────
    // One pass at the end rather than one per chunk: the dictionary is fetched
    // once either way, and nothing has been stored yet, so there is no half-
    // converted state to reason about.
    //
    // A failure here is not allowed to end the job. The dictionary is a
    // separate download, and throwing away a lecture's worth of transcription
    // because it could not be fetched is a far worse trade than storing what
    // the model wrote — which the workspace can convert later, for free.
    onProgress({ stage: '轉成繁體中文', done: total, total })
    await setJob({ stage: '轉成繁體中文' })
    let finished = merged
    try {
      const texts = await toTraditional(merged.map((s) => s.text))
      finished = merged.map((s, i) => ({ ...s, text: texts[i] }))
    } catch {
      // Keep what came back. Nothing is said about it: the transcript is whole,
      // and the one thing left to do is on a menu the reader is about to see.
    }

    // ── 5. take our own words back out ─────────────────────────────────
    // After the conversion, not before it. The model writes the prompt back in
    // whichever script it is currently using, so a 简体 retelling of our 繁體
    // sentence is only recognisable as a quotation once both are in one script.
    finished = finished
      .map((seg) => ({ ...seg, text: stripPromptEcho(seg.text, prompt).trim() }))
      .filter((seg) => seg.text.length > 0)

    // ── 6. store the transcript ────────────────────────────────────────
    const transcriptId = newId('tr')
    const stamp = Date.now()
    await db.transcripts.put({
      id: transcriptId,
      sessionId,
      recordingId,
      model: settings.sttModel,
      language: settings.language,
      segments: finished,
      createdAt: stamp,
      updatedAt: stamp,
    })

    await setJob({ status: 'done', stage: '完成', doneChunks: total })
    onProgress({ stage: '完成', done: total, total })
    return transcriptId
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === 'AbortError'
        ? '已取消'
        : err instanceof Error
          ? err.message
          : String(err)
    await setJob({ status: 'error', stage: '中止', error: message })
    throw err
  }
}

/** True to go ahead: either inside the day's remaining seconds, or confirmed. */
async function withinQuota(
  seconds: number,
  confirm: (w: QuotaWarning) => Promise<boolean>,
): Promise<boolean> {
  const quota = await quotaState()
  const needSeconds = Math.round(seconds)
  if (needSeconds <= quota.remainingToday) return true
  return confirm({
    needSeconds,
    remainingTodaySeconds: quota.remainingToday,
    remainingThisHourSeconds: quota.remainingThisHour,
  })
}

/**
 * Jobs left mid-flight by a closed tab would otherwise sit at "transcribing"
 * for ever, since nothing is running to advance them.
 */
export async function failInterruptedJobs(): Promise<void> {
  const stuck = await db.jobs
    .filter((j) => j.status === 'preparing' || j.status === 'transcribing')
    .toArray()
  await Promise.all(
    stuck.map((j) =>
      db.jobs.update(j.id, {
        status: 'error',
        stage: '中止',
        error: '轉錄在上次關閉分頁時中斷了，請重新上傳這個檔案。',
        updatedAt: Date.now(),
      }),
    ),
  )
}
