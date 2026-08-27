// Data model: Term → Course → Session, with recordings/transcripts/notes hanging
// off a session. Ids are strings so records can be exported and re-imported
// across machines without renumbering.

export interface ClassSlot {
  weekday: number // 0 = Sunday
  start: string // "19:00"
  end: string // "22:00"
  room?: string
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
  createdAt: number
}

export interface Session {
  id: string
  courseId: string
  index: number // 第 N 週
  date: string // ISO yyyy-mm-dd
  topic: string
  canceled: boolean
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
