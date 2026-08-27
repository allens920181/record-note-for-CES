import Dexie from 'dexie'
import type { EntityTable } from 'dexie'
import { newId } from '../lib/id'
import { deleteFile, deleteDir } from '../storage/fsRoot'
import { DEFAULT_SETTINGS } from './schema'
import type {
  AppSettings,
  Attachment,
  ClassSlot,
  Course,
  Note,
  Recording,
  RecordingDraft,
  Session,
  Term,
  Transcript,
  TranscribeJob,
} from './schema'

export type {
  AppSettings,
  Attachment,
  ClassSlot,
  Course,
  Note,
  Recording,
  RecordingDraft,
  Session,
  Term,
  Transcript,
  TranscribeJob,
}

class NotesDB extends Dexie {
  terms!: EntityTable<Term, 'id'>
  courses!: EntityTable<Course, 'id'>
  sessions!: EntityTable<Session, 'id'>
  recordings!: EntityTable<Recording, 'id'>
  transcripts!: EntityTable<Transcript, 'id'>
  notes!: EntityTable<Note, 'id'>
  jobs!: EntityTable<TranscribeJob, 'id'>
  settings!: EntityTable<AppSettings, 'id'>
  attachments!: EntityTable<Attachment, 'id'>
  drafts!: EntityTable<RecordingDraft, 'id'>

  constructor() {
    super('record-note-for-ces')
    this.version(1).stores({
      terms: 'id, createdAt, archived',
      courses: 'id, termId, createdAt',
      sessions: 'id, courseId, index, date',
      recordings: 'id, sessionId, createdAt',
      transcripts: 'id, sessionId, recordingId',
      notes: 'id, sessionId',
      jobs: 'id, recordingId, sessionId, status',
      settings: 'id',
    })
    // Later versions list only what changed; Dexie carries the rest forward.
    this.version(2).stores({
      attachments: 'id, scope, ownerId, courseId, createdAt',
      drafts: 'id, sessionId, updatedAt',
    })
  }
}

export const db = new NotesDB()

// ── settings ──────────────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  const found = await db.settings.get('app')
  // Spread over the defaults so a schema addition doesn't read as undefined
  // on a database written by an older build.
  return { ...DEFAULT_SETTINGS, ...found, id: 'app' }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const current = await getSettings()
  await db.settings.put({ ...current, ...patch, id: 'app' })
}

// ── terms ─────────────────────────────────────────────────────────────

export async function createTerm(input: {
  name: string
  startDate: string
  endDate: string
  weeks: number
}): Promise<string> {
  const id = newId('term')
  await db.terms.add({ ...input, id, archived: false, createdAt: Date.now() })
  return id
}

/** Removes a term along with every course, session and artifact beneath it. */
export async function deleteTermCascade(termId: string): Promise<void> {
  const courses = await db.courses.where('termId').equals(termId).toArray()
  await Promise.all(courses.map((c) => deleteCourseCascade(c.id)))
  await db.terms.delete(termId)
}

// ── courses ───────────────────────────────────────────────────────────

export async function createCourse(input: {
  termId: string
  name: string
  teacher: string
  code: string
  credits: number
  color: string
}): Promise<string> {
  const id = newId('course')
  await db.courses.add({ ...input, id, slots: [], glossary: [], createdAt: Date.now() })
  return id
}

export async function deleteCourseCascade(courseId: string): Promise<void> {
  const sessions = await db.sessions.where('courseId').equals(courseId).toArray()
  await Promise.all(sessions.map((s) => deleteSessionCascade(s.id)))
  const courseFiles = await db.attachments.where('courseId').equals(courseId).toArray()
  await Promise.all(courseFiles.map((a) => deleteFile(a.storageKey)))
  await db.attachments.where('courseId').equals(courseId).delete()
  await db.courses.delete(courseId)
}

// ── sessions ──────────────────────────────────────────────────────────

/**
 * Appends the next week to a course. The date is stepped a week on from the
 * last session so a run of weekly classes fills in with one click each;
 * Phase 2 replaces this with generation from the course timetable.
 */
export async function appendSession(courseId: string): Promise<string> {
  const existing = await db.sessions.where('courseId').equals(courseId).sortBy('index')
  const last = existing[existing.length - 1]
  const index = last ? last.index + 1 : 1
  const date = last ? addDays(last.date, 7) : todayISO()
  const id = newId('sess')
  await db.sessions.add({
    id,
    courseId,
    index,
    date,
    topic: '',
    canceled: false,
    createdAt: Date.now(),
  })
  return id
}

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** The first date on or after `iso` that falls on the given weekday. */
export function nextWeekdayOnOrAfter(iso: string, weekday: number): string {
  const d = new Date(`${iso}T00:00:00`)
  const shift = (weekday - d.getDay() + 7) % 7
  d.setDate(d.getDate() + shift)
  return d.toISOString().slice(0, 10)
}

export interface GenerateResult {
  created: number
  skipped: number
}

/**
 * Fills a course with one session per teaching week, dated from its timetable.
 *
 * One session per week rather than per meeting: the whole point of the weekly
 * file is that a week's material lives in one place. A course that meets twice
 * a week can still get a second file from "新增週次".
 *
 * Weeks that already have a session on the same date are left alone, so this is
 * safe to run again after adding a slot or extending the term.
 */
export async function generateSessionsFromTimetable(courseId: string): Promise<GenerateResult> {
  const course = await db.courses.get(courseId)
  if (!course) throw new Error('找不到這門課')
  if (course.slots.length === 0) throw new Error('這門課還沒設定上課時段')
  const term = await db.terms.get(course.termId)
  if (!term) throw new Error('找不到這門課所屬的學期')

  // Anchor on the earliest weekday in the week so dates run in teaching order.
  const weekday = [...course.slots].sort((a, b) => a.weekday - b.weekday)[0].weekday
  const firstDate = nextWeekdayOnOrAfter(term.startDate, weekday)

  const existing = await db.sessions.where('courseId').equals(courseId).toArray()
  const takenDates = new Set(existing.map((s) => s.date))
  let nextIndex = existing.reduce((max, s) => Math.max(max, s.index), 0)

  const rows: Session[] = []
  for (let week = 0; week < term.weeks; week++) {
    const date = addDays(firstDate, week * 7)
    if (takenDates.has(date)) continue
    rows.push({
      id: newId('sess'),
      courseId,
      index: ++nextIndex,
      date,
      topic: '',
      canceled: false,
      createdAt: Date.now(),
    })
  }

  if (rows.length > 0) await db.sessions.bulkAdd(rows)
  return { created: rows.length, skipped: term.weeks - rows.length }
}

/** Renumbers a course's sessions by date so "第 N 週" stays in teaching order. */
export async function renumberSessions(courseId: string): Promise<void> {
  const sessions = await db.sessions.where('courseId').equals(courseId).toArray()
  sessions.sort((a, b) => a.date.localeCompare(b.date))
  await Promise.all(
    sessions.map((s, i) => (s.index === i + 1 ? undefined : db.sessions.update(s.id, { index: i + 1 }))),
  )
}

export async function deleteSessionCascade(sessionId: string): Promise<void> {
  // Drop the bytes on disk first; a row without its file is recoverable noise,
  // a file without its row is invisible and never gets cleaned up.
  const [attachments, recordings, drafts] = await Promise.all([
    db.attachments.where({ scope: 'session', ownerId: sessionId }).toArray(),
    db.recordings.where('sessionId').equals(sessionId).toArray(),
    db.drafts.where('sessionId').equals(sessionId).toArray(),
  ])
  await Promise.all([
    ...attachments.map((a) => deleteFile(a.storageKey)),
    ...recordings.map((r) => deleteFile(r.storageKey)),
    ...drafts.map((d) => deleteDir(d.dir)),
  ])

  await db.attachments.where({ scope: 'session', ownerId: sessionId }).delete()
  await db.drafts.where('sessionId').equals(sessionId).delete()
  await db.transcripts.where('sessionId').equals(sessionId).delete()
  await db.recordings.where('sessionId').equals(sessionId).delete()
  await db.jobs.where('sessionId').equals(sessionId).delete()
  await db.notes.where('sessionId').equals(sessionId).delete()
  await db.sessions.delete(sessionId)
}

// ── notes ─────────────────────────────────────────────────────────────

export async function saveNote(sessionId: string, markdown: string): Promise<void> {
  await db.notes.put({ id: sessionId, sessionId, markdown, updatedAt: Date.now() })
}

// ── dates ─────────────────────────────────────────────────────────────

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
