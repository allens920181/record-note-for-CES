import {
  createSessionOn,
  db,
  generateSessionsFromTimetable,
  renumberSessions,
} from '../db'
import type { Course, MeetingKind, Recurrence } from '../db'
import { MEETING_KIND_LABEL } from '../db/schema'
import type { ItemKind } from '../schedule/occurrences'
import { WEEKDAY_SHORT, minutesOf, timeOf, weekdayOf } from '../lib/dates'
import { Modal } from './Modal'
import { TimeField } from './TimeField'

export interface TimeBlockDraft {
  courseId: string
  kind: ItemKind
  repeat: Recurrence
  date: string
  start: string
  end: string
  /** False while the time is still the app's guess rather than the reader's. */
  timed: boolean
}

/** 'deadline' has its own page; only the three schedulable kinds appear here. */
const KIND_LABEL: Record<Exclude<ItemKind, 'deadline'>, string> = {
  lecture: MEETING_KIND_LABEL.lecture,
  discussion: MEETING_KIND_LABEL.discussion,
}

/**
 * When a new block of this kind should start, asked of the course rather than
 * invented. A course with no timetable yet falls back to the evening, which is
 * when a seminary meets far more often than at nine in the morning.
 */
export function usualStart(course: Course | undefined, kind: ItemKind): number {
  const slot = course?.slots.find((s) => (s.kind ?? 'lecture') === kind) ?? course?.slots[0]
  return minutesOf(slot?.start) ?? 19 * 60
}

export function makeDraft(
  course: Course | undefined,
  date: string,
  startMin: number | null,
  kind: ItemKind = 'lecture',
  repeat: Recurrence = 'weekly',
): TimeBlockDraft {
  const from = startMin ?? usualStart(course, kind)
  return {
    courseId: course?.id ?? '',
    kind,
    repeat,
    date,
    start: timeOf(from),
    end: timeOf(Math.min(23 * 60 + 59, from + 120)),
    timed: startMin !== null,
  }
}

/** Re-derives a time the reader has not touched when the shape changes. */
export function retime(next: TimeBlockDraft, course: Course | undefined): TimeBlockDraft {
  if (next.timed) return next
  const from = usualStart(course, next.kind)
  return { ...next, start: timeOf(from), end: timeOf(Math.min(23 * 60 + 59, from + 120)) }
}

/**
 * Puts the block where it belongs, and says what happened.
 *
 * Two outcomes hide behind one dialog, and getting them wrong is expensive: a
 * weekly meeting saved as a single occurrence silently loses the recurrence.
 * They live here so the calendar and the course page cannot drift apart.
 */
export async function createTimeBlock(draft: TimeBlockDraft): Promise<string> {
  const { courseId, kind, repeat, date, start, end } = draft

  const meetingKind = kind as MeetingKind
  if (repeat === 'once') {
    await createSessionOn(courseId, date, meetingKind, { start, end })
    await renumberSessions(courseId)
    return `已新增 ${date} 的${MEETING_KIND_LABEL[meetingKind]}。`
  }

  // Weekly meetings become a timetable slot, then expand across the term —
  // creating one occurrence would silently lose the recurrence.
  const course = await db.courses.get(courseId)
  if (!course) throw new Error('找不到這門課')
  await db.courses.update(courseId, {
    slots: [...course.slots, { weekday: weekdayOf(date), start, end, kind: meetingKind }],
  })
  const { created } = await generateSessionsFromTimetable(courseId)
  await renumberSessions(courseId)
  return `已加入每週的${MEETING_KIND_LABEL[meetingKind]}，並產生 ${created} 個週次。`
}

interface Props {
  draft: TimeBlockDraft
  onChange: (draft: TimeBlockDraft) => void
  /** One entry means the course is already decided; the picker is left out. */
  courses: Course[]
  onClose: () => void
  onSubmit: () => void
  title?: string
}

/**
 * One dialog for anything that occupies a slot of time in a course.
 *
 * The calendar and the course page each had their own — the calendar's asked
 * for the shape, the course page's asked only for a date and baked the kind
 * into which of two buttons had been pressed. So the same act produced
 * different questions, and only one of the two could offer "every week".
 */
export function TimeBlockDialog({ draft, onChange, courses, onClose, onSubmit, title }: Props) {
  const course = courses.find((c) => c.id === draft.courseId)
  const set = (next: Partial<TimeBlockDraft>) => onChange({ ...draft, ...next })
  const reshape = (next: Partial<TimeBlockDraft>) => onChange(retime({ ...draft, ...next }, course))

  return (
    <Modal title={title ?? '新增行程'} onClose={onClose} onSubmit={onSubmit} submitLabel="建立">
      {courses.length > 1 && (
        <div className="field">
          <label htmlFor="d-course">課程</label>
          <select
            id="d-course"
            value={draft.courseId}
            onChange={(e) => reshape({ courseId: e.target.value })}
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="row">
        <div className="field">
          <label htmlFor="d-kind">類型</label>
          <select
            id="d-kind"
            value={draft.kind}
            onChange={(e) => reshape({ kind: e.target.value as ItemKind })}
          >
            {(Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="d-repeat">重複</label>
          <select
            id="d-repeat"
            value={draft.repeat}
            onChange={(e) => set({ repeat: e.target.value as Recurrence })}
          >
            <option value="weekly">每週</option>
            <option value="once">只有這次</option>
          </select>
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="d-date">日期</label>
          <input
            id="d-date"
            type="date"
            value={draft.date}
            onChange={(e) => set({ date: e.target.value })}
          />
          <div className="hint">
            {draft.repeat === 'weekly'
              ? `每週的這一天（週${WEEKDAY_SHORT[weekdayOf(draft.date)]}）`
              : '只發生在這一天'}
          </div>
        </div>
        <TimeField
          id="d-start"
          label="開始"
          value={draft.start}
          onChange={(v) => set({ start: v, timed: true })}
        />
        <TimeField
          id="d-end"
          label="結束"
          value={draft.end}
          onChange={(v) => set({ end: v, timed: true })}
        />
      </div>

      {draft.repeat === 'weekly' ? (
        <div className="notice">會寫進課表，並依學期週數一次產生整學期的週次。</div>
      ) : (
        <div className="notice">只會建立這一天的一個週次，不影響課表。</div>
      )}
    </Modal>
  )
}
