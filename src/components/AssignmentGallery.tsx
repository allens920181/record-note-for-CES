import type { Assignment, Course } from '../db'
import { ASSIGNMENT_STATUS_LABEL } from '../db/schema'
import { ProgressTag } from './ProgressTag'
import { describeDays, workloadOf } from '../schedule/workload'

/**
 * One area per course, each holding that course's work as a grid of tiles.
 *
 * The list sorts every course's deadlines into one column and the board sorts
 * them by status; both answer questions about the term as a whole. This one
 * answers 「這門課我欠了什麼」—— the question you have while sitting in that
 * course, and the one neither of the others can be read for without picking
 * the course's rows out of everything else.
 *
 * A course with nothing in it still gets its area. An empty shelf is the
 * answer to that question, and it is the place to put the first thing on.
 */
interface Props {
  /** Every course of the term, in the order the term lists them. */
  courses: Course[]
  /** Already filtered by term, course and 未完成／全部, in due order. */
  assignments: Assignment[]
  onOpen: (id: string) => void
  onAdd: (courseId: string) => void
  /** Whether 未完成 is on, so an empty area can say which kind of empty. */
  hidingDone: boolean
}

export function AssignmentGallery({ courses, assignments, onOpen, onAdd, hidingDone }: Props) {
  return (
    <div className="gallery">
      {courses.map((course) => {
        const cards = assignments.filter((a) => a.courseId === course.id)
        return (
          <section key={course.id} className="gal-sec" aria-label={course.name}>
            <div className="gal-head">
              <span className="gal-dot" style={{ background: course.color }} />
              <h2 className="gal-name">{course.name}</h2>
              <span className="gal-count">{cards.length}</span>
              <button className="btn ghost sm gal-add" onClick={() => onAdd(course.id)}>
                新增作業
              </button>
            </div>

            {cards.length === 0 ? (
              // 「沒有作業」 would be a lie about a course whose work is all
              // finished and filtered out from under it.
              <p className="gal-empty">
                {hidingDone ? '這門課沒有未完成的作業。' : '這門課沒有作業。'}
              </p>
            ) : (
              <div className="gal-grid">
                {cards.map((a) => (
                  <Tile key={a.id} assignment={a} onOpen={() => onOpen(a.id)} />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function Tile({ assignment: a, onOpen }: { assignment: Assignment; onOpen: () => void }) {
  const load = workloadOf(a)
  const doneCount = a.subtasks.filter((t) => t.done).length
  // What you would sit down and do — the tile is big enough to say it, and it
  // is more use than repeating a title you already read at the top of it.
  const next = a.status === 'done' ? undefined : a.subtasks.find((t) => !t.done)

  return (
    <button className="gal-tile" onClick={onOpen}>
      <span className="gal-tile-title">{a.title}</span>
      <span className="gal-tile-due">
        <span className="mono">{a.due}</span>
        {a.status !== 'done' && (
          <>
            {' · '}
            <span className={load.pressure === 'overdue' ? 'is-late' : undefined}>
              {describeDays(load.daysLeft)}
            </span>
          </>
        )}
      </span>
      {next && <span className="gal-next">下一步：{next.title}</span>}
      <span className="gal-tile-foot">
        <span className={`tag${a.status === 'done' ? ' ok' : ''}`}>
          {ASSIGNMENT_STATUS_LABEL[a.status]}
        </span>
        {a.subtasks.length > 0 && <ProgressTag done={doneCount} total={a.subtasks.length} />}
        {a.status !== 'done' && load.hoursNeeded > 0 && (
          <span className="tag">還要 {load.hoursNeeded}h</span>
        )}
      </span>
    </button>
  )
}
