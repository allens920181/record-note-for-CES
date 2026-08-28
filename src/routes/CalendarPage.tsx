import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import {
  addDays,
  addMonths,
  formatMonthTitle,
  formatRange,
  startOfWeek,
  todayISO,
} from '../lib/dates'
import { expandOccurrences } from '../schedule/occurrences'
import type { CalendarItem } from '../schedule/occurrences'
import { Breadcrumbs, TopBar } from '../components/Layout'
import { WeekCalendar } from '../components/WeekCalendar'
import { MonthCalendar } from '../components/MonthCalendar'
import { TermPicker, useTermChoice } from '../components/TermPicker'
import { CalendarItemCard } from '../components/CalendarItemCard'
import { TimeBlockDialog, createTimeBlock, makeDraft } from '../components/TimeBlockDialog'
import type { TimeBlockDraft } from '../components/TimeBlockDialog'

type View = 'week' | 'month'

export function CalendarPage() {
  const navigate = useNavigate()
  const [view, setView] = useState<View>('week')
  const [anchor, setAnchor] = useState(todayISO())
  const [termId, setTermId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TimeBlockDraft | null>(null)
  const [shownKey, setShownKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)

  const { termId: chosenTerm, setTermId: chooseTerm, terms } = useTermChoice()
  const activeTermId = termId ?? chosenTerm ?? null

  const courses = useLiveQuery(
    async () => (activeTermId ? db.courses.where('termId').equals(activeTermId).toArray() : []),
    [activeTermId],
  )

  const courseIds = useMemo(() => (courses ?? []).map((c) => c.id), [courses])

  // Opening on today shows an empty grid whenever the term hasn't started — the
  // exact situation of someone setting next semester up in advance. Jump to the
  // term instead, once, so later navigation is never fought.
  const anchoredTerm = useRef<string | null>(null)
  useEffect(() => {
    const term = terms?.find((t) => t.id === activeTermId)
    if (!term || anchoredTerm.current === term.id) return
    anchoredTerm.current = term.id
    const today = todayISO()
    if (today < term.startDate || today > term.endDate) setAnchor(term.startDate)
  }, [terms, activeTermId])

  const sessions = useLiveQuery(
    async () => (courseIds.length ? db.sessions.where('courseId').anyOf(courseIds).toArray() : []),
    [courseIds.join(',')],
  )
  const workBlocks = useLiveQuery(
    async () => (courseIds.length ? db.workBlocks.where('courseId').anyOf(courseIds).toArray() : []),
    [courseIds.join(',')],
  )
  const assignments = useLiveQuery(
    async () => (courseIds.length ? db.assignments.where('courseId').anyOf(courseIds).toArray() : []),
    [courseIds.join(',')],
  )

  const range = useMemo(() => {
    if (view === 'week') {
      const from = startOfWeek(anchor)
      return { from, to: addDays(from, 6) }
    }
    const first = `${anchor.slice(0, 7)}-01`
    const gridStart = startOfWeek(first)
    return { from: gridStart, to: addDays(gridStart, 41) }
  }, [view, anchor])

  const items = useMemo(
    () =>
      expandOccurrences({
        from: range.from,
        to: range.to,
        courses: courses ?? [],
        sessions: sessions ?? [],
        workBlocks: workBlocks ?? [],
        assignments: assignments ?? [],
      }),
    [range.from, range.to, courses, sessions, workBlocks, assignments],
  )

  // Holding the clicked object would freeze the card at the moment of the
  // click: cancelling a class, or moving it, would leave the card showing the
  // old state until it was closed and opened again. Look it up by key instead,
  // which also closes the card by itself once the item is deleted.
  const shown = useMemo(
    () => (shownKey ? (items.find((i) => i.key === shownKey) ?? null) : null),
    [items, shownKey],
  )

  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(() => setMessage(null), 4000)
    return () => window.clearTimeout(t)
  }, [message])

  function openDraft(date: string, startMin: number | null) {
    const first = courses?.[0]
    if (!first) {
      // A refusal, not an achievement — this used to be rendered in the success
      // colour, under a heading that promises clicking an empty slot works.
      setBlocked(true)
      return
    }
    setDraft(makeDraft(first, date, startMin))
  }

  function goTo(item: CalendarItem) {
    // The term travels with the link: the assignments page scopes to one term,
    // and a deadline from any other one used to land on a page that had already
    // filtered it out — a click that visibly did nothing.
    if (item.assignmentId)
      navigate(`/assignments?term=${activeTermId ?? ''}#${item.assignmentId}`)
    else if (item.sessionId) navigate(`/session/${item.sessionId}`)
    // Study time lives on the setup tab; landing on 週次 showed a page with no
    // sign of the thing that was clicked.
    else navigate(`/course/${item.courseId}?tab=setup`)
  }

  async function submitDraft() {
    if (!draft) return
    try {
      setMessage(await createTimeBlock(draft))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
    setDraft(null)
  }

  const title =
    view === 'week' ? formatRange(range.from, addDays(range.from, 6)) : formatMonthTitle(anchor)

  return (
    <>
      <TopBar>
        <Breadcrumbs items={[{ label: '行事曆' }]} />
      </TopBar>

      <main className="page" style={{ maxWidth: '78rem' }}>
        <div className="page-head">
          <div className="grow">
            <h1>行事曆</h1>
            <p>點一下空白處就能新增課程、分組討論或作業時間。點既有的項目會開啟那一週的筆記。</p>
          </div>
        </div>

        <div className="cal-bar">
          <div className="tabs" style={{ margin: 0, border: 0 }}>
            <button
              className={`tab${view === 'week' ? ' active' : ''}`}
              onClick={() => setView('week')}
            >
              週曆
            </button>
            <button
              className={`tab${view === 'month' ? ' active' : ''}`}
              onClick={() => setView('month')}
            >
              月曆
            </button>
          </div>

          <button
            className="btn sm"
            onClick={() => setAnchor(view === 'week' ? addDays(anchor, -7) : addMonths(anchor, -1))}
          >
            ← 上一{view === 'week' ? '週' : '月'}
          </button>
          <span className="cal-title-text">{title}</span>
          <button
            className="btn sm"
            onClick={() => setAnchor(view === 'week' ? addDays(anchor, 7) : addMonths(anchor, 1))}
          >
            下一{view === 'week' ? '週' : '月'} →
          </button>
          <button className="btn ghost sm" onClick={() => setAnchor(todayISO())}>
            回到今天
          </button>

          <span className="spacer" />

          <TermPicker
            termId={activeTermId ?? undefined}
            terms={terms}
            onChange={(id) => {
              setTermId(id)
              chooseTerm(id)
            }}
            id="cal-term"
          />
        </div>

        {message && (
          <div className="notice ok" style={{ marginBottom: '1rem' }}>
            {message}
          </div>
        )}

        {blocked && (
          <div className="notice warn" style={{ marginBottom: '1rem' }}>
            這個學期還沒有課程，行程要掛在某一門課底下。
            {activeTermId && (
              <>
                {' '}
                <Link to={`/term/${activeTermId}`}>去建立一門課 →</Link>
              </>
            )}
          </div>
        )}

        {courses && courses.length > 0 && (
          <div className="cal-legend">
            {courses.map((c) => (
              <span key={c.id} className="cal-legend-item">
                <span className="cal-swatch" style={{ background: c.color }} />
                {c.name}
              </span>
            ))}
          </div>
        )}

        {view === 'week' ? (
          <WeekCalendar
            weekStart={range.from}
            items={items}
            onPickSlot={openDraft}
            onOpenItem={(item) => setShownKey(item.key)}
          />
        ) : (
          <MonthCalendar
            anchor={anchor}
            items={items}
            onPickDay={(date) => openDraft(date, null)}
            onOpenItem={(item) => setShownKey(item.key)}
          />
        )}
      </main>

      {shown && (
        <CalendarItemCard
          item={shown}
          onClose={() => setShownKey(null)}
          onOpen={(item) => {
            setShownKey(null)
            goTo(item)
          }}
        />
      )}

      {draft && (
        <TimeBlockDialog
          draft={draft}
          onChange={setDraft}
          courses={courses ?? []}
          onClose={() => setDraft(null)}
          onSubmit={submitDraft}
        />
      )}
    </>
  )
}
