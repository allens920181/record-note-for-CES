import { db } from '../db'
import type { RecordingDraft } from '../db/schema'
import { stampOf } from '../lib/dates'
import { newId } from '../lib/id'
import { deleteDir, listDir, readFile, writeFile } from '../storage/fsRoot'

export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'

/** How much audio a crash can cost. Each part is ~700 KB at 32 kbps. */
const PART_SECONDS = 180

const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]

function pickMimeType(): string {
  for (const t of PREFERRED_TYPES) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4')) return 'm4a'
  return 'webm'
}

export function recorderSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

/**
 * Records a lecture straight into the chosen storage folder.
 *
 * Parts are flushed to disk every few minutes rather than held in memory, so a
 * tab that dies three hours in leaves everything up to the last part on disk
 * instead of nothing. A screen wake lock keeps the machine from sleeping
 * mid-lecture, and it is re-taken whenever the tab becomes visible again —
 * the browser drops the lock while the tab is hidden.
 */
export class SessionRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private audioCtx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private wakeLock: WakeLockSentinel | null = null

  private draft: RecordingDraft | null = null
  private partIndex = 0
  /** Serialises disk writes so parts can't interleave or land out of order. */
  private writeChain: Promise<void> = Promise.resolve()
  private writeError: Error | null = null

  private startedAt = 0
  private accumulatedMs = 0

  state: RecorderState = 'idle'
  onStateChange: ((s: RecorderState) => void) | null = null

  private setState(s: RecorderState) {
    this.state = s
    this.onStateChange?.(s)
  }

  get elapsedSec(): number {
    const running = this.state === 'recording' ? Date.now() - this.startedAt : 0
    return Math.floor((this.accumulatedMs + running) / 1000)
  }

  get partCount(): number {
    return this.partIndex
  }

  /** Instantaneous RMS level, 0..1, for the meter. */
  getLevel(): number {
    if (!this.analyser) return 0
    const buf = new Uint8Array(this.analyser.frequencyBinCount)
    this.analyser.getByteTimeDomainData(buf)
    let sum = 0
    for (const v of buf) {
      const centred = (v - 128) / 128
      sum += centred * centred
    }
    return Math.min(1, Math.sqrt(sum / buf.length) * 3)
  }

  private async takeWakeLock() {
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null
    } catch {
      // Not fatal — the reader just has to keep the screen awake themselves.
    }
  }

  private onVisibility = () => {
    if (document.visibilityState === 'visible' && this.state === 'recording' && !this.wakeLock) {
      void this.takeWakeLock()
    }
  }

  async start(sessionId: string): Promise<void> {
    if (this.state !== 'idle') throw new Error('已經在錄音了')
    this.setState('starting')

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          // A lecture hall is the signal, not noise — leave the room sound alone
          // and let gain control handle a lecturer who wanders from the mic.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      })
    } catch (err) {
      this.setState('idle')
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError') throw new Error('沒有取得麥克風權限，請在瀏覽器允許後再試。')
      if (name === 'NotFoundError') throw new Error('找不到麥克風裝置。')
      throw new Error(`無法開始錄音：${err instanceof Error ? err.message : String(err)}`)
    }

    const mimeType = pickMimeType()
    const draftId = newId('draft')
    const draft: RecordingDraft = {
      id: draftId,
      sessionId,
      dir: `recordings/${draftId}`,
      parts: 0,
      mimeType: mimeType || 'audio/webm',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }
    await db.drafts.put(draft)
    this.draft = draft
    this.partIndex = 0
    this.writeError = null
    this.accumulatedMs = 0

    this.audioCtx = new AudioContext()
    this.analyser = this.audioCtx.createAnalyser()
    this.analyser.fftSize = 1024
    this.audioCtx.createMediaStreamSource(this.stream).connect(this.analyser)

    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.queuePart(e.data)
    }
    this.recorder.start(PART_SECONDS * 1000)

    this.startedAt = Date.now()
    document.addEventListener('visibilitychange', this.onVisibility)
    await this.takeWakeLock()
    this.setState('recording')
  }

  private queuePart(blob: Blob) {
    const draft = this.draft
    if (!draft) return
    const index = this.partIndex++
    const name = `part-${String(index).padStart(4, '0')}.${extensionFor(draft.mimeType)}`
    this.writeChain = this.writeChain
      .then(() => writeFile(`${draft.dir}/${name}`, blob))
      .then(() => db.drafts.update(draft.id, { parts: index + 1, updatedAt: Date.now() }))
      .then(() => undefined)
      .catch((err) => {
        // Surfaced on stop — a failed write means the recording has a hole,
        // and the reader needs to know before they walk out of the lecture.
        this.writeError = err instanceof Error ? err : new Error(String(err))
      })
  }

  pause() {
    if (this.state !== 'recording' || !this.recorder) return
    this.recorder.pause()
    this.accumulatedMs += Date.now() - this.startedAt
    this.setState('paused')
  }

  resume() {
    if (this.state !== 'paused' || !this.recorder) return
    this.recorder.resume()
    this.startedAt = Date.now()
    this.setState('recording')
    void this.takeWakeLock()
  }

  /** Stops, stitches the parts back together and hands back one file. */
  async stop(): Promise<File> {
    if (this.state === 'idle' || !this.recorder || !this.draft) {
      throw new Error('目前沒有在錄音')
    }
    this.setState('stopping')
    if (this.state !== 'paused') this.accumulatedMs += Date.now() - this.startedAt

    const recorder = this.recorder
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      recorder.stop()
    })

    await this.writeChain
    this.teardown()

    const draft = this.draft
    if (this.writeError) {
      throw new Error(
        `錄音存檔時發生問題：${this.writeError.message}\n` +
          `已寫入的片段留在 ${draft.dir}，可稍後從「未完成的錄音」復原。`,
      )
    }

    const file = await assembleDraft(draft)
    await deleteDir(draft.dir)
    await db.drafts.delete(draft.id)
    this.draft = null
    this.setState('idle')
    return file
  }

  /** Stops and keeps the parts on disk, e.g. when the reader navigates away. */
  async abandon(): Promise<void> {
    if (this.state === 'idle') return
    try {
      this.recorder?.stop()
    } catch {
      // Already stopped.
    }
    await this.writeChain
    this.teardown()
    this.draft = null
    this.setState('idle')
  }

  private teardown() {
    document.removeEventListener('visibilitychange', this.onVisibility)
    void this.wakeLock?.release().catch(() => {})
    this.wakeLock = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    void this.audioCtx?.close().catch(() => {})
    this.audioCtx = null
    this.analyser = null
    this.recorder = null
  }
}

/**
 * Reads a draft's parts back off disk and joins them into one file.
 *
 * The bytes are pulled into memory rather than kept as file references: a File
 * from getFile() is a *view* onto the file on disk, so the caller deleting the
 * draft directory afterwards would leave a File that reads as empty. Assembling
 * has to mean copying.
 */
export async function assembleDraft(draft: RecordingDraft): Promise<File> {
  const names = await listDir(draft.dir)
  if (names.length === 0) throw new Error('這份錄音在磁碟上找不到任何片段。')

  const buffers: ArrayBuffer[] = []
  for (const name of names) {
    const file = await readFile(`${draft.dir}/${name}`)
    if (file) buffers.push(await file.arrayBuffer())
  }
  if (buffers.length === 0) throw new Error('這份錄音的片段都讀不出來。')

  // MediaRecorder's timeslice chunks are one continuous stream cut into pieces:
  // only the first carries the header, so order matters and concatenation is
  // exactly the right way to put them back together.
  const stamp = stampOf(new Date(draft.startedAt))
  const ext = extensionFor(draft.mimeType)
  return new File(buffers, `課堂錄音 ${stamp}.${ext}`, { type: draft.mimeType })
}

export async function listDrafts(sessionId: string): Promise<RecordingDraft[]> {
  return db.drafts.where('sessionId').equals(sessionId).toArray()
}

export async function discardDraft(draft: RecordingDraft): Promise<void> {
  await deleteDir(draft.dir)
  await db.drafts.delete(draft.id)
}
