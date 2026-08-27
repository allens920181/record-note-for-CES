import Dexie from 'dexie'
import type { EntityTable } from 'dexie'
import { newId } from '../lib/id'
import { deleteFile, deleteDir } from '../storage/fsRoot'
import { DEFAULT_SETTINGS, isMeetingKind } from './schema'
import type {
  AppSettings,
  Attachment,
  ClassSlot,
  SessionKind,
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
  SessionKind,
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
 * Adds one more meeting to a course, a week on from the latest one. Useful for
 * a one-off extra session; the timetable generator covers the regular run.
 */
export async function appendSession(
  courseId: string,
  kind: SessionKind = 'lecture',
): Promise<string> {
  const existing = await db.sessions.where('courseId').equals(courseId).toArray()
  existing.sort((a, b) => a.date.localeCompare(b.date))
  const last = existing[existing.length - 1]
  const date = last ? addDays(last.date, 7) : todayISO()

  const course = await db.courses.get(courseId)
  const term = course ? await db.terms.get(course.termId) : undefined
  const index = term ? weekNumberOf(term.startDate, date) : (last?.index ?? 0) + 1

  const id = newId('sess')
  await db.sessions.add({
    id,
    courseId,
    index,
    date,
    topic: '',
    canceled: false,
    kind,
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
  /** Work-time slots are scheduled but produce no file; reported so the UI can say so. */
  workSlots: number
}

/**
 * Which teaching week a date falls in, counted in 7-day windows from the term's
 * start. Two meetings in the same window share a number, so a week with both a
 * lecture and a discussion yields two files that are both "第 N 週".
 */
export function weekNumberOf(termStart: string, date: string): number {
  const start = new Date(`${termStart}T00:00:00`).getTime()
  const at = new Date(`${date}T00:00:00`).getTime()
  const days = Math.floor((at - start) / 86_400_000)
  return Math.max(1, Math.floor(days / 7) + 1)
}

/**
 * Expands a course's timetable into weekly files.
 *
 * One file per meeting, not per week: a course with a lecture on Wednesday and
 * a group discussion on Monday holds two separate recordings that week, and two
 * recordings cannot share one timeline. Both carry the same week number.
 *
 * Work-time slots are skipped entirely — that is time set aside for coursework,
 * not a meeting to record.
 *
 * A meeting that already exists on the same date and of the same kind is left
 * alone, so this is safe to run again after adding a slot or extending a term.
 */
export async function generateSessionsFromTimetable(courseId: string): Promise<GenerateResult> {
  const course = await db.courses.get(courseId)
  if (!course) throw new Error('找不到這門課')
  const meetingSlots = course.slots.filter((s) => isMeetingKind(s.kind))
  const workSlots = course.slots.length - meetingSlots.length
  if (meetingSlots.length === 0) {
    throw new Error(
      workSlots > 0
        ? '這門課只設了作業時間。作業時間不會產生週次檔案，請至少加一個正課或分組討論的時段。'
        : '這門課還沒設定上課時段',
    )
  }
  const term = await db.terms.get(course.termId)
  if (!term) throw new Error('找不到這門課所屬的學期')

  const existing = await db.sessions.where('courseId').equals(courseId).toArray()
  const taken = new Set(existing.map((s) => `${s.date}|${s.kind ?? 'lecture'}`))

  const rows: Session[] = []
  for (const slot of meetingSlots) {
    const kind: SessionKind = slot.kind === 'discussion' ? 'discussion' : 'lecture'
    const first = nextWeekdayOnOrAfter(term.startDate, slot.weekday)
    for (let week = 0; week < term.weeks; week++) {
      const date = addDays(first, week * 7)
      const key = `${date}|${kind}`
      if (taken.has(key)) continue
      taken.add(key)
      rows.push({
        id: newId('sess'),
        courseId,
        index: weekNumberOf(term.startDate, date),
        date,
        topic: '',
        canceled: false,
        kind,
        createdAt: Date.now(),
      })
    }
  }

  if (rows.length > 0) await db.sessions.bulkAdd(rows)
  const wanted = meetingSlots.length * term.weeks
  return { created: rows.length, skipped: wanted - rows.length, workSlots }
}

/**
 * Recomputes "第 N 週" from each session's date, so the numbering survives a
 * deletion or a manually added meeting. Sessions in the same 7-day window from
 * the term's start share a number by design.
 */
export async function renumberSessions(courseId: string): Promise<void> {
  const course = await db.courses.get(courseId)
  const term = course ? await db.terms.get(course.termId) : undefined
  const sessions = await db.sessions.where('courseId').equals(courseId).toArray()
  if (sessions.length === 0) return

  // Without a term to anchor on, fall back to the earliest session's own week.
  const anchor = term?.startDate ?? sessions.map((s) => s.date).sort()[0]
  await Promise.all(
    sessions.map((s) => {
      const week = weekNumberOf(anchor, s.date)
      return s.index === week ? undefined : db.sessions.update(s.id, { index: week })
    }),
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
