import type { Assignment, Course, Session, WorkBlock } from '../db'
import { MEETING_KIND_LABEL } from '../db/schema'
import { addDays, minutesOf, weekdayOf } from '../lib/dates'

export type ItemKind = 'lecture' | 'discussion' | 'work' | 'deadline'

export interface CalendarItem {
  /** Stable per occurrence, so React keys survive a re-expand. */
  key: string
  kind: ItemKind
  courseId: string
  courseName: string
  color: string
  date: string
  /** Minutes since midnight; null when the item has no usable time. */
  startMin: number | null
  endMin: number | null
  title: string
  detail?: string
  canceled?: boolean
  /** Meetings open their workspace; study blocks have no page of their own. */
  sessionId?: string
  workBlockId?: string
  assignmentId?: string
}

export interface ExpandInput {
  from: string
  to: string
  courses: Course[]
  sessions: Session[]
  workBlocks: WorkBlock[]
  assignments?: Assignment[]
}

/**
 * Flattens everything scheduled between two dates into dated, timed items.
 *
 * Sessions are already one row per occurrence. Weekly study blocks are *rules*
 * rather than rows, so they only become occurrences here — which is why the
 * calendar has to expand rather than simply query.
 */
export function expandOccurrences({
  from,
  to,
  courses,
  sessions,
  workBlocks,
  assignments = [],
}: ExpandInput): CalendarItem[] {
  const byId = new Map(courses.map((c) => [c.id, c]))
  const items: CalendarItem[] = []

  for (const session of sessions) {
    if (session.date < from || session.date > to) continue
    const course = byId.get(session.courseId)
    if (!course) continue
    const kind: ItemKind = session.kind ?? 'lecture'
    items.push({
      key: `s:${session.id}`,
      kind,
      courseId: course.id,
      courseName: course.name,
      color: course.color,
      date: session.date,
      startMin: minutesOf(session.start),
      endMin: minutesOf(session.end),
      title: course.name,
      detail: session.topic || `第 ${session.index} 週 · ${MEETING_KIND_LABEL[kind]}`,
      canceled: session.canceled,
      sessionId: session.id,
    })
  }

  for (const block of workBlocks) {
    const course = byId.get(block.courseId)
    if (!course) continue
    const base = {
      kind: 'work' as const,
      courseId: course.id,
      courseName: course.name,
      color: course.color,
      startMin: minutesOf(block.start),
      endMin: minutesOf(block.end),
      title: `${course.name} · 作業時間`,
      detail: block.note,
      workBlockId: block.id,
    }

    if (block.repeat === 'once') {
      if (block.date && block.date >= from && block.date <= to) {
        items.push({ ...base, key: `w:${block.id}`, date: block.date })
      }
      continue
    }

    if (block.weekday === undefined) continue
    for (let date = from; date <= to; date = addDays(date, 1)) {
      if (weekdayOf(date) !== block.weekday) continue
      items.push({ ...base, key: `w:${block.id}:${date}`, date })
    }
  }

  for (const assignment of assignments) {
    if (assignment.due < from || assignment.due > to) continue
    const course = byId.get(assignment.courseId)
    if (!course) continue
    items.push({
      key: `a:${assignment.id}`,
      kind: 'deadline',
      courseId: course.id,
      courseName: course.name,
      color: course.color,
      date: assignment.due,
      // An untimed deadline belongs in the all-day strip, not parked at 00:00.
      startMin: minutesOf(assignment.dueTime),
      endMin: null,
      title: `繳交：${assignment.title}`,
      detail: course.name,
      canceled: assignment.status === 'done',
      assignmentId: assignment.id,
    })
  }

  return items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.startMin ?? 1e9) - (b.startMin ?? 1e9) ||
      a.title.localeCompare(b.title),
  )
}

export interface LaidOutItem extends CalendarItem {
  /** Which of `columns` side-by-side lanes this item occupies. */
  column: number
  columns: number
}

/**
 * Assigns overlapping items to side-by-side lanes so a clash is visible rather
 * than hidden behind whichever happened to render last.
 */
export function layOutDay(items: CalendarItem[]): LaidOutItem[] {
  const timed = items
    .filter((i) => i.startMin !== null)
    .sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0))

  const out: LaidOutItem[] = []
  let cluster: CalendarItem[] = []
  let clusterEnd = -1

  const flush = () => {
    if (cluster.length === 0) return
    // Greedy lane packing: reuse the first lane whose last item has ended.
    const laneEnds: number[] = []
    const placed = cluster.map((item) => {
      const start = item.startMin ?? 0
      let lane = laneEnds.findIndex((end) => end <= start)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(0)
      }
      laneEnds[lane] = endOf(item)
      return { item, lane }
    })
    for (const { item, lane } of placed) {
      out.push({ ...item, column: lane, columns: laneEnds.length })
    }
    cluster = []
    clusterEnd = -1
  }

  for (const item of timed) {
    const start = item.startMin ?? 0
    if (cluster.length > 0 && start >= clusterEnd) flush()
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, endOf(item))
  }
  flush()

  return out
}

/** A block with no end, or an end before its start, still needs to be visible. */
export function endOf(item: CalendarItem): number {
  const start = item.startMin ?? 0
  const end = item.endMin
  return end !== null && end > start ? end : start + 60
}

/** The hour window a week view needs to cover, padded to a readable minimum. */
export function hourWindow(items: CalendarItem[]): { fromHour: number; toHour: number } {
  const timed = items.filter((i) => i.startMin !== null)
  if (timed.length === 0) return { fromHour: 8, toHour: 22 }
  const first = Math.min(...timed.map((i) => i.startMin ?? 0))
  const last = Math.max(...timed.map((i) => endOf(i)))
  return {
    fromHour: Math.min(8, Math.floor(first / 60)),
    toHour: Math.max(22, Math.ceil(last / 60)),
  }
}
