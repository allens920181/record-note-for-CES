import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, recordCorrection, saveNote } from '../db'
import type { SessionKind, TranscriptSegment } from '../db/schema'
import { SESSION_KIND_LABEL } from '../db/schema'
import { readFile, rootStatus } from '../storage/fsRoot'
import { runTranscription } from '../stt/transcribe'
import type { RunProgress } from '../stt/transcribe'
import { formatBytes, formatDuration, formatQuota, formatTime } from '../lib/time'
import { Breadcrumbs, TopBar } from '../components/Layout'
import { NoteEditor } from '../components/NoteEditor'
import { WeekPlanPanel } from '../components/WeekPlanPanel'
import type { NoteEditorHandle } from '../components/NoteEditor'
import { RecorderPanel } from '../components/RecorderPanel'
import { AttachmentList } from '../components/AttachmentList'

/** Index of the last segment that has started by time `t`. */
function findActive(segments: TranscriptSegment[], t: number): number {
  let lo = 0
  let hi = segments.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (segments[mid].start <= t) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

export function SessionPage() {
  const { sessionId = '' } = useParams()
  const [searchParams] = useSearchParams()

  const session = useLiveQuery(() => db.sessions.get(sessionId), [sessionId])
  const course = useLiveQuery(
    async () => (session ? db.courses.get(session.courseId) : undefined),
    [session?.courseId],
  )
  const recording = useLiveQuery(
    () => db.recordings.where('sessionId').equals(sessionId).last(),
    [sessionId],
  )
  const transcript = useLiveQuery(
    () => db.transcripts.where('sessionId').equals(sessionId).last(),
    [sessionId],
  )
  const note = useLiveQuery(() => db.notes.get(sessionId), [sessionId])

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const editorRef = useRef<NoteEditorHandle | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioMissing, setAudioMissing] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [follow, setFollow] = useState(true)
  const [editingTranscript, setEditingTranscript] = useState(false)
  const [glossaryNote, setGlossaryNote] = useState<string | null>(null)
  // null means "follow the default": open while there is nothing to transcribe,
  // closed once the two panes need the height.
  const [planOpen, setPlanOpen] = useState<boolean | null>(null)

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [storageReady, setStorageReady] = useState<boolean | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    void rootStatus().then((s) => setStorageReady(s === 'ready'))
  }, [])

  // Pull the stored audio out of the local folder and hand the player a URL.
  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false
    setAudioUrl(null)
    setAudioMissing(false)
    if (!recording) return

    void (async () => {
      try {
        const file = await readFile(recording.storageKey)
        if (cancelled) return
        if (!file) {
          setAudioMissing(true)
          return
        }
        revoked = URL.createObjectURL(file)
        setAudioUrl(revoked)
      } catch {
        if (!cancelled) setAudioMissing(true)
      }
    })()

    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [recording?.id, recording?.storageKey])

  const segments = transcript?.segments ?? []
  const activeIndex = useMemo(
    () => (segments.length ? findActive(segments, currentTime) : -1),
    [segments, currentTime],
  )

  useEffect(() => {
    if (!follow || activeIndex < 0 || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-seg="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIndex, follow])

  // A search result arrives as ?t=seconds; jump there once the audio is ready.
  const jumpTo = searchParams.get('t')
  const jumped = useRef(false)
  useEffect(() => {
    if (!jumpTo || jumped.current || !audioUrl) return
    const seconds = Number(jumpTo)
    if (!Number.isFinite(seconds)) return
    const audio = audioRef.current
    if (!audio) return
    jumped.current = true
    const go = () => {
      audio.currentTime = seconds
      setCurrentTime(seconds)
    }
    if (audio.readyState >= 1) go()
    else audio.addEventListener('loadedmetadata', go, { once: true })
  }, [jumpTo, audioUrl])

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = seconds
    setCurrentTime(seconds)
    void audio.play().catch(() => {
      // Autoplay can be refused; the reader can press play themselves.
    })
  }, [])

  const stampNow = useCallback(() => {
    editorRef.current?.insertTimestamp(audioRef.current?.currentTime ?? 0)
  }, [])

  const noteTimer = useRef<number | null>(null)
  const onNoteChange = useCallback(
    (value: string) => {
      if (noteTimer.current) window.clearTimeout(noteTimer.current)
      noteTimer.current = window.setTimeout(() => void saveNote(sessionId, value), 600)
    },
    [sessionId],
  )
  useEffect(
    () => () => {
      if (noteTimer.current) window.clearTimeout(noteTimer.current)
    },
    [],
  )

  const handleFile = useCallback(
    async (file: File) => {
      setError(null)
      setBusy(true)
      setProgress({ stage: '準備中', done: 0, total: 0 })
      const controller = new AbortController()
      abortRef.current = controller
      try {
        await runTranscription(sessionId, file, setProgress, controller.signal, async (w) => {
          // Seconds, not rounded minutes: this dialog only ever appears when the
          // headroom is nearly gone, and "約 0 分鐘 / 只剩約 0 分鐘" says nothing.
          return confirm(
            `這份錄音 ${formatQuota(w.needSeconds)}，但今天的免費額度只剩 ` +
              `${formatQuota(w.remainingTodaySeconds)}。\n\n` +
              `超過的部分會被服務端擋下並自動重試，可能要等到額度回補。\n` +
              `要繼續嗎？`,
          )
        })
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        setBusy(false)
        setProgress(null)
        abortRef.current = null
      }
    },
    [sessionId],
  )

  const plan = useLiveQuery(() => db.weekPlans.get(sessionId), [sessionId])
  const planDone = plan?.items.filter((i) => i.done).length ?? 0
  const planTotal = plan?.items.length ?? 0

  async function updateSegment(index: number, text: string) {
    if (!transcript || !course) return
    const before = transcript.segments[index]?.text ?? ''
    if (before === text) return
    const next = transcript.segments.map((s, i) => (i === index ? { ...s, text } : s))
    await db.transcripts.update(transcript.id, { segments: next, updatedAt: Date.now() })

    // Every fix is a lesson about how this course's vocabulary is spelled.
    const { learned, recorded } = await recordCorrection({
      courseId: course.id,
      sessionId,
      before,
      after: text,
    })
    // Nothing is said about a punctuation tidy-up: pointing the reader at a
    // panel that has no row for it would just waste the trip.
    setGlossaryNote(
      learned
        ? `同樣的修正出現第二次了，已把「${learned}」加入詞彙表。`
        : recorded
          ? '已記錄這次修正，可到課程頁的「轉錄修正」挑出要記住的詞。'
          : null,
    )
  }

  /** Adds whatever is selected in the transcript to this course's glossary. */
  async function addSelectionToGlossary() {
    if (!course) return
    const term = window.getSelection()?.toString().trim() ?? ''
    if (!term) {
      setGlossaryNote('請先在左邊的逐字稿選取要加入的字。')
      return
    }
    if (term.length > 40) {
      setGlossaryNote('選取的內容太長了，詞彙表放的是名詞而不是句子。')
      return
    }
    if (course.glossary.includes(term)) {
      setGlossaryNote(`「${term}」已經在詞彙表裡了。`)
      return
    }
    await db.courses.update(course.id, { glossary: [...course.glossary, term] })
    setGlossaryNote(`已把「${term}」加入詞彙表，下次轉錄就會用上。`)
  }

  useEffect(() => {
    if (!glossaryNote) return
    const t = window.setTimeout(() => setGlossaryNote(null), 4000)
    return () => window.clearTimeout(t)
  }, [glossaryNote])

  if (session === undefined) return <div className="page">載入中…</div>
  if (session === null)
    return (
      <div className="page">
        找不到這個週次。<Link to="/">回到學期列表</Link>
      </div>
    )

  const hasTranscript = segments.length > 0
  const showPlan = planOpen ?? !hasTranscript
  const kindLabel = SESSION_KIND_LABEL[(session.kind ?? 'lecture') as SessionKind]

  return (
    <>
      <TopBar>
        <Breadcrumbs
          items={[
            { label: '學期', to: '/' },
            { label: course?.name ?? '…', to: course ? `/course/${course.id}` : undefined },
            { label: `第 ${session.index} 週 · ${kindLabel}` },
          ]}
        />
      </TopBar>

      <div className="workspace">
        <div className="ws-head">
          <div className="grow" style={{ minWidth: '12rem' }}>
            <div className="ws-title">
              第 {session.index} 週 · {kindLabel}
              {session.topic ? ` · ${session.topic}` : ''}
            </div>
            <div className="ws-sub mono">{session.date}</div>
          </div>
          <input
            type="text"
            placeholder="這週的主題"
            defaultValue={session.topic}
            style={{ maxWidth: '16rem' }}
            onBlur={(e) => void db.sessions.update(sessionId, { topic: e.target.value.trim() })}
          />
          {recording && (
            <span className="tag">
              {formatDuration(recording.durationSec)} · {formatBytes(recording.bytes)}
            </span>
          )}
          <button
            className="btn ghost sm"
            style={{ flex: '0 0 auto' }}
            aria-expanded={showPlan}
            onClick={() => setPlanOpen(!showPlan)}
          >
            本週進度{planTotal > 0 ? ` ${planDone}/${planTotal}` : ''}
          </button>
        </div>

        {showPlan && (
          <div className="ws-plan">
            <WeekPlanPanel sessionId={sessionId} courseId={session.courseId} compact />
          </div>
        )}

        {/* ── before there's a transcript: record or upload ───────── */}
        {!hasTranscript && (
          <div className="page" style={{ paddingTop: '1.5rem' }}>
            {storageReady === false && (
              <div className="notice warn" style={{ marginBottom: '1rem' }}>
                還沒設定儲存位置，錄音與轉錄都無法開始。請先到 <Link to="/settings">設定</Link>{' '}
                指定一個本機資料夾。
              </div>
            )}

            {busy ? (
              <div className="card">
                <h2>處理中</h2>
                <p className="small muted" style={{ margin: '.4rem 0 .9rem' }}>
                  {progress?.stage ?? '準備中'}
                  {progress && progress.total > 0 ? `（${progress.done} / ${progress.total}）` : ''}
                </p>
                <div className="progress">
                  <div
                    style={{
                      width:
                        progress && progress.total > 0
                          ? `${(progress.done / progress.total) * 100}%`
                          : '15%',
                    }}
                  />
                </div>
                <p className="small muted" style={{ marginTop: '.9rem' }}>
                  第一次使用會下載約 32 MB 的音訊處理引擎。之後就不用再下載了。
                  請保持這個分頁開著。
                </p>
                <button
                  className="btn danger sm"
                  style={{ marginTop: '.6rem' }}
                  onClick={() => abortRef.current?.abort()}
                >
                  取消
                </button>
              </div>
            ) : (
              <div className="intake">
                <RecorderPanel
                  sessionId={sessionId}
                  disabled={storageReady === false}
                  onFinished={(file) => void handleFile(file)}
                />

                <label
                  className={`dropzone${dragOver ? ' over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    const file = e.dataTransfer.files[0]
                    if (file) void handleFile(file)
                  }}
                >
                  <input
                    type="file"
                    accept="audio/*,video/mp4,.m4a,.mp3,.wav,.ogg,.webm,.mp4"
                    style={{ display: 'none' }}
                    disabled={storageReady === false}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void handleFile(file)
                      e.target.value = ''
                    }}
                  />
                  <strong>或上傳已經錄好的檔案</strong>
                  <div style={{ marginTop: '.4rem' }}>
                    拖進來，或點一下選檔案。支援 mp3 / m4a / wav / ogg / webm / mp4。
                  </div>
                </label>
              </div>
            )}

            {error && (
              <div className="notice err" style={{ marginTop: '1rem' }}>
                <strong>失敗</strong>
                <pre>{error}</pre>
              </div>
            )}

            {course && (
              <div style={{ marginTop: '1.5rem' }}>
                <AttachmentList
                  scope="session"
                  ownerId={sessionId}
                  courseId={course.id}
                  kinds={['handout', 'reading', 'other']}
                  title="這週的講義"
                  hint="老師這週發的投影片或補充資料。PDF 可以直接在這裡讀。"
                />
              </div>
            )}
          </div>
        )}

        {/* ── the two panes ──────────────────────────────────────── */}
        {hasTranscript && (
          <div className="panes">
            <section className="pane">
              <div className="pane-head">
                <span className="grow">逐字稿 · {segments.length} 段</span>
                <button
                  className="btn ghost sm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void addSelectionToGlossary()}
                  title="把選取的專有名詞加入這門課的詞彙表"
                >
                  選取加入詞彙表
                </button>
                <button
                  className="btn ghost sm"
                  onClick={() => setFollow((f) => !f)}
                  title="播放時自動捲到目前這一句"
                >
                  {follow ? '跟播中' : '不跟播'}
                </button>
                <button className="btn ghost sm" onClick={() => setEditingTranscript((v) => !v)}>
                  {editingTranscript ? '完成編輯' : '修正錯字'}
                </button>
              </div>

              {glossaryNote && <div className="pane-flash">{glossaryNote}</div>}

              <div className="pane-body" ref={listRef}>
                <div className="tx-list">
                  {segments.map((seg, i) => (
                    <div
                      key={i}
                      data-seg={i}
                      className={`tx-seg${i === activeIndex ? ' active' : ''}`}
                      onClick={() => !editingTranscript && seek(seg.start)}
                    >
                      <span className="tx-time">{formatTime(seg.start)}</span>
                      {editingTranscript ? (
                        <textarea
                          className="tx-edit"
                          rows={Math.max(1, Math.ceil(seg.text.length / 40))}
                          defaultValue={seg.text}
                          onBlur={(e) => void updateSegment(i, e.target.value)}
                        />
                      ) : (
                        <span className="tx-text">{seg.text}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="player">
                {audioMissing ? (
                  <span className="small" style={{ color: 'var(--danger)' }}>
                    找不到音檔——資料夾可能移動過，或權限需要重新授權。
                  </span>
                ) : (
                  <>
                    <audio
                      ref={audioRef}
                      src={audioUrl ?? undefined}
                      controls
                      preload="metadata"
                      onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    />
                    <span className="clock">{formatTime(currentTime)}</span>
                  </>
                )}
              </div>
            </section>

            <section className="pane">
              <div className="pane-head">
                <span className="grow">我的筆記</span>
                <button className="btn ghost sm" onClick={stampNow} title="插入目前播放時間（Alt+T）">
                  插入時間戳 ⌥T
                </button>
              </div>
              <div className="pane-body">
                {note !== undefined && (
                  <NoteEditor
                    key={sessionId}
                    ref={editorRef}
                    initialValue={note?.markdown ?? ''}
                    onChange={onNoteChange}
                    onSeek={seek}
                    onStampRequested={stampNow}
                  />
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  )
}
