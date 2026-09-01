import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  deletePart,
  deleteTranscription,
  getSettings,
  markSpeaker,
  recordCorrection,
  saveNote,
  saveSettings,
  siblingSessions,
} from '../db'
import type { SessionKind, TranscriptSegment } from '../db/schema'
import { PLAYBACK_RATES, SESSION_KIND_LABEL } from '../db/schema'
import { readFile, rootStatus } from '../storage/fsRoot'
import { runTranscription } from '../stt/transcribe'
import type { RunProgress } from '../stt/transcribe'
import { hasHan, toTraditional } from '../stt/traditional'
import { formatBytes, formatDuration, formatQuota, formatTime } from '../lib/time'
import { Breadcrumbs, PageShell, TopBar } from '../components/Layout'
import { NoteEditor } from '../components/NoteEditor'
import type { OutlineEntry } from '../components/NoteEditor'
import { keyLabel } from '../editor/keys'
import { WeekPlanPanel } from '../components/WeekPlanPanel'
import type { NoteEditorHandle } from '../components/NoteEditor'
import { RecorderPanel } from '../components/RecorderPanel'
import { RowMenu } from '../components/RowMenu'
import { SpeakerPicker } from '../components/SpeakerPicker'
import { looksLikeTurn, speakersIn, speakersOf } from '../lib/speakers'
import { AttachmentList } from '../components/AttachmentList'
import { addAttachment } from '../files/attachments'
import { Modal } from '../components/Modal'
import { useConfirm } from '../components/ConfirmProvider'

/**
 * What a selection actually holds, without the furniture around the words.
 *
 * The time and the speaker's name sit at the left of every line — which is
 * where a left-to-right drag starts, so both are caught in the selection.
 * Marking them `user-select: none` looked like the fix and was worse: a
 * selection cannot begin inside such an element, so dragging from the natural
 * place selected nothing at all.
 */
function selectedText(sel: Selection): string {
  if (sel.rangeCount === 0) return ''
  const holder = document.createElement('div')
  holder.append(sel.getRangeAt(0).cloneContents())
  holder.querySelectorAll('.tx-time, .tx-who, .spk').forEach((el) => el.remove())
  return holder.textContent ?? ''
}

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
  const ask = useConfirm()
  const { sessionId = '' } = useParams()
  const [searchParams] = useSearchParams()

  // See CoursePage: undefined means "still reading", null means "not there".
  const session = useLiveQuery(async () => (await db.sessions.get(sessionId)) ?? null, [sessionId])
  const course = useLiveQuery(
    async () => (session ? db.courses.get(session.courseId) : undefined),
    [session?.courseId],
  )
  /**
   * Every recording of this week, oldest first.
   *
   * A week is not always one file: a break in the middle, a phone that ran out
   * of battery, a class split over two evenings. They are kept apart rather
   * than stitched into one timeline — laying them end to end would put a made-up
   * time on the second one and imply the two were recorded back to back.
   */
  const recordingRows = useLiveQuery(
    () => db.recordings.where('sessionId').equals(sessionId).sortBy('createdAt'),
    [sessionId],
  )
  const recordings = useMemo(() => recordingRows ?? [], [recordingRows])
  const transcriptRows = useLiveQuery(
    () => db.transcripts.where('sessionId').equals(sessionId).toArray(),
    [sessionId],
  )
  const transcripts = useMemo(() => transcriptRows ?? [], [transcriptRows])

  /** Which recording the pane and the player are showing. */
  const [partId, setPartId] = useState<string | null>(null)
  const recording = useMemo(
    () => recordings.find((r) => r.id === partId) ?? recordings[0] ?? null,
    [recordings, partId],
  )
  /** 1-based, matching what the part strip and the [[第N段]] tokens say. */
  const partNo = recording ? recordings.findIndex((r) => r.id === recording.id) + 1 : 1
  const transcript = useMemo(
    () =>
      recording
        ? (transcripts.find((t) => t.recordingId === recording.id) ?? null)
        : // A transcript whose audio has been deleted still deserves to be read.
          (transcripts[transcripts.length - 1] ?? null),
    [recording, transcripts],
  )

  // Landing on a week shows its first part; a part added while you are looking
  // is the one you just made, so that one is opened.
  // A search result names the recording its line came from, so the workspace
  // opens that one rather than the first.
  const wantedPart = searchParams.get('rec')
  const seenParts = useRef<string[]>([])
  useEffect(() => {
    setPartId(wantedPart)
    seenParts.current = []
  }, [sessionId, wantedPart])
  useEffect(() => {
    const ids = recordings.map((r) => r.id)
    const added = ids.find((id) => !seenParts.current.includes(id))
    if (seenParts.current.length > 0 && added) setPartId(added)
    seenParts.current = ids
  }, [recordings])
  // `?? null` so "still loading" and "no note yet" are distinguishable:
  // useLiveQuery yields undefined for both, and a session that has never been
  // written to has no row — which used to mean the editor never mounted, and
  // therefore no row could ever be written. A deadlock hidden by every test
  // seeding a note first.
  const siblings = useLiveQuery(() => siblingSessions(sessionId), [sessionId])
  const note = useLiveQuery(async () => (await db.notes.get(sessionId)) ?? null, [sessionId])

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const editorRef = useRef<NoteEditorHandle | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioMissing, setAudioMissing] = useState(false)
  const settings = useLiveQuery(() => getSettings(), [])
  const playbackRate = settings?.playbackRate ?? 1
  const [currentTime, setCurrentTime] = useState(0)
  const [follow, setFollow] = useState(true)
  const [editingTranscript, setEditingTranscript] = useState(false)
  /** Naming who is speaking, rather than reading. */
  const [markingSpeakers, setMarkingSpeakers] = useState(false)
  /** Show only one person's turns, or all of them. */
  const [onlySpeaker, setOnlySpeaker] = useState('')
  const [glossaryNote, setGlossaryNote] = useState<string | null>(null)
  // null means "follow the default": open while there is nothing to transcribe,
  // closed once the two panes need the height.
  const [planOpen, setPlanOpen] = useState<boolean | null>(null)
  /** The left pane shows the week's handouts instead of its usual content. */
  const [showFiles, setShowFiles] = useState(false)
  /** Below 60rem only one pane fits; this says which. */
  const [narrowPane, setNarrowPane] = useState<'left' | 'note'>('left')
  const [outline, setOutline] = useState<{ entries: OutlineEntry[]; line: number }>({
    entries: [],
    line: 1,
  })
  const [showOutline, setShowOutline] = useState(false)
  /** Which of the three transcript actions is being confirmed, if any. */
  const [redo, setRedo] = useState<'again' | 'replace' | 'drop' | null>(null)

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [storageReady, setStorageReady] = useState<boolean | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Re-checked per session rather than once per mount: moving between weeks
  // keeps this component mounted, so an empty dependency list would report the
  // storage state from whenever the workspace was first opened.
  useEffect(() => {
    void rootStatus().then((s) => setStorageReady(s === 'ready'))
  }, [sessionId])

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
  // Set on the element rather than passed as an attribute: React has no
  // property for it, and a newly loaded file starts at 1× until it is told
  // otherwise — which is why this also runs when the audio changes.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.playbackRate = playbackRate
    // Without this a lecture at 1.5× is a chipmunk; every current browser can
    // keep the pitch, and the older name is still what Safari answers to.
    audio.preservesPitch = true
  }, [playbackRate, audioUrl])

  /**
   * Who is talking on each line, filled forward from the turn starts, and the
   * names heard in this part. Up here with the other derivations rather than
   * beside where they are drawn: everything below the early returns for a
   * session that is missing or still loading runs conditionally, and a hook
   * cannot.
   */
  const speaking = useMemo(() => speakersOf(segments), [segments])
  const heard = useMemo(() => speakersIn(segments), [segments])
  /** An English lecture has nothing to convert, and is not offered the option. */
  const hasChinese = useMemo(() => segments.some((s) => hasHan(s.text)), [segments])

  // With no audio there is no playhead, so no line is the current one — the
  // first line used to sit highlighted as if it were being spoken.
  const activeIndex = useMemo(
    () => (audioUrl && segments.length ? findActive(segments, currentTime) : -1),
    [audioUrl, segments, currentTime],
  )

  useEffect(() => {
    if (!follow || activeIndex < 0 || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-seg="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIndex, follow])

  // Where to land once a part's audio finishes loading — set when a note's
  // timestamp points at a part that is not the one currently open.
  const pendingSeek = useRef<number | null>(null)
  useEffect(() => {
    const seconds = pendingSeek.current
    const audio = audioRef.current
    if (seconds === null || !audioUrl || !audio) return
    pendingSeek.current = null
    const go = () => {
      audio.currentTime = seconds
      setCurrentTime(seconds)
      void audio.play().catch(() => {})
    }
    if (audio.readyState >= 1) go()
    else audio.addEventListener('loadedmetadata', go, { once: true })
  }, [audioUrl])

  // A search result arrives as ?t=seconds; jump there once the audio is ready.
  const jumpTo = searchParams.get('t')
  const jumped = useRef(false)
  // Reset per destination: the workspace stays mounted between searches, and a
  // second result used to land on the right week without moving the playhead.
  useEffect(() => {
    jumped.current = false
  }, [sessionId, jumpTo])
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

  /**
   * A timestamp clicked in the note. It names its part, so the right recording
   * is opened first — the note is read weeks later, when which file was playing
   * is long forgotten.
   */
  const seekPart = useCallback(
    (seconds: number, part: number) => {
      const target = recordings[part - 1]
      if (target && target.id !== recording?.id) {
        setPartId(target.id)
        // The audio for that part has not been read off disk yet; the effect
        // that loads it hands the position on through `pendingSeek`.
        pendingSeek.current = seconds
        setCurrentTime(seconds)
        return
      }
      seek(seconds)
    },
    [recordings, recording?.id, seek],
  )

  const stampNow = useCallback(() => {
    editorRef.current?.insertTimestamp(audioRef.current?.currentTime ?? 0, partNo)
  }, [partNo])

  const noteTimer = useRef<number | null>(null)
  // Held so unmount can write it: cancelling the timer without flushing loses
  // whatever was typed in the last 600ms, and leaving a page is exactly when
  // people stop typing.
  const pendingNote = useRef<string | null>(null)
  const onNoteChange = useCallback(
    (value: string) => {
      pendingNote.current = value
      if (noteTimer.current) window.clearTimeout(noteTimer.current)
      noteTimer.current = window.setTimeout(() => {
        pendingNote.current = null
        void saveNote(sessionId, value)
      }, 600)
    },
    [sessionId],
  )
  useEffect(
    () => () => {
      if (noteTimer.current) window.clearTimeout(noteTimer.current)
      if (pendingNote.current !== null) void saveNote(sessionId, pendingNote.current)
    },
    [sessionId],
  )

  const handleFile = useCallback(
    async (file: File, replaces?: string) => {
      setError(null)
      setBusy(true)
      setProgress({ stage: '準備中', done: 0, total: 0 })
      const controller = new AbortController()
      abortRef.current = controller
      try {
        await runTranscription(
          sessionId,
          file,
          setProgress,
          controller.signal,
          async (w) => {
            // Seconds, not rounded minutes: this dialog only ever appears when
            // the headroom is nearly gone, and "約 0 分鐘 / 只剩約 0 分鐘" says
            // nothing.
            return ask({
              title: '這份錄音會超過今天的免費額度',
              confirmLabel: '仍然轉錄',
              cancelLabel: '先不要',
              body: (
                <>
                  這份錄音 {formatQuota(w.needSeconds)}，但今天的免費額度只剩{' '}
                  {formatQuota(w.remainingTodaySeconds)}。
                  <br />
                  超過的部分會被服務端擋下並自動重試，可能要等到額度回補才會跑完。
                </>
              ),
            })
          },
          replaces,
        )
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

  /** Runs the same audio through again, replacing what is there now. */
  const transcribeAgain = useCallback(async () => {
    if (!recording) return
    const file = await readFile(recording.storageKey)
    if (!file) {
      setError(`找不到 ${recording.fileName}——資料夾可能移動過，或權限需要重新授權。`)
      return
    }
    // The transcript goes first so the workspace shows the intake state while
    // this runs; the recording is handed to runTranscription as `replaces` and
    // removed only once the new one is on disk. Scoped to this part — the other
    // recordings of the week have nothing to do with it.
    await db.transcripts.where('recordingId').equals(recording.id).delete()
    await handleFile(new File([file], recording.fileName, { type: file.type }), recording.id)
  }, [recording, handleFile])

  const plan = useLiveQuery(() => db.weekPlans.get(sessionId), [sessionId])
  const fileCount = useLiveQuery(
    () => db.attachments.where({ scope: 'session', ownerId: sessionId }).count(),
    [sessionId],
  ) ?? 0
  const planDone = plan?.items.filter((i) => i.done).length ?? 0
  const planTotal = plan?.items.length ?? 0

  async function setSpeakerAt(index: number, name: string | null) {
    if (!transcript) return
    await markSpeaker(transcript.id, index, name)
  }

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
          ? '已記錄這次修正，可到課程頁的「詞彙表」挑出要記住的詞。'
          : null,
    )
  }

  /**
   * Rewrites this transcript in 繁體.
   *
   * New ones arrive that way already. This is for the weeks recorded before
   * that was true, which would otherwise have to be sent through the API a
   * second time — and paid for a second time — just to change script.
   *
   * Nothing is filed as a correction: those exist to learn how this course
   * spells its vocabulary, and 简体 → 繁體 teaches nothing about 加爾文.
   */
  async function convertToTraditional() {
    if (!transcript) return
    const before = transcript.segments
    setGlossaryNote('正在轉成繁體中文…')
    try {
      const texts = await toTraditional(before.map((s) => s.text))
      const changed = texts.filter((t, i) => t !== before[i].text).length
      if (changed === 0) {
        setGlossaryNote('這份逐字稿已經是繁體中文了。')
        return
      }
      await db.transcripts.update(transcript.id, {
        segments: before.map((s, i) => ({ ...s, text: texts[i] })),
        updatedAt: Date.now(),
      })
      setGlossaryNote(`已轉成繁體中文，改寫了 ${changed} 句。`)
    } catch {
      setGlossaryNote('下載不到轉換用的字表，請確認網路後再試一次。')
    }
  }

  /**
   * What is selected in the transcript, and when it was said.
   *
   * The timestamp comes from the segment the selection starts in — not from
   * `currentTime`. Quoting a line you scrolled back to while the audio kept
   * playing would otherwise stamp it with a moment it has nothing to do with.
   */
  function transcriptQuote(): { text: string; seconds: number; part: number } | null {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return null
    const segOf = (node: Node | null | undefined) => {
      const el = node instanceof Element ? node : node?.parentElement
      return el?.closest<HTMLElement>('.tx-seg') ?? null
    }
    const anchor = segOf(sel.anchorNode)
    if (!anchor) return null
    const first = Number(anchor.dataset.seg)
    const focusEl = segOf(sel.focusNode)
    const last = focusEl ? Number(focusEl.dataset.seg) : first
    if (!Number.isFinite(first)) return null
    const from = Math.min(first, last)
    const to = Math.max(first, Number.isFinite(last) ? last : first)
    const start = segments[from]
    if (!start) return null
    // Within one segment, take exactly what was highlighted. Across several,
    // rebuild from the segments: the raw selection string has the time labels
    // of every row caught in the middle.
    const text =
      from === to
        ? selectedText(sel).trim()
        : segments
            .slice(from, to + 1)
            .map((seg) => seg.text.trim())
            .join('')
    return text ? { text, seconds: start.start, part: partNo } : null
  }

  /** Pulls the selected transcript into the note as a quote that jumps back. */
  function quoteIntoNote() {
    const picked = transcriptQuote()
    if (!picked) {
      setGlossaryNote('先在左邊的逐字稿上按住滑鼠、拖過想引用的那句話，再按這裡。')
      return
    }
    editorRef.current?.run('transcript')
    setNarrowPane('note')
    // Said out loud: the note may be off-screen on a narrow window, and an
    // action that reports nothing is indistinguishable from one that failed.
    setGlossaryNote(`已引用到筆記：「${picked.text.slice(0, 12)}${picked.text.length > 12 ? '…' : ''}」`)
  }

  /** Adds whatever is selected in the transcript to this course's glossary. */
  async function addSelectionToGlossary() {
    if (!course) return
    const sel = window.getSelection()
    const term = sel ? selectedText(sel).trim() : ''
    if (!term) {
      setGlossaryNote('先在左邊的逐字稿上拖過那個詞，再按這裡。')
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

  if (session === undefined)
    return (
      <PageShell crumbs={[{ label: '學期', to: '/' }, { label: '…' }]}>
        <div className="empty">載入中…</div>
      </PageShell>
    )
  if (session === null)
    return (
      <PageShell crumbs={[{ label: '學期', to: '/' }, { label: '找不到' }]}>
        <div className="empty">
          <p>找不到這個週次，可能已經被刪掉了。</p>
          <Link className="btn primary" to="/">
            回到學期列表
          </Link>
        </div>
      </PageShell>
    )

  const hasTranscript = segments.length > 0
  const roster = course?.speakers ?? []

  /**
   * The `/檔案` command's other half: pick a file, store it against this week,
   * and hand back where it went so the note can link to it. The file shows up
   * in the course's 文件總覽 because that reads the same attachment rows.
   */
  async function attachFile(): Promise<{ fileName: string; storageKey: string } | null> {
    if (!session) return null
    const input = document.createElement('input')
    input.type = 'file'
    input.style.display = 'none'
    // In the document, not detached: a floating input's click does not always
    // count as the gesture that is allowed to open a file picker.
    document.body.append(input)
    try {
      const picked = await new Promise<File | null>((resolve) => {
        input.onchange = () => resolve(input.files?.[0] ?? null)
        // No 'cancel' event in older browsers, so a dismissed picker simply
        // never resolves — the promise is dropped along with the command.
        input.oncancel = () => resolve(null)
        input.click()
      })
      if (!picked) return null
      return await store(picked)
    } finally {
      input.remove()
    }
  }

  async function store(picked: File): Promise<{ fileName: string; storageKey: string } | null> {
    if (!session) return null
    const id = await addAttachment({
      scope: 'session',
      ownerId: sessionId,
      courseId: session.courseId,
      kind: 'handout',
      file: picked,
    })
    const row = await db.attachments.get(id)
    return row ? { fileName: row.fileName, storageKey: row.storageKey } : null
  }

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
        {/* Sideways, not just up: tidying a course's notes means going through
            fifteen weeks, and every step used to be two clicks via the course
            page. The labels name the destination so a step is never a guess. */}
        <span className="spacer" />
        {/* While `siblings` is still loading it is undefined, and saying "這是
            第一個" then would be asserting something not yet known — so the
            labels only appear once the answer is in. */}
        {/* Nothing to go back to is a fact, not a disabled button: dressing it
            as one invited a click that could never do anything. */}
        {siblings?.prev ? (
          <Link className="btn ghost sm step" to={`/session/${siblings.prev.id}`}>
            ‹ 第 {siblings.prev.index} 週 ·{' '}
            {SESSION_KIND_LABEL[siblings.prev.kind ?? 'lecture']}
          </Link>
        ) : (
          siblings !== undefined && <span className="small muted step-end">這是第一個</span>
        )}
        {siblings?.next ? (
          <Link className="btn ghost sm step" to={`/session/${siblings.next.id}`}>
            第 {siblings.next.index} 週 ·{' '}
            {SESSION_KIND_LABEL[siblings.next.kind ?? 'lecture']} ›
          </Link>
        ) : (
          siblings !== undefined && <span className="small muted step-end">這是最後一個</span>
        )}
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
            {/* Spaced the same as every other count in the app. */}
            本週進度{planTotal > 0 ? ` ${planDone} / ${planTotal}` : ''}
          </button>
        </div>

        {showPlan && (
          <div className="ws-plan">
            <WeekPlanPanel sessionId={sessionId} courseId={session.courseId} compact />
          </div>
        )}

        {/* ── two panes, always ───────────────────────────────────
            The note editor is never conditional: a lecture you are not allowed
            to record, or a folder you have not set up yet, still needs somewhere
            to type. Only the left pane changes with the session's state. */}
        <div className="pane-tabs">
          <button
            className={`ptab${narrowPane === 'left' ? ' active' : ''}`}
            onClick={() => setNarrowPane('left')}
          >
            {hasTranscript ? `逐字稿 · ${segments.length} 句` : '錄音與上傳'}
          </button>
          <button
            className={`ptab${narrowPane === 'note' ? ' active' : ''}`}
            onClick={() => setNarrowPane('note')}
          >
            我的筆記
          </button>
        </div>

        <div className="panes" data-show={narrowPane}>
          <section className="pane">
            <div className="pane-head">
              <span className="grow">
                {showFiles
                  ? '這週的講義'
                  : hasTranscript
                    ? // 「段」 now means a recording, so the rows inside one are
                      // counted in 句 — two different things cannot share a word
                      // on the same screen.
                      `${recordings.length > 1 ? `第 ${partNo} 段 · ` : ''}逐字稿 · ${segments.length} 句`
                    : '錄音與上傳'}
              </span>
              {hasTranscript && !showFiles && (
                <>
                  {/* A mode you are in needs its way out on screen; the way in
                      does not, and eight controls across one strip left the
                      label itself nowhere to go. The rest live behind ⋯. */}
                  {editingTranscript || markingSpeakers ? (
                    <button
                      className="btn ghost sm active"
                      onClick={() => {
                        setEditingTranscript(false)
                        setMarkingSpeakers(false)
                      }}
                    >
                      {editingTranscript ? '完成編輯' : '標完了'}
                    </button>
                  ) : (
                    <>
                      {/* Both of these work on what is selected in the
                          transcript, and neither can while it is being edited:
                          the selection then lives inside a textarea, and their
                          preventDefault — there to keep the selection alive —
                          would also stop the edit in progress from being
                          committed on blur. */}
                      <button
                        className="btn ghost sm"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={quoteIntoNote}
                        title="把選取的句子引用到右邊的筆記，帶著它自己的時間"
                      >
                        引用到筆記
                      </button>
                      <button
                        className="btn ghost sm"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void addSelectionToGlossary()}
                        title="把選取的專有名詞加入這門課的詞彙表"
                      >
                        選取加入詞彙表
                      </button>
                      {/* Only worth offering once there is a choice to make. */}
                      {heard.length > 1 && (
                        <select
                          className="only-spk"
                          aria-label="只看某個人講的"
                          value={onlySpeaker}
                          onChange={(e) => setOnlySpeaker(e.target.value)}
                        >
                          <option value="">全部的人</option>
                          {heard.map((n) => (
                            <option key={n} value={n}>
                              只看 {n}
                            </option>
                          ))}
                        </select>
                      )}
                      <RowMenu
                        label="這份逐字稿"
                        actions={[
                          { label: '修正錯字', onSelect: () => setEditingTranscript(true) },
                          { label: '標記說話者', onSelect: () => setMarkingSpeakers(true) },
                          // For the weeks transcribed before 繁體 was guaranteed.
                          ...(hasChinese
                            ? [
                                {
                                  label: '轉成繁體中文',
                                  onSelect: () => void convertToTraditional(),
                                },
                              ]
                            : []),
                          // Nothing to follow without audio.
                          ...(audioUrl
                            ? [
                                {
                                  label: follow ? '播放時不要自動捲動' : '播放時自動捲到這一句',
                                  onSelect: () => setFollow((f) => !f),
                                },
                              ]
                            : []),
                          {
                            label:
                              recordings.length > 1
                                ? `第 ${partNo} 段：重轉、換音檔、刪除…`
                                : '重新轉錄、換音檔、刪除…',
                            onSelect: () => setRedo('again'),
                          },
                        ]}
                      />
                    </>
                  )}
                </>
              )}
              {/* Handouts stay reachable after transcription — the slides often
                  arrive later than the recording. */}
              <button
                className={`btn ghost sm${showFiles ? ' active' : ''}`}
                aria-pressed={showFiles}
                onClick={() => setShowFiles((v) => !v)}
              >
                {showFiles ? '返回' : `講義${fileCount > 0 ? ` ${fileCount}` : ''}`}
              </button>
            </div>

            {glossaryNote && <div className="pane-flash">{glossaryNote}</div>}

            {/* The parts of this week, and the way to add one. With a single
                recording there is nothing to switch between, so only the way to
                add the second one is shown — a strip reading「第 1 段」beside
                nothing else is a row of furniture. */}
            {!showFiles && recordings.length > 0 && (
              <div className="parts" role="tablist" aria-label="這一週的錄音">
                {recordings.length > 1 &&
                  recordings.map((r, i) => {
                    const done = transcripts.some((t) => t.recordingId === r.id)
                    const here = r.id === recording?.id
                    return (
                      <button
                        key={r.id}
                        type="button"
                        role="tab"
                        aria-selected={here}
                        className={`part${here ? ' is-here' : ''}`}
                        onClick={() => setPartId(r.id)}
                      >
                        第 {i + 1} 段
                        <span className="small muted">
                          {formatDuration(r.durationSec)}
                          {done ? '' : ' · 未轉錄'}
                        </span>
                      </button>
                    )
                  })}
                <span className="spacer" />
                <label className={`btn ghost sm${busy ? ' is-off' : ''}`}>
                  ＋ 再加一段錄音
                  <input
                    type="file"
                    accept="audio/*,video/mp4,.m4a,.mp3,.wav,.ogg,.webm,.mp4"
                    style={{ display: 'none' }}
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      // No `replaces`: this one joins the week rather than
                      // taking another's place.
                      if (file) void handleFile(file)
                    }}
                  />
                </label>
              </div>
            )}

            <div className="pane-body" ref={listRef}>
              {showFiles ? (
                course && (
                  <div style={{ padding: '.9rem' }}>
                    <AttachmentList
                      scope="session"
                      ownerId={sessionId}
                      courseId={course.id}
                      kinds={['handout', 'reading', 'other']}
                      title="這週的講義"
                      hint="老師這週發的投影片或補充資料。PDF 可以直接在這裡讀。"
                    />
                  </div>
                )
              ) : hasTranscript ? (
                <div className="tx-list">
                  {segments.map((seg, i) => {
                    // Filtering hides lines rather than renumbering them: the
                    // index is what every other part of this page addresses.
                    if (onlySpeaker && speaking[i] !== onlySpeaker) return null
                    return (
                      <div
                        key={i}
                        data-seg={i}
                        className={`tx-seg${i === activeIndex ? ' active' : ''}`}
                        onClick={() => {
                          if (editingTranscript) return
                          // A drag that ends here is a selection, not a request
                          // to jump: seeking would start playing and scroll the
                          // list out from under what was just selected.
                          if (!window.getSelection()?.isCollapsed) return
                          seek(seg.start)
                        }}
                      >
                        <span className="tx-time">{formatTime(seg.start)}</span>
                        {markingSpeakers ? (
                          <SpeakerPicker
                            roster={roster}
                            value={speaking[i]}
                            marked={Boolean(seg.speaker)}
                            suggested={looksLikeTurn(segments, i)}
                            onPick={(name) => void setSpeakerAt(i, name)}
                          />
                        ) : (
                          seg.speaker && <span className="tx-who">{seg.speaker}</span>
                        )}
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
                    )
                  })}
                </div>
              ) : (
                <div style={{ padding: '1.1rem .9rem 2rem' }}>
                  {storageReady === false && (
                    <div className="notice warn" style={{ marginBottom: '1rem' }}>
                      還沒設定儲存位置，錄音與轉錄都無法開始。請先到 <Link to="/settings">設定</Link>{' '}
                      指定一個本機資料夾。筆記不受影響，右邊照樣可以寫。
                    </div>
                  )}

                  {busy ? (
                    <div className="card">
                      <h2>處理中</h2>
                      <p className="small muted" style={{ margin: '.4rem 0 .9rem' }}>
                        {progress?.stage ?? '準備中'}
                        {progress && progress.total > 0
                          ? `（${progress.done} / ${progress.total}）`
                          : ''}
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
                  ) : recording ? (
                    // Audio on disk with nothing transcribed from it: offering
                    // the recorder here would quietly start a third part, when
                    // what is missing is a transcript for the one already here.
                    <div className="card">
                      <h2>這一段還沒有逐字稿</h2>
                      <p className="small muted" style={{ margin: '.4rem 0 .9rem' }}>
                        {recording.fileName} · {formatDuration(recording.durationSec)} 已經在你的資料夾裡。
                        轉錄可能是中途取消，或是額度不夠停下來了。
                      </p>
                      <button className="btn primary" onClick={() => void transcribeAgain()}>
                        轉錄這一段
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
                        className={`dropzone${dragOver ? ' over' : ''}${
                          storageReady === false ? ' is-disabled' : ''
                        }`}
                        onDragOver={(e) => {
                          e.preventDefault()
                          if (storageReady !== false) setDragOver(true)
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault()
                          setDragOver(false)
                          // The click path is disabled by the input; a drop has to
                          // be refused here, or the file is encoded in full before
                          // failing at the write.
                          if (storageReady === false) return
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
                        <strong>
                          {storageReady === false ? '設定儲存位置後才能上傳' : '或上傳已經錄好的檔案'}
                        </strong>
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
                </div>
              )}
            </div>

            {/* Only when there is something to play. A transcript imported
                without its audio used to get an empty 0:00 / 0:00 player
                holding the foot of the pane and doing nothing. */}
            {hasTranscript && (audioMissing || audioUrl) && (
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
                      onLoadedMetadata={(e) => {
                        e.currentTarget.playbackRate = playbackRate
                        e.currentTarget.preservesPitch = true
                      }}
                    />
                    <span className="clock">{formatTime(currentTime)}</span>
                    {/* The browser hides its own speed menu three clicks deep
                        and forgets it on the next file. Three hours of lecture
                        at 1.5× is an hour saved every week. */}
                    <select
                      className="rate"
                      aria-label="播放速度"
                      title="播放速度"
                      value={playbackRate}
                      onChange={(e) => void saveSettings({ playbackRate: Number(e.target.value) })}
                    >
                      {PLAYBACK_RATES.map((r) => (
                        <option key={r} value={r}>
                          {r}×
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )}
            {hasTranscript && !audioMissing && !audioUrl && (
              <div className="player">
                <span className="small muted">
                  這一週只有逐字稿，沒有音檔——時間戳按了不會跳。
                </span>
              </div>
            )}
          </section>

          <section className="pane">
            <div className="pane-head">
              <span className="grow">
                我的筆記
                <span className="small muted" style={{ marginLeft: '.5rem' }}>
                  輸入「/」開啟指令選單
                </span>
              </span>
              {outline.entries.length > 0 && (
                <button
                  className={`btn ghost sm${showOutline ? ' primary' : ''}`}
                  onClick={() => setShowOutline((v) => !v)}
                  title="這份筆記的大綱與標記"
                >
                  大綱 {outline.entries.length}
                </button>
              )}
              {hasTranscript && (
                <button
                  className="btn ghost sm"
                  onClick={stampNow}
                  title="插入目前播放時間"
                >
                  插入時間戳 {keyLabel('Alt-t')}
                </button>
              )}
            </div>
            <div className="pane-body">
              {showOutline && (
                <div className="note-outline">
                  {outline.entries.map((e) => {
                    // The section you are in is the last one that starts above
                    // the cursor — headings do not record where they end.
                    const active =
                      e.line ===
                      outline.entries.reduce(
                        (best, cur) => (cur.line <= outline.line ? cur.line : best),
                        0,
                      )
                    return (
                      <button
                        key={`${e.line}-${e.text}`}
                        className={`outline-row${active ? ' is-here' : ''} ${
                          e.kind === 'mark' ? `is-mark is-${e.mark}` : `is-h${e.level}`
                        }`}
                        onClick={() => {
                          editorRef.current?.goToLine(e.line)
                          setShowOutline(false)
                        }}
                      >
                        {e.kind === 'mark' && <span className="outline-tag">{e.mark}</span>}
                        <span className="outline-text">{e.text || '（未命名）'}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {note !== undefined && (
                <NoteEditor
                  key={sessionId}
                  ref={editorRef}
                  initialValue={note?.markdown ?? ''}
                  onChange={onNoteChange}
                  onSeek={seekPart}
                  onStampRequested={stampNow}
                  context={{
                    now: () => (hasTranscript ? currentTime : null),
                    transcriptQuote,
                    attachFile,
                  }}
                  onOutline={(entries, line) => setOutline({ entries, line })}
                />
              )}
            </div>
          </section>
        </div>
      </div>

      {redo && (
        <Modal
          title={recordings.length > 1 ? `第 ${partNo} 段錄音` : '這份逐字稿'}
          onClose={() => setRedo(null)}
          submitLabel={undefined}
        >
          <p className="small muted" style={{ margin: '0 0 .9rem' }}>
            以下三個動作都<strong>只影響逐字稿與音檔</strong>——你的筆記和本週進度會原封不動留著。
            {recordings.length > 1 && `這一週有 ${recordings.length} 段錄音，動到的只有第 ${partNo} 段。`}
          </p>
          <div className="stack">
            <button
              className="btn"
              disabled={!recording}
              onClick={() => {
                setRedo(null)
                void transcribeAgain()
              }}
            >
              用同一個音檔再轉一次
              <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>
                語言或模型設定改過之後用這個。會再花一次額度。
              </span>
            </button>
            <label className="btn">
              換一個音檔重新轉錄
              <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>
                錄錯了、或找到更清楚的一份錄音。
              </span>
              <input
                type="file"
                accept="audio/*,video/mp4,.m4a,.mp3,.wav,.ogg,.webm,.mp4"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  setRedo(null)
                  void (async () => {
                    if (recording) {
                      await db.transcripts.where('recordingId').equals(recording.id).delete()
                    }
                    await handleFile(file, recording?.id)
                  })()
                }}
              />
            </label>
            <button
              className="btn danger"
              onClick={async () => {
                setRedo(null)
                setPartId(null)
                if (recording && recordings.length > 1) await deletePart(recording.id)
                else await deleteTranscription(sessionId)
              }}
            >
              {recordings.length > 1 ? `刪除第 ${partNo} 段` : '刪除逐字稿與音檔'}
              <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>
                {recordings.length > 1
                  ? '其他幾段錄音留著。筆記與本週進度也保留。'
                  : '回到還沒錄音的狀態。筆記與本週進度保留。'}
              </span>
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
