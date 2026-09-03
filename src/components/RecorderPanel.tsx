import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { RecordingDraft } from '../db/schema'
import { SessionRecorder, assembleDraft, discardDraft, recorderSupported } from '../audio/recorder'
import { formatTime } from '../lib/time'
import { useConfirm } from './ConfirmProvider'

interface Props {
  sessionId: string
  disabled: boolean
  /** Handed a finished recording, ready to go through the transcription pipeline. */
  onFinished: (file: File) => void
  /**
   * Whether a recording is under way. The pane holding this panel uses it to
   * take its own way out off screen: unmounting mid-lecture abandons the take,
   * and a stray click on 取消 is not what anyone meant by that.
   */
  onLiveChange?: (live: boolean) => void
}

export function RecorderPanel({ sessionId, disabled, onFinished, onLiveChange }: Props) {
  const ask = useConfirm()
  const recorder = useRef<SessionRecorder | null>(null)
  if (!recorder.current) recorder.current = new SessionRecorder()

  const [state, setState] = useState(recorder.current.state)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [parts, setParts] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const drafts = useLiveQuery(() => db.drafts.where('sessionId').equals(sessionId).toArray(), [
    sessionId,
  ])

  useEffect(() => {
    const rec = recorder.current
    if (!rec) return
    rec.onStateChange = setState
    return () => {
      rec.onStateChange = null
      // Leave the parts on disk: an unmount mid-lecture is recoverable, and
      // silently deleting three hours of audio never is.
      void rec.abandon()
    }
  }, [])

  // Meter and clock share one animation frame loop rather than two timers.
  useEffect(() => {
    if (state !== 'recording' && state !== 'paused') return
    let raf = 0
    const tick = () => {
      const rec = recorder.current
      if (rec) {
        setElapsed(rec.elapsedSec)
        setLevel(state === 'recording' ? rec.getLevel() : 0)
        setParts(rec.partCount)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [state])

  // Recording is the one thing worth interrupting a tab close over.
  useEffect(() => {
    if (state !== 'recording' && state !== 'paused') return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [state])

  async function guard(run: () => Promise<void>) {
    setError(null)
    try {
      await run()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function recoverDraft(draft: RecordingDraft) {
    await guard(async () => {
      const file = await assembleDraft(draft)
      await discardDraft(draft)
      onFinished(file)
    })
  }

  const live = state === 'recording' || state === 'paused'
  useEffect(() => {
    onLiveChange?.(live)
  }, [live, onLiveChange])

  if (!recorderSupported()) {
    return (
      <div className="notice warn">
        這個瀏覽器不支援在 App 內錄音。你仍然可以用手機或錄音筆錄好之後上傳。
      </div>
    )
  }

  const pending = (drafts ?? []).filter((d) => d.parts > 0)

  return (
    <div className="card">
      <h2>在這裡錄音</h2>
      <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
        每 3 分鐘就把一段寫進你的資料夾，所以就算分頁當掉，最多只會丟掉最後 3 分鐘。
        錄音期間會請求螢幕保持喚醒。
      </p>

      {live && (
        <div className="rec-live">
          <span className={`rec-dot${state === 'recording' ? ' on' : ''}`} aria-hidden="true" />
          <span className="rec-clock mono">{formatTime(elapsed)}</span>
          <div className="rec-meter" aria-hidden="true">
            <div style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          <span className="small muted">已寫入 {parts} 段</span>
        </div>
      )}

      <div className="row" style={{ gap: '.6rem', marginTop: live ? '.9rem' : 0 }}>
        {!live && (
          <button
            className="btn primary"
            style={{ flex: '0 0 auto' }}
            disabled={disabled || state === 'starting'}
            onClick={() => guard(() => recorder.current!.start(sessionId))}
          >
            {state === 'starting' ? '啟動中…' : '開始錄音'}
          </button>
        )}
        {state === 'recording' && (
          <button className="btn" style={{ flex: '0 0 auto' }} onClick={() => recorder.current!.pause()}>
            暫停
          </button>
        )}
        {state === 'paused' && (
          <button
            className="btn"
            style={{ flex: '0 0 auto' }}
            onClick={() => recorder.current!.resume()}
          >
            繼續
          </button>
        )}
        {live && (
          <button
            className="btn primary"
            style={{ flex: '0 0 auto' }}
            onClick={() =>
              guard(async () => {
                const file = await recorder.current!.stop()
                onFinished(file)
              })
            }
          >
            結束並轉錄
          </button>
        )}
      </div>

      {!live && pending.length > 0 && (
        <div className="notice warn" style={{ marginTop: '.9rem' }}>
          <strong>有未完成的錄音</strong>
          <div className="stack" style={{ marginTop: '.6rem' }}>
            {pending.map((d) => (
              <div key={d.id} className="row" style={{ gap: '.5rem', alignItems: 'center' }}>
                <span className="grow small mono">
                  {new Date(d.startedAt).toLocaleString('zh-TW')} · {d.parts} 段
                </span>
                <button
                  className="btn sm"
                  style={{ flex: '0 0 auto' }}
                  onClick={() => void recoverDraft(d)}
                >
                  復原並轉錄
                </button>
                <button
                  className="btn danger sm"
                  style={{ flex: '0 0 auto' }}
                  onClick={async () => {
                    const go = await ask({
                      title: '丟棄這份未完成的錄音？',
                      danger: true,
                      confirmLabel: '丟棄',
                      body: '這是上次分頁關掉時留在磁碟上的片段。丟掉之後就沒辦法再復原成音檔了。',
                    })
                    if (go) await discardDraft(d)
                  }}
                >
                  丟棄
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="notice err" style={{ marginTop: '.9rem' }}>
          {error}
        </div>
      )}
    </div>
  )
}
