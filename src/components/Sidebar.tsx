import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, sessionsInOrder } from '../db'
import { SESSION_KIND_LABEL } from '../db/schema'
import { TermPicker, useTermChoice } from './TermPicker'

const REMEMBERED = 'ces:sidebar'
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

  // One at a time. A course is fifteen weeks — two of them expanded pushed
  // every other course off the bottom of the rail, and moving between courses
  // is what the rail is for.
  const [expanded, setExpanded] = useState<string | null>(null)
  useEffect(() => {
    if (hereCourse) setExpanded(hereCourse)
  }, [hereCourse])

  const openIds = useMemo(
    () => (courses ?? []).filter((c) => c.id === expanded).map((c) => c.id),
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
              const isOpen = expanded === course.id
              const list = weeks?.get(course.id) ?? []
              return (
                <div key={course.id} className="side-course">
                  <div className={`side-row${hereCourse === course.id ? ' is-here' : ''}`}>
                    <button
                      className="side-twist"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? '收合' : '展開'}「${course.name}」的週次`}
                      onClick={() => setExpanded(isOpen ? null : course.id)}
                    >
                      {isOpen ? '▾' : '▸'}
                    </button>
                    <Link to={`/course/${course.id}`} className="side-course-name" onClick={onClose}>
                      <span className="side-dot" style={{ background: course.color }} />
                      {course.name}
                    </Link>
                  </div>

                  {isOpen &&
                    (list.length === 0 ? (
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
