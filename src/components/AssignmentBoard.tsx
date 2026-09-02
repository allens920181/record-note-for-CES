import { useState } from 'react'
import { updateAssignment } from '../db'
import type { Assignment, AssignmentStatus, Course } from '../db'
import { ASSIGNMENT_STATUSES, ASSIGNMENT_STATUS_LABEL } from '../db/schema'
import { ProgressTag } from './ProgressTag'
import { describeDays, workloadOf } from '../schedule/workload'

/**
 * The term's assignments as three columns of cards, one per status.
 *
 * The list answers 「下一個到期的是什麼」; sorted by date, that is all it can
 * answer. This answers 「我手上正在做的是哪幾份」—— in the list those sit
 * scattered between things not started, because a deadline says nothing about
 * whether the work has begun.
 *
 * Dates still show on every card: a board that loses the deadline has traded
 * one question for another rather than adding one.
 */
interface Props {
  /** Already filtered by term and course, in due order. */
  assignments: Assignment[]
  courseById: Map<string, Course>
  /** Opens the full card; the board itself only moves things. */
  onOpen: (id: string) => void
}

export function AssignmentBoard({ assignments, courseById, onOpen }: Props) {
  // The id being dragged, so the card it left can fade while it is in the air.
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<AssignmentStatus | null>(null)

  function move(a: Assignment, to: AssignmentStatus) {
    if (a.status === to) return
    void updateAssignment(a.id, { status: to })
  }

  return (
    <div className="board">
      {ASSIGNMENT_STATUSES.map((status) => {
        const cards = assignments.filter((a) => a.status === status)
        return (
          <section
            key={status}
            className={`board-col${over === status ? ' is-over' : ''}`}
            aria-label={ASSIGNMENT_STATUS_LABEL[status]}
            onDragOver={(e) => {
              // Without preventDefault the browser refuses the drop, silently.
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setOver(status)
            }}
            onDragLeave={() => setOver((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault()
              setOver(null)
              const found = assignments.find((a) => a.id === e.dataTransfer.getData('text/plain'))
              if (found) move(found, status)
            }}
          >
            <h2 className="board-head">
              {ASSIGNMENT_STATUS_LABEL[status]}
              <span className="board-count">{cards.length}</span>
            </h2>

            <div className="board-cards">
              {cards.length === 0 ? (
                <p className="board-empty">把卡片移到這裡</p>
              ) : (
                cards.map((a) => (
                  <BoardCard
                    key={a.id}
                    assignment={a}
                    course={courseById.get(a.courseId)}
                    lifted={dragging === a.id}
                    onOpen={() => onOpen(a.id)}
                    onMove={(to) => move(a, to)}
                    onLift={setDragging}
                  />
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function BoardCard({
  assignment: a,
  course,
  lifted,
  onOpen,
  onMove,
  onLift,
}: {
  assignment: Assignment
  course?: Course
  lifted: boolean
  onOpen: () => void
  onMove: (to: AssignmentStatus) => void
  onLift: (id: string | null) => void
}) {
  const load = workloadOf(a)
  const at = ASSIGNMENT_STATUSES.indexOf(a.status)
  const back = ASSIGNMENT_STATUSES[at - 1]
  const on = ASSIGNMENT_STATUSES[at + 1]
  const doneCount = a.subtasks.filter((t) => t.done).length
  // 已完成 needs no 「已逾期」: the column has already said how it ended.
  const days = a.status === 'done' ? null : describeDays(load.daysLeft)

  return (
    <div
      className={`board-card${lifted ? ' is-lifted' : ''}`}
      style={{ borderLeftColor: course?.color ?? 'var(--line-strong)' }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', a.id)
        e.dataTransfer.effectAllowed = 'move'
        onLift(a.id)
      }}
      onDragEnd={() => onLift(null)}
    >
      {/* A button, not a clickable div: this is the way into the card, and a
          phone has no drag while a keyboard has no pointer. */}
      <button className="board-open" onClick={onOpen}>
        <span className="board-title">{a.title}</span>
        <span className="board-sub">
          {course?.name ?? '—'} · <span className="mono">{a.due}</span>
          {days && (
            <>
              {' · '}
              <span className={load.pressure === 'overdue' ? 'is-late' : undefined}>{days}</span>
            </>
          )}
        </span>
      </button>

      <div className="board-foot">
        {a.subtasks.length > 0 && <ProgressTag done={doneCount} total={a.subtasks.length} />}
        {a.status !== 'done' && load.hoursNeeded > 0 && (
          <span className="tag">還要 {load.hoursNeeded}h</span>
        )}
        {/* Always drawn, never on hover: dragging does not exist on a phone
            and cannot be reached from the keyboard at all. */}
        <div className="board-move">
          <button
            className="board-arrow"
            disabled={!back}
            aria-label={back ? `把「${a.title}」移到${ASSIGNMENT_STATUS_LABEL[back]}` : undefined}
            title={back ? ASSIGNMENT_STATUS_LABEL[back] : undefined}
            onClick={() => back && onMove(back)}
          >
            ‹
          </button>
          <button
            className="board-arrow"
            disabled={!on}
            aria-label={on ? `把「${a.title}」移到${ASSIGNMENT_STATUS_LABEL[on]}` : undefined}
            title={on ? ASSIGNMENT_STATUS_LABEL[on] : undefined}
            onClick={() => on && onMove(on)}
          >
            ›
          </button>
        </div>
      </div>
    </div>
  )
}
