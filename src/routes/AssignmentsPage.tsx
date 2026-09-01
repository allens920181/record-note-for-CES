import { useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { Breadcrumbs, TopBar } from '../components/Layout'
import { TermPicker, useTermChoice } from '../components/TermPicker'
import {
  AssignmentCard,
  AssignmentDetail,
  NewAssignmentDialog,
  useDeleteAssignment,
} from '../components/AssignmentCard'
import { AssignmentBoard } from '../components/AssignmentBoard'
import { Modal } from '../components/Modal'

const VIEW_KEY = 'ces:assignments-view'

type View = 'list' | 'board'

/** The remembered view, defaulting to the list. */
function storedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'list'
  } catch {
    // A private window refusing storage only costs the memory of the choice.
    return 'list'
  }
}

export function AssignmentsPage() {
  const { hash } = useLocation()
  const [urlParams] = useSearchParams()
  const [showDone, setShowDone] = useState(false)
  const [view, setView] = useState<View>(storedView)
  const [open, setOpen] = useState<string | null>(hash ? hash.slice(1) : null)
  const [creating, setCreating] = useState<string | null>(null)
  const remove = useDeleteAssignment()

  function chooseView(next: View) {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // As above.
    }
  }

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

  const courseById = useMemo(() => new Map((courses ?? []).map((c) => [c.id, c])), [courses])

  const byDue = useMemo(
    () =>
      [...(assignments ?? [])].sort(
        (x, y) => x.due.localeCompare(y.due) || x.title.localeCompare(y.title),
      ),
    [assignments],
  )
  // The board has a 已完成 column, so filtering those away there would leave a
  // column that is empty by construction. Only the list hides them.
  const rows = useMemo(
    () => (view === 'board' ? byDue : byDue.filter((a) => showDone || a.status !== 'done')),
    [byDue, showDone, view],
  )
  const openCard = useMemo(() => byDue.find((a) => a.id === open) ?? null, [byDue, open])

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
              {view === 'board'
                ? '依狀態分欄。用卡片上的箭頭換一欄，桌機也可以直接拖。'
                : '依截止日排序。拆解步驟並填上預估時數，就看得出還要多久。'}
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
            onClick={() => setCreating(courseFilter || courses?.[0]?.id || '')}
          >
            新增作業
          </button>
        </div>

        <div className="row" style={{ gap: '.6rem', marginBottom: '1rem' }}>
          {/* aria-pressed as well as the fill: which one is on is a state, and
              a colour is not readable as one. */}
          <button
            className={`btn sm${view === 'list' ? ' primary' : ''}`}
            style={{ flex: '0 0 auto' }}
            aria-pressed={view === 'list'}
            onClick={() => chooseView('list')}
          >
            清單
          </button>
          <button
            className={`btn sm${view === 'board' ? ' primary' : ''}`}
            style={{ flex: '0 0 auto' }}
            aria-pressed={view === 'board'}
            onClick={() => chooseView('board')}
          >
            看板
          </button>
          {view === 'list' && (
            <>
              <span className="toolbar-sep" />
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
            </>
          )}
        </div>

        {/* Courses load before assignments can be asked for, and an empty course
            list yields an empty (not undefined) assignment list — so checking
            only `assignments` reports "沒有未完成的作業" during every load. */}
        {termId === undefined || courses === undefined || assignments === undefined ? (
          <div className="empty">載入中…</div>
        ) : rows.length === 0 ? (
          <div className="empty">
            {courses.length === 0 ? (
              <>
                <p>
                  這個學期還沒有課程。作業要掛在某一門課底下，所以得先有課。
                </p>
                {/* Not「新增作業」— that button would fail, and offering an
                    action that cannot work is worse than offering none. */}
                <Link className="btn primary" to={`/term/${termId}`}>
                  去建立一門課 →
                </Link>
              </>
            ) : showDone || view === 'board' ? (
              <>
                <p>這個學期還沒有任何作業。</p>
                <button
                  className="btn primary"
                  onClick={() => setCreating(courseFilter || courses[0].id)}
                >
                  新增作業
                </button>
              </>
            ) : (
              <>
                <p>沒有未完成的作業。</p>
                <button className="btn" onClick={() => setShowDone(true)}>
                  看全部（含已完成）
                </button>
              </>
            )}
          </div>
        ) : view === 'board' ? (
          <AssignmentBoard assignments={rows} courseById={courseById} onOpen={setOpen} />
        ) : (
          <div className="stack">
            {rows.map((a) => (
              <AssignmentCard
                key={a.id}
                assignment={a}
                course={courseById.get(a.courseId)}
                open={open === a.id}
                onToggle={() => setOpen(open === a.id ? null : a.id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* On the board a card opens in a dialog rather than in place: the
          columns are a third of the page wide, and everything inside a card —
          three fields, the brief, the steps — needs the whole of it. */}
      {view === 'board' && openCard && (
        <Modal wide title={openCard.title} onClose={() => setOpen(null)} cancelLabel="關閉">
          <AssignmentDetail
            assignment={openCard}
            onDelete={async () => {
              await remove(openCard)
              setOpen(null)
            }}
          />
        </Modal>
      )}

      {creating !== null && (
        <NewAssignmentDialog
          courses={courses ?? []}
          courseId={creating}
          onClose={() => setCreating(null)}
          onCreated={(id) => {
            setCreating(null)
            setOpen(id)
          }}
        />
      )}
    </>
  )
}

