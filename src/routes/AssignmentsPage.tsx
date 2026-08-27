import { useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  createAssignment,
  db,
  deleteAssignment,
  makeSubTasks,
  todayISO,
  updateAssignment,
} from '../db'
import type { Assignment, AssignmentStatus, SubTask, WorkBlock } from '../db'
import { ASSIGNMENT_STATUS_LABEL, SUBTASK_TEMPLATES } from '../db/schema'
import { describeDays, workloadOf } from '../schedule/workload'
import type { Pressure } from '../schedule/workload'
import { Breadcrumbs, TopBar } from '../components/Layout'
import { Modal } from '../components/Modal'
import { TermPicker, useTermChoice } from '../components/TermPicker'

const PRESSURE_TAG: Record<Pressure, { cls: string; label: string } | null> = {
  done: { cls: 'ok', label: '已完成' },
  overdue: { cls: 'err', label: '已逾期' },
  tight: { cls: 'err', label: '時間不夠' },
  ok: { cls: 'ok', label: '時間夠' },
  unknown: null,
}

export function AssignmentsPage() {
  const { hash } = useLocation()
  const [urlParams] = useSearchParams()
  const [showDone, setShowDone] = useState(false)
  const [open, setOpen] = useState<string | null>(hash ? hash.slice(1) : null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ courseId: '', title: '', due: todayISO() })

  const { termId: remembered, setTermId, terms } = useTermChoice()
  // A deadline opened from the calendar names its own term; without that the
  // page would scope to the remembered one and hide the very row being linked.
  const linkedTerm = urlParams.get('term')
  const termId = linkedTerm && terms?.some((t) => t.id === linkedTerm) ? linkedTerm : remembered
  const [courseFilter, setCourseFilter] = useState('')
  const courses = useLiveQuery(
    async () => (termId ? db.courses.where('termId').equals(termId).toArray() : []),
    [termId],
  )
  const courseIds = useMemo(
    () =>
      (courses ?? [])
        .filter((c) => !courseFilter || c.id === courseFilter)
        .map((c) => c.id),
    [courses, courseFilter],
  )

  const assignments = useLiveQuery(
    async () =>
      courseIds.length ? db.assignments.where('courseId').anyOf(courseIds).toArray() : [],
    [courseIds.join(',')],
  )
  const workBlocks = useLiveQuery(
    async () => (courseIds.length ? db.workBlocks.where('courseId').anyOf(courseIds).toArray() : []),
    [courseIds.join(',')],
  )

  const blocksByCourse = useMemo(() => {
    const map = new Map<string, WorkBlock[]>()
    for (const b of workBlocks ?? []) {
      const list = map.get(b.courseId)
      if (list) list.push(b)
      else map.set(b.courseId, [b])
    }
    return map
  }, [workBlocks])

  const courseById = useMemo(() => new Map((courses ?? []).map((c) => [c.id, c])), [courses])

  const rows = useMemo(() => {
    const list = (assignments ?? []).filter((a) => showDone || a.status !== 'done')
    return list
      .map((a) => ({ a, load: workloadOf(a, blocksByCourse.get(a.courseId) ?? []) }))
      .sort((x, y) => x.a.due.localeCompare(y.a.due) || x.a.title.localeCompare(y.a.title))
  }, [assignments, blocksByCourse, showDone])

  async function submitNew() {
    const title = form.title.trim()
    const courseId = form.courseId || courses?.[0]?.id
    if (!title || !courseId) return
    const id = await createAssignment({ courseId, title, due: form.due })
    setForm({ courseId, title: '', due: form.due })
    setCreating(false)
    setOpen(id)
  }

  return (
    <>
      <TopBar>
        <Breadcrumbs items={[{ label: '作業' }]} />
      </TopBar>

      <main className="page">
        <div className="page-head">
          <div className="grow">
            <h1>作業</h1>
            <p>
              依截止日排序。「時間夠不夠」是拿子任務的預估時數，
              對照課表裡到截止日為止真正排了多少作業時間算出來的。
            </p>
          </div>
          <TermPicker termId={termId} terms={terms} onChange={setTermId} id="a-term" />
          {(courses?.length ?? 0) > 1 && (
            <div className="field" style={{ flex: '0 0 11rem', marginBottom: 0 }}>
              <label htmlFor="a-course">課程</label>
              <select
                id="a-course"
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
              >
                <option value="">全部課程</option>
                {(courses ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            className="btn primary"
            style={{ flex: '0 0 auto' }}
            disabled={!courses?.length}
            onClick={() => {
              setForm({ courseId: courseFilter || courses?.[0]?.id || '', title: '', due: todayISO() })
              setCreating(true)
            }}
          >
            新增作業
          </button>
        </div>

        <div className="row" style={{ gap: '.6rem', marginBottom: '1rem' }}>
          <button
            className={`btn sm${showDone ? '' : ' primary'}`}
            style={{ flex: '0 0 auto' }}
            onClick={() => setShowDone(false)}
          >
            未完成
          </button>
          <button
            className={`btn sm${showDone ? ' primary' : ''}`}
            style={{ flex: '0 0 auto' }}
            onClick={() => setShowDone(true)}
          >
            全部
          </button>
        </div>

        {/* Courses load before assignments can be asked for, and an empty course
            list yields an empty (not undefined) assignment list — so checking
            only `assignments` reports "沒有未完成的作業" during every load. */}
        {termId === undefined || courses === undefined || assignments === undefined ? (
          <div className="empty">載入中…</div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <p>{showDone ? '還沒有任何作業。' : '沒有未完成的作業。'}</p>
          </div>
        ) : (
          <div className="stack">
            {rows.map(({ a, load }) => {
              const course = courseById.get(a.courseId)
              const tag = PRESSURE_TAG[load.pressure]
              const doneCount = a.subtasks.filter((t) => t.done).length
              return (
                <div key={a.id} className="card asg" id={a.id}>
                  <div className="asg-head" onClick={() => setOpen(open === a.id ? null : a.id)}>
                    <span
                      className="swatch"
                      style={{ background: course?.color ?? 'var(--line-strong)' }}
                    />
                    <div className="grow">
                      <div className="title">{a.title}</div>
                      <div className="sub">
                        {course?.name ?? '—'} · <span className="mono">{a.due}</span> ·{' '}
                        {describeDays(load.daysLeft)}
                      </div>
                    </div>
                    {a.subtasks.length > 0 && (
                      <span className="tag">
                        {doneCount} / {a.subtasks.length}
                      </span>
                    )}
                    {load.hoursNeeded > 0 && (
                      // Short on hours is short on hours — an overdue item with
                      // 0h left must not read green just because it isn't 'tight'.
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
                    <button className="btn ghost sm">{open === a.id ? '收合' : '展開'}</button>
                  </div>

                  {open === a.id && (
                    <AssignmentDetail
                      assignment={a}
                      hoursAvailable={load.hoursAvailable}
                      onDelete={async () => {
                        if (confirm(`刪除「${a.title}」？`)) await deleteAssignment(a.id)
                      }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>

      {creating && (
        <Modal
          title="新增作業"
          onClose={() => setCreating(false)}
          onSubmit={submitNew}
          submitLabel="建立"
          submitDisabled={!form.title.trim()}
        >
          <div className="field">
            <label htmlFor="a-title">作業名稱</label>
            <input
              id="a-title"
              type="text"
              autoFocus
              placeholder="期末報告：加爾文的預定論"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="a-course">課程</label>
              <select
                id="a-course"
                value={form.courseId}
                onChange={(e) => setForm({ ...form, courseId: e.target.value })}
              >
                {(courses ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="a-due">截止日</label>
              <input
                id="a-due"
                type="date"
                value={form.due}
                onChange={(e) => setForm({ ...form, due: e.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}
    </>
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
  const [newTask, setNewTask] = useState('')

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
          <input
            id={`dt-${assignment.id}`}
            type="text"
            placeholder="23:59"
            value={assignment.dueTime ?? ''}
            onChange={(e) => void updateAssignment(assignment.id, { dueTime: e.target.value })}
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
      {assignment.subtasks.length === 0 ? (
        <p className="small muted" style={{ margin: '.3rem 0 .7rem' }}>
          還沒拆解。可以直接套一個範本：
        </p>
      ) : (
        <div className="stack" style={{ margin: '.6rem 0' }}>
          {assignment.subtasks.map((task, i) => (
            <div key={task.id} className="row subtask" style={{ gap: '.5rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={task.done}
                style={{ width: '1rem', flex: '0 0 auto' }}
                onChange={(e) =>
                  patchTasks(
                    assignment.subtasks.map((t, j) =>
                      j === i ? { ...t, done: e.target.checked } : t,
                    ),
                  )
                }
              />
              <input
                type="text"
                className="grow"
                value={task.title}
                onChange={(e) =>
                  patchTasks(
                    assignment.subtasks.map((t, j) =>
                      j === i ? { ...t, title: e.target.value } : t,
                    ),
                  )
                }
              />
              <input
                type="number"
                min={0}
                step={0.5}
                placeholder="時數"
                style={{ flex: '0 0 5.5rem' }}
                value={task.estimateHours ?? ''}
                onChange={(e) =>
                  patchTasks(
                    assignment.subtasks.map((t, j) =>
                      j === i
                        ? { ...t, estimateHours: e.target.value ? Number(e.target.value) : undefined }
                        : t,
                    ),
                  )
                }
              />
              <button
                className="btn danger sm"
                style={{ flex: '0 0 auto' }}
                onClick={() => patchTasks(assignment.subtasks.filter((_, j) => j !== i))}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: '.5rem', marginBottom: '.8rem' }}>
        {SUBTASK_TEMPLATES.map((t) => (
          <button
            key={t.name}
            className="btn sm"
            style={{ flex: '0 0 auto' }}
            onClick={() => patchTasks([...assignment.subtasks, ...makeSubTasks(t.steps)])}
          >
            套用「{t.name}」
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: '.5rem' }}>
        <input
          type="text"
          className="grow"
          placeholder="再加一個步驟"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !newTask.trim()) return
            e.preventDefault()
            patchTasks([...assignment.subtasks, ...makeSubTasks([newTask.trim()])])
            setNewTask('')
          }}
        />
        <button
          className="btn"
          style={{ flex: '0 0 auto' }}
          disabled={!newTask.trim()}
          onClick={() => {
            patchTasks([...assignment.subtasks, ...makeSubTasks([newTask.trim()])])
            setNewTask('')
          }}
        >
          加入
        </button>
      </div>

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
