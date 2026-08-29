// Data model: Term → Course → Session, with recordings/transcripts/notes hanging
// off a session. Ids are strings so records can be exported and re-imported
// across machines without renumbering.

/**
 * A timetable slot is a *recurring meeting* — the thing that repeats every week
 * and turns into weekly files. Study time is deliberately not a slot kind: it
 * produces no file, and it often isn't weekly, so it lives in its own store.
 */
export type MeetingKind = 'lecture' | 'discussion'

export const MEETING_KIND_LABEL: Record<MeetingKind, string> = {
  lecture: '正課',
  discussion: '分組討論',
}

/** Declared order — a week's lecture is listed before the discussion that follows it. */
export const MEETING_KINDS: MeetingKind[] = ['lecture', 'discussion']

export interface ClassSlot {
  weekday: number // 0 = Sunday
  start: string // "19:00"
  end: string // "22:00"
  room?: string
  /** Absent on slots created before kinds existed; treat those as lectures. */
  kind?: MeetingKind
}

/**
 * Time set aside for coursework. Never a meeting, never recorded — it exists so
 * the assignment planner can answer "how many hours do I actually have left
 * before this is due".
 *
 * Two shapes, because study time is not reliably weekly: a standing block every
 * Sunday afternoon, or one Saturday put aside for a particular paper.
 */
export type Recurrence = 'weekly' | 'once'

export interface WorkBlock {
  id: string
  courseId: string
  repeat: Recurrence
  /** Set when repeat is 'weekly'. */
  weekday?: number
  /** Set when repeat is 'once'. */
  date?: string
  start: string
  end: string
  note?: string
  createdAt: number
}

/**
 * A term is two dates. It used to carry a `weeks` count as well, typed in
 * beside them, which let all three disagree — and everything that matters (a
 * session's 第 N 週, how far the generator runs) is measured from the dates.
 * The count is now read off them: see `weeksBetween`.
 */
export interface Term {
  id: string
  name: string
  startDate: string // ISO yyyy-mm-dd
  endDate: string
  archived: boolean
  createdAt: number
}

/**
 * A line of a grading table, from a version that had one. Kept only so the data
 * can be folded into `rules` on first sight; nothing writes it any more.
 */
export interface GradeItem {
  id: string
  label: string
  weight: number
  assignmentId?: string
  note?: string
}

/**
 * What the course asks of you, taken off the syllabus by hand. The syllabus PDF
 * is still uploaded and readable, but "報告幾頁、引註用什麼格式、遲交扣幾分" is
 * looked up mid-task, and opening a PDF to find it every time is the friction
 * this removes.
 *
 * One block of text, not a schema: what gets looked up is a sentence, and
 * fields you have to fill in are fields someone then has to read back.
 */
export interface CourseRequirements {
  /** @deprecated folded into `rules`; see RequirementsPanel. */
  grading: GradeItem[]
  rules: string
}

export const EMPTY_REQUIREMENTS: CourseRequirements = { grading: [], rules: '' }

/**
 * Whether a course has to be taken.
 *
 * Left unset rather than defaulted: a course you have not decided about, or
 * one from a school that does not divide them this way, should not be labelled
 * 選修 by the app's own guess.
 */
export type CourseKind = 'required' | 'elective'

export const COURSE_KIND_LABEL: Record<CourseKind, string> = {
  required: '必修',
  elective: '選修',
}

export const COURSE_KINDS: CourseKind[] = ['required', 'elective']

export interface Course {
  id: string
  termId: string
  name: string
  teacher: string
  code: string
  credits: number
  color: string
  /** 必修 or 選修. Absent on courses created before this existed, and on any
      the reader has not said. */
  kind?: CourseKind
  slots: ClassSlot[]
  /** Terms fed to the transcription model so it spells them right. */
  glossary: string[]
  /**
   * Who talks in this course — the names offered when marking up a transcript.
   * Absent on courses created before speakers existed; read it as an empty list.
   */
  speakers?: string[]
  /** Absent on courses created before requirements existed. */
  requirements?: CourseRequirements
  createdAt: number
}

/** A session is always a meeting; study time never becomes one. */
/**
 * A block that holds notes but is not a meeting: a discussion write-up you keep
 * beside the week it belongs to, a log of how an assignment went. They carry no
 * clock time and never reach the calendar — nothing happens at a given hour.
 */
export type NoteKind = 'log' | 'memo'

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  log: '作業紀錄',
  memo: '其他筆記',
}

export const NOTE_KINDS: NoteKind[] = ['log', 'memo']

export type SessionKind = MeetingKind | NoteKind

/** Whether a session is a meeting — the calendar and the recorder only want those. */
export function isMeeting(kind: SessionKind | undefined): kind is MeetingKind {
  return kind === undefined || kind === 'lecture' || kind === 'discussion'
}

export const SESSION_KIND_LABEL: Record<SessionKind, string> = {
  ...MEETING_KIND_LABEL,
  ...NOTE_KIND_LABEL,
}

export interface Session {
  id: string
  courseId: string
  /**
   * Teaching week number, counted from the term's start date. Several sessions
   * can share one — a week with both a lecture and a discussion has two files
   * that are both "第 3 週".
   */
  index: number
  date: string // ISO yyyy-mm-dd
  /** Clock times, so the calendar can place the meeting rather than guess. */
  start?: string // "19:00"
  end?: string // "22:00"
  room?: string
  topic: string
  canceled: boolean
  /** Absent on sessions created before kinds existed; treat those as lectures. */
  kind?: SessionKind
  /**
   * Where this block sits among the others sharing its date. Absent on
   * meetings, which fall back to the order their kinds are declared in — so a
   * block inserted between a lecture (0) and its discussion (1) takes 0.5 and
   * lands exactly where it was dropped, with nothing to migrate.
   */
  seq?: number
  createdAt: number
}

export interface Recording {
  id: string
  sessionId: string
  fileName: string
  /** Path inside the chosen local folder, relative to its root. */
  storageKey: string
  mimeType: string
  bytes: number
  durationSec: number
  createdAt: number
}

export interface TranscriptSegment {
  start: number // seconds from the start of the recording
  end: number
  text: string
  /**
   * Who starts speaking here.
   *
   * Set only on the line where a turn begins; every line after it belongs to
   * the same person until the next one that names someone. A lecture is one
   * person talking for forty minutes, so marking each line would be forty
   * copies of the same fact — and re-marking the lot every time a line is split
   * or corrected.
   *
   * The transcription service does not tell us this: the OpenAI-compatible
   * `/audio/transcriptions` endpoint has no speaker output at all. It is put
   * here by hand, helped by the gaps in the audio.
   */
  speaker?: string
}

export interface Transcript {
  id: string
  sessionId: string
  recordingId: string
  model: string
  language: string
  segments: TranscriptSegment[]
  createdAt: number
  updatedAt: number
}

export interface Note {
  /** One note per session, so the note id is the session id. */
  id: string
  sessionId: string
  markdown: string
  updatedAt: number
}

export type AttachmentScope = 'course' | 'session'
export type AttachmentKind = 'syllabus' | 'handout' | 'reading' | 'other'

export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = {
  syllabus: '教學大綱',
  handout: '講義',
  reading: '閱讀材料',
  other: '其他',
}

export interface Attachment {
  id: string
  scope: AttachmentScope
  /** courseId when scope is 'course', sessionId when it is 'session'. */
  ownerId: string
  /** Denormalised so a course can list everything beneath it in one index hit. */
  courseId: string
  fileName: string
  storageKey: string
  mimeType: string
  bytes: number
  kind: AttachmentKind
  /** Text pulled out of the PDF, kept for the cross-week search in Phase 3. */
  text?: string
  pageCount?: number
  createdAt: number
}

/**
 * An in-progress recording. Parts land on disk as they arrive, so a tab that
 * crashes mid-lecture leaves a recoverable trail rather than nothing.
 */
export interface RecordingDraft {
  id: string
  sessionId: string
  /** Directory under the storage root holding the part-NNN files. */
  dir: string
  parts: number
  mimeType: string
  startedAt: number
  updatedAt: number
}

export type AssignmentStatus = 'todo' | 'doing' | 'done'

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  todo: '未開始',
  doing: '進行中',
  done: '已完成',
}

export interface SubTask {
  id: string
  title: string
  done: boolean
  /** Rough hours this step will take, used against available study time. */
  estimateHours?: number
}

export interface Assignment {
  id: string
  courseId: string
  title: string
  /** ISO yyyy-mm-dd. */
  due: string
  /** "HH:MM" when the deadline is a specific time of day. */
  dueTime?: string
  status: AssignmentStatus
  /** Free text: the brief, the required word count, the citation style. */
  notes: string
  subtasks: SubTask[]
  /** The week this assignment came out of, if any. */
  sessionId?: string
  createdAt: number
  updatedAt: number
}

/** Common shapes of seminary work, offered when breaking an assignment down. */
export const SUBTASK_TEMPLATES: Array<{ name: string; steps: string[] }> = [
  {
    name: '期末報告',
    steps: ['選題與範圍', '找文獻', '擬大綱', '寫初稿', '修改與引註'],
  },
  { name: '讀書報告', steps: ['讀完指定章節', '整理重點', '寫回應', '校對'] },
  { name: '講道稿', steps: ['釋經', '大綱', '寫講章', '練講'] },
]

export type ReadingStatus = 'unread' | 'reading' | 'read'

export const READING_STATUS_LABEL: Record<ReadingStatus, string> = {
  unread: '未讀',
  reading: '讀到一半',
  read: '已讀完',
}

export interface Reading {
  id: string
  courseId: string
  title: string
  author?: string
  /** Free text: "第三卷 21–24 章" reads better than a page range alone. */
  chapters?: string
  totalPages?: number
  pagesRead?: number
  status: ReadingStatus
  /** The week this reading is assigned for. */
  sessionId?: string
  /** A PDF already uploaded to this course. */
  attachmentId?: string
  notes: string
  createdAt: number
}

/**
 * What you mean to do for one course in one week, and how far you got.
 *
 * Distinct from an assignment's subtasks, which are steps toward one deliverable
 * with one deadline. This is the week itself: read the chapters before class,
 * tidy the notes after it, keep chipping at the paper due next month. Those are
 * the things that quietly slip, because nothing is due on Thursday.
 */
export interface PlanItem {
  id: string
  title: string
  done: boolean
  /** Rough hours, so a week can be weighed against the study time set aside. */
  hours?: number
  /** Set when the item came from the reading list, so progress can flow back. */
  readingId?: string
}

export interface WeekPlan {
  /** One plan per session, so the plan id is the session id. */
  id: string
  sessionId: string
  courseId: string
  items: PlanItem[]
  updatedAt: number
}

/** Offered when a week's plan is still empty. */
export const PLAN_TEMPLATES: Array<{ name: string; steps: string[] }> = [
  { name: '一般週', steps: ['讀完指定閱讀', '課後整理筆記', '複習上週逐字稿'] },
  { name: '報告週', steps: ['讀完指定閱讀', '寫作業：這一段', '課後整理筆記'] },
  { name: '考前週', steps: ['複習逐字稿', '整理重點', '背誦原文詞彙'] },
]

/** One fix the reader made to a transcript line, kept so it can teach the glossary. */
export interface Correction {
  id: string
  courseId: string
  sessionId: string
  before: string
  after: string
  /** "聞→文" — identical fixes made twice are strong evidence of a real term. */
  key: string
  /** The term taken from this fix, once one has been chosen or inferred. */
  resolvedTerm?: string
  /** Set when the reader decided this fix carries no vocabulary. */
  dismissed?: boolean
  createdAt: number
}

/** One transcription request, for tracking usage against the free tier. */
export interface UsageEntry {
  id: string
  at: number
  /** Seconds of audio sent in this request. */
  seconds: number
  model: string
  ok: boolean
}

/** Groq's free tier, which is what the app targets by default. */
export const FREE_TIER = {
  secondsPerDay: 28_800,
  secondsPerHour: 7_200,
  requestsPerDay: 2_000,
  requestsPerMinute: 20,
}

export type JobStatus = 'pending' | 'preparing' | 'transcribing' | 'done' | 'error'

export interface TranscribeJob {
  id: string
  recordingId: string
  sessionId: string
  status: JobStatus
  /** Human-readable current step, shown in the UI. */
  stage: string
  totalChunks: number
  doneChunks: number
  error?: string
  createdAt: number
  updatedAt: number
}

export interface AppSettings {
  id: 'app'
  sttBaseUrl: string
  sttApiKey: string
  sttModel: string
  /** ISO-639-1, or '' to let the model auto-detect. */
  language: string
  /** Applies to every course, on top of each course's own glossary. */
  globalGlossary: string[]
  /** Target bitrate for the opus copy we send for transcription. */
  audioBitrateKbps: number
  /**
   * How fast recordings play back. Kept here rather than per recording: someone
   * who listens at 1.5× listens to every week at 1.5×, and having to set it
   * again on each file is the whole annoyance.
   */
  playbackRate: number
  /**
   * When "測試連線" last succeeded, as an ISO date. A non-empty key is not the
   * same as a working one — a typo, a revoked key and a key for the wrong
   * provider all look identical until something is actually sent — so setup is
   * only counted as done once a request has come back.
   */
  sttVerifiedAt?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  // Groq speaks the OpenAI transcription API, so swapping providers is a URL change.
  sttBaseUrl: 'https://api.groq.com/openai/v1',
  sttApiKey: '',
  sttModel: 'whisper-large-v3',
  language: 'zh',
  globalGlossary: [],
  audioBitrateKbps: 32,
  playbackRate: 1,
}

/**
 * The speeds on offer. Whole steps a reader can aim at with one glance —
 * a continuous slider invites 1.37× and then forgetting it is set.
 */
/**
 * A gap this long between two lines is where a turn usually changes hands — a
 * question from the room, the teacher picking back up. Only a suggestion: it
 * puts a hint where marking is likely to be wanted, and marks nothing itself.
 */
export const TURN_GAP_SECONDS = 1.5

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const

export const COURSE_COLORS = [
  '#1F6F5C',
  '#8A5D0F',
  '#3E5A8A',
  '#7A3B6B',
  '#2F6B7A',
  '#7A4B2F',
] as const
