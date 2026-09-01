import Dexie from 'dexie'
import type { EntityTable } from 'dexie'
import { newId } from '../lib/id'
import { deleteDir, deleteFile } from '../storage/fsRoot'
import { DEFAULT_SETTINGS, FREE_TIER, MEETING_KINDS, isMeeting } from './schema'
import { addDays, endOfWeeks, todayISO, weekdayOf, weeksBetween } from '../lib/dates'
import { correctionKey, diffOnce, isMeaningful, suggestFrom } from '../schedule/corrections'
import type {
  AppSettings,
  Assignment,
  AssignmentStatus,
  Attachment,
  ClassSlot,
  Correction,
  Course,
  CourseKind,
  CourseRequirements,
  MeetingKind,
  PlanItem,
  Note,
  Reading,
  Recording,
  RecordingDraft,
  Recurrence,
  Session,
  SessionKind,
  SubTask,
  Term,
  TranscribeJob,
  Transcript,
  UsageEntry,
  WeekPlan,
} from './schema'

export type {
  AppSettings,
  Assignment,
  AssignmentStatus,
  Attachment,
  ClassSlot,
  Correction,
  Course,
  CourseKind,
  CourseRequirements,
  MeetingKind,
  PlanItem,
  Note,
  Reading,
  Recording,
  RecordingDraft,
  Recurrence,
  Session,
  SessionKind,
  SubTask,
  Term,
  TranscribeJob,
  Transcript,
  UsageEntry,
  WeekPlan,
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
  assignments!: EntityTable<Assignment, 'id'>
  readings!: EntityTable<Reading, 'id'>
  corrections!: EntityTable<Correction, 'id'>
  usage!: EntityTable<UsageEntry, 'id'>
  weekPlans!: EntityTable<WeekPlan, 'id'>

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
    // v3 added the store study time moved into; v7 removes it again. The
    // version stays so an existing database still upgrades in order.
    this.version(3).stores({ workBlocks: 'id, courseId, repeat, date' })
    this.version(4).stores({
      assignments: 'id, courseId, due, status',
      readings: 'id, courseId, sessionId, status',
    })
    this.version(5).stores({
      corrections: 'id, courseId, sessionId, key, createdAt',
      usage: 'id, at',
    })
    // v6 adds the weekly study plan. Course requirements ride inside the course
    // record, so they need no store of their own — an absent `requirements`
    // reads as "not filled in yet", which is the right default for a course
    // created before the field existed.
    this.version(6).stores({ weekPlans: 'id, sessionId, courseId' })
    // v7 drops study time. It was a block of hours that produced nothing — its
    // only job was to answer "how many hours before this is due", and that
    // question is now left to the reader rather than to a table. Setting the
    // store to null deletes it; restoring an older backup simply skips it.
    this.version(7).stores({ workBlocks: null })
    // v8 drops a term's typed-in week count. The two dates already said the
    // same thing, and could say something different. Terms created before this
    // derived their end date from the count, so the two agree — except where
    // someone edited one and not the other, and there the promise ("this term
    // runs 15 weeks") wins: the end date is pushed out to cover it before the
    // field goes, so no term silently gets shorter.
    this.version(8)
      .stores({})
      .upgrade((tx) =>
        tx
          .table('terms')
          .toCollection()
          .modify((term: { startDate?: string; endDate?: string; weeks?: number }) => {
            const weeks = Number(term.weeks)
            if (term.startDate && Number.isFinite(weeks) && weeks > 0) {
              const promised = endOfWeeks(term.startDate, weeks)
              if (!term.endDate || term.endDate < promised) term.endDate = promised
            }
            delete term.weeks
          }),
      )
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
  kind?: CourseKind
  slots?: ClassSlot[]
}): Promise<string> {
  const id = newId('course')
  await db.courses.add({
    ...input,
    id,
    slots: input.slots ?? [],
    glossary: [],
    createdAt: Date.now(),
  })
  return id
}

export async function deleteCourseCascade(courseId: string): Promise<void> {
  const sessions = await db.sessions.where('courseId').equals(courseId).toArray()
  await Promise.all(sessions.map((s) => deleteSessionCascade(s.id)))
  await db.assignments.where('courseId').equals(courseId).delete()
  await db.corrections.where('courseId').equals(courseId).delete()
  await db.readings.where('courseId').equals(courseId).delete()
  await db.weekPlans.where('courseId').equals(courseId).delete()
  const courseFiles = await db.attachments.where('courseId').equals(courseId).toArray()
  await Promise.all(courseFiles.map((a) => deleteFile(a.storageKey)))
  await db.attachments.where('courseId').equals(courseId).delete()
  await db.courses.delete(courseId)
}

/**
 * Renames a term or moves its dates. A changed start date or week count shifts
 * every session's week number, so the whole term is renumbered — a session that
 * kept its old "第 N 週" after the term moved would disagree with the timetable
 * that produced it, silently and in the one label people navigate by.
 */
export async function updateTerm(
  termId: string,
  patch: Partial<Pick<Term, 'name' | 'startDate' | 'endDate'>>,
): Promise<{ renumbered: number }> {
  const before = await db.terms.get(termId)
  if (!before) return { renumbered: 0 }
  await db.terms.update(termId, patch)

  const movedStart = patch.startDate !== undefined && patch.startDate !== before.startDate
  const movedEnd = patch.endDate !== undefined && patch.endDate !== before.endDate
  if (!movedStart && !movedEnd) return { renumbered: 0 }

  const courses = await db.courses.where('termId').equals(termId).toArray()
  await Promise.all(courses.map((c) => renumberSessions(c.id)))
  const counts = await Promise.all(
    courses.map((c) => db.sessions.where('courseId').equals(c.id).count()),
  )
  return { renumbered: counts.reduce((a, b) => a + b, 0) }
}

/** How many sessions a change to the term’s dates would renumber. */
export async function sessionsInTerm(termId: string): Promise<number> {
  const courses = await db.courses.where('termId').equals(termId).toArray()
  const counts = await Promise.all(
    courses.map((c) => db.sessions.where('courseId').equals(c.id).count()),
  )
  return counts.reduce((a, b) => a + b, 0)
}

export async function updateCourse(
  courseId: string,
  patch: Partial<Pick<Course, 'name' | 'teacher' | 'code' | 'credits' | 'color' | 'kind' | 'slots'>>,
): Promise<void> {
  await db.courses.update(courseId, patch)
}

/**
 * Names one line's speaker, and remembers the name for next week.
 *
 * The mark goes on the line where the turn starts and runs forward from there
 * (see `speakersOf`), so clearing one hands its lines back to whoever was
 * speaking before.
 */
export async function markSpeaker(
  transcriptId: string,
  index: number,
  name: string | null,
): Promise<void> {
  const row = await db.transcripts.get(transcriptId)
  if (!row || !row.segments[index]) return
  const segments = row.segments.map((seg, i) => {
    if (i !== index) return seg
    const next = { ...seg }
    if (name) next.speaker = name
    else delete next.speaker
    return next
  })
  await db.transcripts.update(transcriptId, { segments, updatedAt: Date.now() })

  if (!name) return
  const course = await courseOfSession(row.sessionId)
  if (!course) return
  const roster = course.speakers ?? []
  if (!roster.includes(name)) {
    await db.courses.update(course.id, { speakers: [...roster, name] })
  }
}

async function courseOfSession(sessionId: string): Promise<Course | undefined> {
  const session = await db.sessions.get(sessionId)
  return session ? db.courses.get(session.courseId) : undefined
}

// ── sessions ──────────────────────────────────────────────────────────

/**
 * Adds a note block to a course at a chosen point in its ordered list.
 *
 * It borrows the date and week number of the block it follows, so it sorts into
 * place and reads as belonging to that week. It carries no clock time: nothing
 * happens at an hour, which is also why it never reaches the calendar.
 */
export async function insertNoteBlock(
  courseId: string,
  kind: SessionKind,
  afterSessionId: string | null,
): Promise<string> {
  const ordered = await sessionsInOrder(courseId)
  const at = afterSessionId ? ordered.findIndex((s) => s.id === afterSessionId) : -1
  // Following nothing means going first, so borrow from what is currently first.
  const above = at >= 0 ? ordered[at] : null
  const below = ordered[at + 1] ?? null
  const anchor = above ?? below
  const seqOf = (s: Session) =>
    s.seq ?? (isMeeting(s.kind) ? MEETING_KINDS.indexOf(s.kind ?? 'lecture') : NOTE_AFTER)
  // Halfway between its neighbours, so it lands where it was dropped even when
  // the two of them are a lecture and the discussion that follows it.
  const seq = !above
    ? (below ? seqOf(below) - 1 : 0)
    : below && below.date === above.date
      ? (seqOf(above) + seqOf(below)) / 2
      : seqOf(above) + 1
  // A meeting inserted this way still borrows its hour from the timetable when
  // the course has one — a discussion that happens has a time; a note does not.
  const course = isMeeting(kind) ? await db.courses.get(courseId) : undefined
  const slot = course?.slots.find((sl) => (sl.kind ?? 'lecture') === kind) ?? course?.slots[0]
  const id = newId('session')
  await db.sessions.add({
    id,
    courseId,
    index: anchor?.index ?? 1,
    date: anchor?.date ?? todayISO(),
    ...(slot ? { start: slot.start, end: slot.end, room: slot.room } : {}),
    topic: '',
    canceled: false,
    kind,
    seq,
    createdAt: Date.now(),
  })
  return id
}

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

/** Where a note block sits when it has no seq of its own: after the meetings. */
const NOTE_AFTER = MEETING_KINDS.length

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

/**
 * The first date on or after `iso` that falls on the given weekday.
 *
 * Built out of the shared date helpers rather than a `Date` of its own. The
 * line this replaces ended in `toISOString().slice(0, 10)`, which reads the
 * date back in UTC — and local midnight anywhere east of Greenwich is still
 * the previous day there. So every meeting a timetable produced landed one day
 * early for the whole of Asia: a 週二 slot generated 週一 files, and the first
 * two of them fell in the same teaching week because one of them predated the
 * term. In UTC the same code was right, which is why it read as correct.
 */
export function nextWeekdayOnOrAfter(iso: string, weekday: number): string {
  return addDays(iso, (weekday - weekdayOf(iso) + 7) % 7)
}

export interface GenerateResult {
  created: number
  skipped: number
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
  if (course.slots.length === 0) {
    throw new Error('這門課還沒設定每週固定的上課時段。只上一次的課請用「新增一堂課」指定日期。')
  }
  const term = await db.terms.get(course.termId)
  if (!term) throw new Error('找不到這門課所屬的學期')

  const existing = await db.sessions.where('courseId').equals(courseId).toArray()
  const taken = new Set(existing.map((s) => `${s.date}|${s.kind ?? 'lecture'}`))

  const rows: Session[] = []
  for (const slot of course.slots) {
    const kind: SessionKind = slot.kind === 'discussion' ? 'discussion' : 'lecture'
    const first = nextWeekdayOnOrAfter(term.startDate, slot.weekday)
    const termWeeks = weeksBetween(term.startDate, term.endDate)
    for (let week = 0; week < termWeeks; week++) {
      const date = addDays(first, week * 7)
      const key = `${date}|${kind}`
      if (taken.has(key)) continue
      taken.add(key)
      rows.push({
        id: newId('sess'),
        courseId,
        index: weekNumberOf(term.startDate, date),
        date,
        start: slot.start,
        end: slot.end,
        room: slot.room,
        topic: '',
        canceled: false,
        kind,
        createdAt: Date.now(),
      })
    }
  }

  if (rows.length > 0) await db.sessions.bulkAdd(rows)
  const wanted = course.slots.length * weeksBetween(term.startDate, term.endDate)
  return { created: rows.length, skipped: wanted - rows.length }
}

export interface DateShift {
  id: string
  from: string
  to: string
}

/**
 * Meetings sitting exactly one day before the weekday their slot names.
 *
 * This is the fingerprint the bug above left behind, and deliberately nothing
 * wider. A meeting moved by hand — a make-up class, the week the room was
 * taken — is a real thing that happened on a real day, and a repair that swept
 * those up as well would be inventing a timetable nobody wrote. So a session
 * only counts when its kind and both its times still match a slot, its own
 * weekday matches no slot at all, and the day it would move onto is free.
 *
 * Nothing is written here: the count is what the course page needs in order to
 * say what it is about to do before it does it.
 */
export function meetingsOneDayEarly(course: Course, sessions: Session[]): DateShift[] {
  const taken = new Set(sessions.map((s) => `${s.date}|${s.kind ?? 'lecture'}`))
  const out: DateShift[] = []
  for (const s of sessions) {
    const kind = s.kind ?? 'lecture'
    if (!isMeeting(kind)) continue
    const sameKind = course.slots.filter((slot) => (slot.kind ?? 'lecture') === kind)
    const wd = weekdayOf(s.date)
    // A day the timetable already names has nothing to answer for.
    if (sameKind.some((slot) => slot.weekday === wd)) continue
    const slot = sameKind.find(
      (slot) => slot.weekday === (wd + 1) % 7 && slot.start === s.start && slot.end === s.end,
    )
    if (!slot) continue
    const to = addDays(s.date, 1)
    if (taken.has(`${to}|${kind}`)) continue
    taken.add(`${to}|${kind}`)
    out.push({ id: s.id, from: s.date, to })
  }
  return out
}

/**
 * Moves those meetings onto the day their slot names.
 *
 * Only ever offered, never run on its own: a date carries recordings and notes
 * that were filed under it, and deciding those were filed on the wrong day is
 * the reader's call, not a migration's.
 */
export async function realignMeetingsToTimetable(courseId: string): Promise<{ moved: number }> {
  const course = await db.courses.get(courseId)
  if (!course) throw new Error('找不到這門課')
  const moves = meetingsOneDayEarly(course, await sessionsInOrder(courseId))
  if (moves.length === 0) return { moved: 0 }
  await db.transaction('rw', db.sessions, async () => {
    for (const m of moves) await db.sessions.update(m.id, { date: m.to })
  })
  // 第 N 週 is read off the date, so it has to be read again.
  await renumberSessions(courseId)
  return { moved: moves.length }
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

/**
 * Adds a single meeting on a date you choose. Discussions and make-up classes
 * often don't recur, so they never come from the weekly timetable.
 */
export async function createSessionOn(
  courseId: string,
  date: string,
  kind: SessionKind,
  times?: { start?: string; end?: string; room?: string },
): Promise<string> {
  const course = await db.courses.get(courseId)
  const term = course ? await db.terms.get(course.termId) : undefined
  // Fall back to how this course usually meets, so a meeting added without
  // times still lands somewhere sensible on the calendar.
  const usual = course?.slots.find((slot) => (slot.kind ?? 'lecture') === kind) ?? course?.slots[0]
  const id = newId('sess')
  await db.sessions.add({
    id,
    courseId,
    index: term ? weekNumberOf(term.startDate, date) : 1,
    date,
    start: times?.start ?? usual?.start,
    end: times?.end ?? usual?.end,
    room: times?.room ?? usual?.room,
    topic: '',
    canceled: false,
    kind,
    createdAt: Date.now(),
  })
  return id
}

// ── corrections → glossary ────────────────────────────────────────────

/**
 * Records a transcript fix and, when the term can be trusted, adds it to the
 * course glossary straight away.
 *
 * Latin words are extracted reliably, so a repeated fix is added without
 * asking — the reader has now made the same correction twice, which is as
 * strong a signal as this gets. Chinese fixes are only recorded; picking the
 * term needs a human, and a wrong entry would teach the model a wrong spelling.
 */
export interface CorrectionOutcome {
  /** False for a punctuation or whitespace tidy-up, which teaches nothing. */
  recorded: boolean
  /** Set when this fix has now been made twice and the term was added. */
  learned?: string
}

export async function recordCorrection(input: {
  courseId: string
  sessionId: string
  before: string
  after: string
}): Promise<CorrectionOutcome> {
  const diff = diffOnce(input.before, input.after)
  if (!diff || !isMeaningful(diff)) return { recorded: false }

  const key = correctionKey(diff)
  const suggestion = suggestFrom(input.after, diff)
  const id = newId('cor')
  await db.corrections.add({ ...input, id, key, createdAt: Date.now() })

  if (!suggestion?.term) return { recorded: true }

  const priorSameFix = await db.corrections
    .where('key')
    .equals(key)
    .filter((c) => c.courseId === input.courseId && c.id !== id)
    .count()
  if (priorSameFix === 0) return { recorded: true }

  const course = await db.courses.get(input.courseId)
  if (!course || course.glossary.includes(suggestion.term)) return { recorded: true }
  await db.courses.update(input.courseId, {
    glossary: [...course.glossary, suggestion.term],
  })
  await db.corrections.update(id, { resolvedTerm: suggestion.term })
  return { recorded: true, learned: suggestion.term }
}

export async function resolveCorrection(id: string, term: string): Promise<void> {
  const correction = await db.corrections.get(id)
  if (!correction) return
  const course = await db.courses.get(correction.courseId)
  if (course && !course.glossary.includes(term)) {
    await db.courses.update(course.id, { glossary: [...course.glossary, term] })
  }
  await db.corrections.update(id, { resolvedTerm: term })
}

export async function dismissCorrection(id: string): Promise<void> {
  await db.corrections.update(id, { dismissed: true })
}

// ── usage ─────────────────────────────────────────────────────────────

export async function recordUsage(seconds: number, model: string, ok: boolean): Promise<void> {
  await db.usage.add({ id: newId('use'), at: Date.now(), seconds, model, ok })
}

export interface QuotaState {
  /** Seconds of audio already sent in the trailing 24 hours / 1 hour. */
  usedToday: number
  usedThisHour: number
  remainingToday: number
  remainingThisHour: number
  requestsToday: number
}

/**
 * How much of the free tier is left. Measured over trailing windows rather than
 * calendar days, which is the safe reading when the reset time is unknown.
 */
export async function quotaState(now = Date.now()): Promise<QuotaState> {
  const dayAgo = now - 86_400_000
  const hourAgo = now - 3_600_000
  const recent = await db.usage.where('at').above(dayAgo).toArray()
  const okRecent = recent.filter((u) => u.ok)
  const usedToday = okRecent.reduce((sum, u) => sum + u.seconds, 0)
  const usedThisHour = okRecent
    .filter((u) => u.at > hourAgo)
    .reduce((sum, u) => sum + u.seconds, 0)
  return {
    usedToday,
    usedThisHour,
    remainingToday: Math.max(0, FREE_TIER.secondsPerDay - usedToday),
    remainingThisHour: Math.max(0, FREE_TIER.secondsPerHour - usedThisHour),
    requestsToday: recent.length,
  }
}

// ── assignments ───────────────────────────────────────────────────────

export async function createAssignment(input: {
  courseId: string
  title: string
  due: string
  sessionId?: string
}): Promise<string> {
  const id = newId('asg')
  const now = Date.now()
  await db.assignments.add({
    ...input,
    id,
    status: 'todo',
    notes: '',
    subtasks: [],
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function updateAssignment(
  id: string,
  patch: Partial<Assignment>,
): Promise<void> {
  await db.assignments.update(id, { ...patch, updatedAt: Date.now() })
}

export async function deleteAssignment(id: string): Promise<void> {
  await db.assignments.delete(id)
}

/** Where an assignment stands, for a progress bar and the status chip. */
export function assignmentProgress(a: Assignment): { done: number; total: number } {
  if (a.status === 'done') return { done: a.subtasks.length || 1, total: a.subtasks.length || 1 }
  return { done: a.subtasks.filter((t) => t.done).length, total: a.subtasks.length }
}

export function estimatedHours(a: Assignment): number {
  return a.subtasks
    .filter((t) => !t.done)
    .reduce((sum, t) => sum + (t.estimateHours ?? 0), 0)
}

// ── readings ──────────────────────────────────────────────────────────

export async function createReading(input: {
  courseId: string
  title: string
  author?: string
  chapters?: string
  sessionId?: string
}): Promise<string> {
  const id = newId('read')
  await db.readings.add({
    ...input,
    id,
    status: 'unread',
    notes: '',
    createdAt: Date.now(),
  })
  return id
}

export async function updateReading(id: string, patch: Partial<Reading>): Promise<void> {
  await db.readings.update(id, patch)
}

export async function deleteReading(id: string): Promise<void> {
  await db.readings.delete(id)
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
  await db.weekPlans.where('sessionId').equals(sessionId).delete()
  await db.sessions.delete(sessionId)
}

// ── course requirements ───────────────────────────────────────────────

export async function saveRequirements(
  courseId: string,
  requirements: CourseRequirements,
): Promise<void> {
  await db.courses.update(courseId, { requirements })
}


// ── weekly study plan ─────────────────────────────────────────────────

export async function getWeekPlan(sessionId: string): Promise<WeekPlan | undefined> {
  return db.weekPlans.get(sessionId)
}

export async function saveWeekPlan(
  sessionId: string,
  courseId: string,
  items: PlanItem[],
): Promise<void> {
  await db.weekPlans.put({ id: sessionId, sessionId, courseId, items, updatedAt: Date.now() })
}

export interface WeekProgress {
  sessionId: string
  index: number
  date: string
  kind: SessionKind
  topic: string
  canceled: boolean
  done: number
  total: number
  /** Hours the plan's unfinished items still need. */
  hoursLeft: number
  hasNote: boolean
  hasTranscript: boolean
}

export interface CourseProgress {
  weeks: WeekProgress[]
  plannedWeeks: number
  completedWeeks: number
  itemsDone: number
  itemsTotal: number
  hoursLeft: number
}

/**
 * Progress across a whole course, week by week. Deliberately counts only weeks
 * that have a plan: a term with fifteen weeks and four planned is 4/4 done, not
 * 4/15 — the eleven with no plan are not behind, they simply have not been
 * thought about yet, and mixing the two makes the number meaningless.
 */
export async function courseProgress(courseId: string): Promise<CourseProgress> {
  const [sessions, plans] = await Promise.all([
    db.sessions.where('courseId').equals(courseId).toArray(),
    db.weekPlans.where('courseId').equals(courseId).toArray(),
  ])
  const ids = sessions.map((s) => s.id)
  const [notes, scribedKeys] = await Promise.all([
    db.notes.where('sessionId').anyOf(ids).toArray(),
    // Keys, not records: a transcript carries every segment of a three-hour
    // lecture, and all this needs to know is whether one exists.
    db.transcripts.where('sessionId').anyOf(ids).keys(),
  ])
  const planBy = new Map(plans.map((p) => [p.sessionId, p]))
  const noted = new Set(notes.filter((n) => n.markdown.trim().length > 0).map((n) => n.sessionId))
  const scribed = new Set(scribedKeys as string[])

  const weeks: WeekProgress[] = sessions
    // Meetings only: a note block has no week plan to be behind on, and
    // counting it made "還有 N 沒排" grow every time one was filed.
    .filter((s) => isMeeting(s.kind))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => {
      const items = planBy.get(s.id)?.items ?? []
      return {
        sessionId: s.id,
        index: s.index,
        date: s.date,
        kind: s.kind ?? 'lecture',
        topic: s.topic,
        canceled: s.canceled,
        done: items.filter((i) => i.done).length,
        total: items.length,
        hoursLeft: items
          .filter((i) => !i.done)
          .reduce((sum, i) => sum + (Number(i.hours) || 0), 0),
        hasNote: noted.has(s.id),
        hasTranscript: scribed.has(s.id),
      }
    })

  const planned = weeks.filter((w) => w.total > 0)
  return {
    weeks,
    plannedWeeks: planned.length,
    completedWeeks: planned.filter((w) => w.done === w.total).length,
    itemsDone: planned.reduce((sum, w) => sum + w.done, 0),
    itemsTotal: planned.reduce((sum, w) => sum + w.total, 0),
    hoursLeft: planned.reduce((sum, w) => sum + w.hoursLeft, 0),
  }
}

/**
 * A course's meetings in the order people read them: by date, then lecture
 * before discussion within a day.
 *
 * Shared so the ordering is written once. The course list and the workspace's
 * previous/next buttons have to agree — "下一週" landing somewhere other than
 * the row below it would be its own small betrayal.
 */
export async function sessionsInOrder(courseId: string): Promise<Session[]> {
  const list = await db.sessions.where('courseId').equals(courseId).toArray()
  // Kind order comes from MEETING_KINDS, not from the string: sorting the
  // labels alphabetically puts 'discussion' before 'lecture', so a week's
  // discussion would be listed above the class it follows.
  const rank = (s: Session) =>
    s.seq ?? (isMeeting(s.kind) ? MEETING_KINDS.indexOf(s.kind ?? 'lecture') : NOTE_AFTER)
  return list.sort(
    (a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || a.createdAt - b.createdAt,
  )
}

/** The meetings either side of one, for stepping through a course. */
export async function siblingSessions(
  sessionId: string,
): Promise<{ prev: Session | null; next: Session | null }> {
  const session = await db.sessions.get(sessionId)
  if (!session) return { prev: null, next: null }
  const all = await sessionsInOrder(session.courseId)
  const i = all.findIndex((s) => s.id === sessionId)
  return { prev: i > 0 ? all[i - 1] : null, next: i >= 0 && i < all.length - 1 ? all[i + 1] : null }
}

// ── transcripts and recordings ────────────────────────────────────────

/** Removes one recording row and the audio behind it. */
export async function deleteRecording(recordingId: string): Promise<void> {
  const row = await db.recordings.get(recordingId)
  if (!row) return
  await deleteFile(row.storageKey)
  await db.recordings.delete(recordingId)
}

/**
 * Drops a session's transcript and audio, keeping the note and the week plan.
 *
 * The only way to undo a bad transcription used to be deleting the whole
 * session, which took the notes with it — so a wrong language setting cost an
 * evening's writing rather than one re-run.
 */
/**
 * Removes one recording of a week and the transcript that belongs to it.
 *
 * A week can hold several; deleting the one you are looking at should not take
 * the other two with it, which is what happens when the only handle is the
 * session.
 */
export async function deletePart(recordingId: string): Promise<void> {
  const row = await db.recordings.get(recordingId)
  if (row) await deleteFile(row.storageKey)
  await db.transcripts.where('recordingId').equals(recordingId).delete()
  await db.recordings.delete(recordingId)
  await db.jobs.where('recordingId').equals(recordingId).delete()
}

export async function deleteTranscription(sessionId: string): Promise<void> {
  const [transcripts, recordings] = await Promise.all([
    db.transcripts.where('sessionId').equals(sessionId).toArray(),
    db.recordings.where('sessionId').equals(sessionId).toArray(),
  ])
  await Promise.all(recordings.map((r) => deleteFile(r.storageKey)))
  await db.transcripts.bulkDelete(transcripts.map((t) => t.id))
  await db.recordings.bulkDelete(recordings.map((r) => r.id))
  await db.jobs.where('sessionId').equals(sessionId).delete()
}

// ── notes ─────────────────────────────────────────────────────────────

export async function saveNote(sessionId: string, markdown: string): Promise<void> {
  await db.notes.put({ id: sessionId, sessionId, markdown, updatedAt: Date.now() })
}

// ── dates ─────────────────────────────────────────────────────────────
// Re-exported so existing callers keep working; the implementations live in
// lib/dates.ts, which the calendar also draws on.

export { addDays, todayISO }
