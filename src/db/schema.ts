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

export interface Term {
  id: string
  name: string
  startDate: string // ISO yyyy-mm-dd
  endDate: string
  weeks: number
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

export interface Course {
  id: string
  termId: string
  name: string
  teacher: string
  code: string
  credits: number
  color: string
  slots: ClassSlot[]
  /** Terms fed to the transcription model so it spells them right. */
  glossary: string[]
  /** Absent on courses created before requirements existed. */
  requirements?: CourseRequirements
  createdAt: number
}

/** A session is always a meeting; study time never becomes one. */
export type SessionKind = MeetingKind
export const SESSION_KIND_LABEL = MEETING_KIND_LABEL

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
}

export const COURSE_COLORS = [
  '#1F6F5C',
  '#8A5D0F',
  '#3E5A8A',
  '#7A3B6B',
  '#2F6B7A',
  '#7A4B2F',
] as const
