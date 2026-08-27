import Dexie from 'dexie'
import type { EntityTable } from 'dexie'
import { newId } from '../lib/id'
import { DEFAULT_SETTINGS } from './schema'
import type {
  AppSettings,
  Course,
  Note,
  Recording,
  Session,
  Term,
  Transcript,
  TranscribeJob,
} from './schema'

export type { AppSettings, Course, Note, Recording, Session, Term, Transcript, TranscribeJob }

class NotesDB extends Dexie {
  terms!: EntityTable<Term, 'id'>
  courses!: EntityTable<Course, 'id'>
  sessions!: EntityTable<Session, 'id'>
  recordings!: EntityTable<Recording, 'id'>
  transcripts!: EntityTable<Transcript, 'id'>
  notes!: EntityTable<Note, 'id'>
  jobs!: EntityTable<TranscribeJob, 'id'>
  settings!: EntityTable<AppSettings, 'id'>

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

export async function deleteSessionCascade(sessionId: string): Promise<void> {
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
