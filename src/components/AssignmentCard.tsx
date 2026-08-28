import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  createAssignment,
  deleteAssignment,
  todayISO,
  updateAssignment,
} from '../db'
import type { Assignment, AssignmentStatus, Course, SubTask, WorkBlock } from '../db'
import { ASSIGNMENT_STATUS_LABEL, SUBTASK_TEMPLATES } from '../db/schema'
import { newId } from '../lib/id'
import { TaskChecklist } from './TaskChecklist'
import { describeDays, workloadOf } from '../schedule/workload'
import type { Pressure } from '../schedule/workload'
import { Modal } from './Modal'
import { TimeField } from './TimeField'
import { useConfirm } from './ConfirmProvider'

const PRESSURE_TAG: Record<Pressure, { cls: string; label: string } | null> = {
  done: { cls: 'ok', label: '已完成' },
  overdue: { cls: 'err', label: '已逾期' },
  tight: { cls: 'err', label: '時間不夠' },
  ok: { cls: 'ok', label: '時間夠' },
  unknown: null,
}

interface Props {
  assignment: Assignment
  /** The course it belongs to, for the colour stripe and the subtitle. */
  course?: Course
  /** That course's study blocks — how many hours are left before the deadline. */
  blocks: WorkBlock[]
  open: boolean
  onToggle: () => void
  /** Off inside one course's own page, where every row would repeat the name. */
  showCourse?: boolean
}

/**
 * One assignment, closed to a single line and opened to everything.
 *
 * The course page promised 「這門課的作業」 and then showed a link to a
 * different page, because the only copy of this markup lived inside the
 * assignments route. Both places now render the same card, so a deadline looks
 * and behaves the same wherever it is met.
 */
export function AssignmentCard({
  assignment: a,
  course,
  blocks,
  open,
  onToggle,
  showCourse = true,
}: Props) {
  const ask = useConfirm()
  const load = workloadOf(a, blocks)
  const tag = PRESSURE_TAG[load.pressure]
  const doneCount = a.subtasks.filter((t) => t.done).length

  return (
    <div className="card asg" id={a.id}>
      <div className="asg-head" onClick={onToggle}>
        <span className="swatch" style={{ background: course?.color ?? 'var(--line-strong)' }} />
        <div className="grow">
          <div className="title">{a.title}</div>
          <div className="sub">
            {showCourse && `${course?.name ?? '—'} · `}
            <span className="mono">{a.due}</span> · {describeDays(load.daysLeft)}
          </div>
        </div>
        {a.subtasks.length > 0 && (
          <span className="tag">
            {doneCount} / {a.subtasks.length}
          </span>
        )}
        {load.hoursNeeded > 0 && (
          // Short on hours is short on hours — an overdue item with 0h left
          // must not read green just because it isn't 'tight'.
          <span
            className={`tag ${
              load.hoursAvailable < load.hoursNeeded && a.status !== 'done' ? 'err' : 'ok'
            }`}
          >
            需 {load.hoursNeeded}h / 有 {load.hoursAvailable}h
          </span>
        )}
        {tag && <span className={`tag ${tag.cls}`}>{tag.label}</span>}
        <span className="tag">{ASSIGNMENT_STATUS_LABEL[a.status]}</span>
        <button className="btn ghost sm">{open ? '收合' : '展開'}</button>
      </div>

      {open && (
        <AssignmentDetail
          assignment={a}
          hoursAvailable={load.hoursAvailable}
          onDelete={async () => {
            const go = await ask({
              title: `刪除作業「${a.title}」？`,
              danger: true,
              confirmLabel: '刪除這份作業',
              // An assignment nobody has broken down yet was offered "0 個步驟
              // 也會一起消失", which is both untrue and faintly absurd.
              body:
                a.subtasks.length > 0
                  ? `拆解出來的 ${a.subtasks.length} 個步驟也會一起消失。`
                  : '這份作業的要求與備註也會一起消失。',
            })
            if (go) await deleteAssignment(a.id)
          }}
        />
      )}
    </div>
  )
}

function AssignmentDetail({
  assignment,
  hoursAvailable,
  onDelete,
}: {
  assignment: Assignment
  hoursAvailable: number
  onDelete: () => void
}) {
  function patchTasks(subtasks: SubTask[]) {
    void updateAssignment(assignment.id, { subtasks })
  }

  const needed = assignment.subtasks
    .filter((t) => !t.done)
    .reduce((s, t) => s + (t.estimateHours ?? 0), 0)

  return (
    <div className="asg-detail">
      <div className="row">
        <div className="field">
          <label htmlFor={`st-${assignment.id}`}>狀態</label>
          <select
            id={`st-${assignment.id}`}
            value={assignment.status}
            onChange={(e) =>
              void updateAssignment(assignment.id, {
                status: e.target.value as AssignmentStatus,
              })
            }
          >
            {(Object.keys(ASSIGNMENT_STATUS_LABEL) as AssignmentStatus[]).map((k) => (
              <option key={k} value={k}>
                {ASSIGNMENT_STATUS_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`due-${assignment.id}`}>截止日</label>
          <input
            id={`due-${assignment.id}`}
            type="date"
            value={assignment.due}
            onChange={(e) => void updateAssignment(assignment.id, { due: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`dt-${assignment.id}`}>截止時間</label>
          <TimeField
            id={`dt-${assignment.id}`}
            value={assignment.dueTime ?? ''}
            allowEmpty
            onChange={(v) => void updateAssignment(assignment.id, { dueTime: v || undefined })}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor={`n-${assignment.id}`}>要求與備註</label>
        <textarea
          id={`n-${assignment.id}`}
          rows={3}
          placeholder="3000 字、Turabian 格式、至少五筆學術文獻"
          defaultValue={assignment.notes}
          onBlur={(e) => void updateAssignment(assignment.id, { notes: e.target.value })}
        />
      </div>

      <h3 style={{ marginTop: '1.2rem' }}>拆解步驟</h3>
      {/* `estimateHours` is this table's name for the same number the week
          plan calls `hours`; mapping it here keeps the stored shape untouched. */}
      <TaskChecklist
        items={assignment.subtasks.map((t) => ({
          id: t.id,
          title: t.title,
          done: t.done,
          hours: t.estimateHours,
        }))}
        onChange={(next) =>
          patchTasks(
            next.map((i) => ({
              id: i.id,
              title: i.title,
              done: i.done,
              estimateHours: i.hours,
            })),
          )
        }
        makeId={() => newId('st')}
        templates={SUBTASK_TEMPLATES}
        addPlaceholder="再加一個步驟"
        emptyText="還沒拆解。可以直接套一個範本："
      />

      <div className="notice" style={{ marginTop: '1rem' }}>
        {needed > 0 ? (
          <>
            剩下的步驟預估需要 <strong>{needed} 小時</strong>，
            到截止日為止這門課排了 <strong>{hoursAvailable} 小時</strong>作業時間。
            {hoursAvailable < needed && (
              <span style={{ color: 'var(--danger)' }}>
                {' '}
                差 {Math.round((needed - hoursAvailable) * 10) / 10} 小時——
                要嘛在<Link to="/calendar">行事曆</Link>多排時間，要嘛把範圍縮小。
              </span>
            )}
          </>
        ) : (
          <>
            替步驟填上預估時數，就能知道到截止日為止的{' '}
            <strong>{hoursAvailable} 小時</strong>作業時間夠不夠。
          </>
        )}
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
        <button className="btn danger sm" style={{ flex: '0 0 auto' }} onClick={onDelete}>
          刪除這份作業
        </button>
      </div>
    </div>
  )
}

/**
 * The create dialog, shared so a deadline made from a course page is the same
 * row as one made from the assignments page.
 *
 * `courses` with one entry means the course is already decided by where you
 * are, and the picker is left out rather than shown with a single option.
 *
 * The fields are prefixed `na-` because the assignments page has its own
 * `a-course` filter: two elements shared that id whenever the dialog was open,
 * and the dialog's label pointed at the select behind it.
 */
export function NewAssignmentDialog({
  courses,
  courseId,
  onClose,
  onCreated,
}: {
  courses: Course[]
  courseId: string
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [form, setForm] = useState({ courseId, title: '', due: todayISO() })

  async function submit() {
    const title = form.title.trim()
    const id = form.courseId || courseId
    if (!title || !id) return
    onCreated(await createAssignment({ courseId: id, title, due: form.due }))
  }

  return (
    <Modal
      title="新增作業"
      onClose={onClose}
      onSubmit={submit}
      submitLabel="建立"
      submitDisabled={!form.title.trim()}
    >
      <div className="field">
        <label htmlFor="na-title">作業名稱</label>
        <input
          id="na-title"
          type="text"
          autoFocus
          placeholder="期末報告：加爾文的預定論"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </div>
      <div className="row">
        {courses.length > 1 && (
          <div className="field">
            <label htmlFor="na-course">課程</label>
            <select
              id="na-course"
              value={form.courseId}
              onChange={(e) => setForm({ ...form, courseId: e.target.value })}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="na-due">截止日</label>
          <input
            id="na-due"
            type="date"
            value={form.due}
            onChange={(e) => setForm({ ...form, due: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  )
}
