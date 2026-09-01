import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, sessionsInOrder } from '../db'
import { SESSION_KIND_LABEL } from '../db/schema'
import { TermPicker, useTermChoice } from './TermPicker'

const REMEMBERED = 'ces:sidebar'
const OPEN_COURSES = 'ces:sidebar-courses'
const WIDE = '(min-width: 60rem)'

const NAV = [
  { to: '/calendar', label: '行事曆' },
  { to: '/assignments', label: '作業' },
  { to: '/search', label: '搜尋' },
  { to: '/glossary', label: '詞彙表' },
  { to: '/settings', label: '設定' },
]

/** The remembered choice, or null when there is not one yet. */
function stored(): boolean | null {
  try {
    const saved = localStorage.getItem(REMEMBERED)
    return saved === null ? null : saved === '1'
  } catch {
    // A private window refusing storage only costs the memory of the choice.
    return null
  }
}

/**
 * Whether the sidebar is showing, remembered across visits.
 *
 * Narrow windows start closed: there the sidebar covers the page rather than
 * sitting beside it, and opening on top of what you asked for is not a welcome.
 *
 * The width is watched, not just read once. Leaving it open while the window
 * narrowed left a full-screen scrim over the page — every click swallowed by
 * something the reader never asked to open.
 */
function useSidebarOpen(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(() => {
    const saved = stored()
    if (saved !== null && typeof window !== 'undefined' && window.matchMedia(WIDE).matches) {
      return saved
    }
    return typeof window !== 'undefined' ? window.matchMedia(WIDE).matches : true
  })

  useEffect(() => {
    const mq = window.matchMedia(WIDE)
    const onChange = () => setOpen(mq.matches ? (stored() ?? true) : false)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const set = (v: boolean) => {
    setOpen(v)
    try {
      localStorage.setItem(REMEMBERED, v ? '1' : '0')
    } catch {
      // As above.
    }
  }
  return [open, set]
}

/** The courses left open in one term, or none when storage cannot be read. */
function storedCourses(termId: string | undefined): Set<string> {
  if (!termId) return new Set()
  try {
    const saved = localStorage.getItem(`${OPEN_COURSES}:${termId}`)
    const list: unknown = saved === null ? [] : JSON.parse(saved)
    if (!Array.isArray(list)) return new Set()
    return new Set(list.filter((id): id is string => typeof id === 'string'))
  } catch {
    // Storage refused, or something else wrote nonsense under the key.
    return new Set()
  }
}

/**
 * Which courses have their weeks showing, remembered across visits.
 *
 * A set, not one id. The rail used to close one course to open the next, so
 * two courses you were working across could never sit open together, and the
 * course you were in could not be collapsed for long — walking into it opened
 * it again. Each course carries its own twist now; keeping the rail short is
 * the reader's call, and 收合全部 is there for when it has grown long.
 *
 * Kept per term: a course id from last semester says nothing about this one.
 */
function useExpandedCourses(termId: string | undefined): {
  expanded: ReadonlySet<string>
  toggle: (courseId: string) => void
  expand: (courseId: string) => void
  collapseAll: () => void
} {
  const [state, setState] = useState(() => ({ termId, ids: storedCourses(termId) }))

  // Switching semester swaps the whole tree. The new term's set is read during
  // the render that changed rather than from an effect: an effect would land
  // after the one that opens the course you are on, and overwrite it.
  if (state.termId !== termId) setState({ termId, ids: storedCourses(termId) })

  const write = (ids: Set<string>) => {
    setState({ termId, ids })
    if (!termId) return
    try {
      localStorage.setItem(`${OPEN_COURSES}:${termId}`, JSON.stringify([...ids]))
    } catch {
      // As above: a refused write only costs the memory of the choice.
    }
  }

  return {
    expanded: state.ids,
    toggle: (courseId) => {
      const next = new Set(state.ids)
      // delete() reports whether it removed anything, which is the question.
      if (!next.delete(courseId)) next.add(courseId)
      write(next)
    },
    // A no-op once the course is open, so the effect that follows the reader
    // around can run on every course-list update without looping.
    expand: (courseId) => {
      if (state.ids.has(courseId)) return
      write(new Set(state.ids).add(courseId))
    },
    collapseAll: () => write(new Set()),
  }
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation()
  const params = useParams()
  const { termId, setTermId, terms } = useTermChoice()

  // On a week's page the tree still has to know which course that week is in.
  const openSession = useLiveQuery(
    async () => (params.sessionId ? ((await db.sessions.get(params.sessionId)) ?? null) : null),
    [params.sessionId],
  )
  const hereCourse = params.courseId ?? openSession?.courseId ?? null

  const courses = useLiveQuery(
    async () => (termId ? db.courses.where('termId').equals(termId).sortBy('createdAt') : []),
    [termId],
  )

  const { expanded, toggle, expand, collapseAll } = useExpandedCourses(termId)

  // The course you are looking at opens itself, and nothing closes for it.
  // Only a course of the term on show: the picker can be pointed at another
  // semester than the page you walked in on, and remembering an id the tree
  // will never draw is remembering it in the wrong term.
  useEffect(() => {
    if (hereCourse && (courses ?? []).some((c) => c.id === hereCourse)) expand(hereCourse)
    // `expand` is left out on purpose — it is rebuilt every render, and it
    // already does nothing when the course is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hereCourse, courses])

  const openIds = useMemo(
    () => (courses ?? []).filter((c) => expanded.has(c.id)).map((c) => c.id),
    [courses, expanded],
  )
  const weeks = useLiveQuery(async () => {
    const out = new Map<string, Awaited<ReturnType<typeof sessionsInOrder>>>()
    // Only the courses actually open: a term of five courses is seventy-odd
    // weeks, and none of them are on screen until someone asks.
    for (const id of openIds) out.set(id, await sessionsInOrder(id))
    return out
  }, [openIds.join(',')])

  return (
    <>
      {/* Only on narrow screens, where the sidebar floats over the page. */}
      <div className={`side-scrim${open ? ' is-open' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label="側邊導覽">
        <div className="side-top">
          <Link to="/" className="brand" onClick={onClose}>
            神學院錄音筆記
          </Link>
        </div>

        <nav className="side-nav" aria-label="主導覽">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`side-link${pathname === item.to ? ' is-here' : ''}`}
              onClick={onClose}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="side-sep" />

        <div className="side-term">
          <TermPicker
            termId={termId}
            terms={terms}
            onChange={setTermId}
            id="side-term"
            hideWhenSingle={false}
          />
        </div>

        <div className="side-tree">
          {/* One open course is one twist away from closed; several are the
              scroll this saves you. */}
          {openIds.length > 1 && (
            <div className="side-tree-top">
              <button className="side-collapse" onClick={collapseAll}>
                收合全部
              </button>
            </div>
          )}

          {courses === undefined ? (
            <p className="side-empty">載入中…</p>
          ) : courses.length === 0 ? (
            <p className="side-empty">
              這個學期還沒有課程。
              <br />
              <Link to={termId ? `/term/${termId}` : '/'} onClick={onClose}>
                去建立一門課 →
              </Link>
            </p>
          ) : (
            courses.map((course) => {
              const isOpen = expanded.has(course.id)
              const list = weeks?.get(course.id)
              return (
                <div key={course.id} className="side-course">
                  <div className={`side-row${hereCourse === course.id ? ' is-here' : ''}`}>
                    <button
                      className="side-twist"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? '收合' : '展開'}「${course.name}」的週次`}
                      onClick={() => toggle(course.id)}
                    >
                      {isOpen ? '▾' : '▸'}
                    </button>
                    <Link to={`/course/${course.id}`} className="side-course-name" onClick={onClose}>
                      <span className="side-dot" style={{ background: course.color }} />
                      {course.name}
                    </Link>
                  </div>

                  {isOpen &&
                    (list === undefined ? (
                      // Still being fetched. Saying 「還沒有週次」 here would be
                      // an empty state standing in for a loading one.
                      <p className="side-empty side-indent">載入中…</p>
                    ) : list.length === 0 ? (
                      <p className="side-empty side-indent">還沒有週次。</p>
                    ) : (
                      list.map((week) => (
                        <Link
                          key={week.id}
                          to={`/session/${week.id}`}
                          className={`side-week${params.sessionId === week.id ? ' is-here' : ''}${
                            week.canceled ? ' is-off' : ''
                          }`}
                          onClick={onClose}
                        >
                          第 {week.index} 週
                          <span className="side-week-kind">
                            {SESSION_KIND_LABEL[week.kind ?? 'lecture']}
                          </span>
                        </Link>
                      ))
                    ))}
                </div>
              )
            })
          )}
        </div>
      </aside>
    </>
  )
}

export { useSidebarOpen }
