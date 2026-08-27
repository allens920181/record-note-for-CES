import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addWorkBlock,
  createSessionOn,
  db,
  generateSessionsFromTimetable,
  renumberSessions,
} from '../db'
import type { MeetingKind, Recurrence } from '../db'
import { MEETING_KIND_LABEL } from '../db/schema'
import {
  addDays,
  addMonths,
  formatMonthTitle,
  formatRange,
  startOfWeek,
  timeOf,
  todayISO,
  weekdayOf,
} from '../lib/dates'
import { expandOccurrences } from '../schedule/occurrences'
import type { CalendarItem, ItemKind } from '../schedule/occurrences'
import { Breadcrumbs, TopBar } from '../components/Layout'
import { Modal } from '../components/Modal'
import { WeekCalendar } from '../components/WeekCalendar'
import { MonthCalendar } from '../components/MonthCalendar'
import { TermPicker, useTermChoice } from '../components/TermPicker'
import { TimeField } from '../components/TimeField'

type View = 'week' | 'month'

interface Draft {
  courseId: string
  kind: ItemKind
  repeat: Recurrence
  date: string
  start: string
  end: string
}

export function CalendarPage() {
  const navigate = useNavigate()
  const [view, setView] = useState<View>('week')
  const [anchor, setAnchor] = useState(todayISO())
  const [termId, setTermId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [message, setMessage] = useState<string | null>(null)

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

  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(() => setMessage(null), 4000)
    return () => window.clearTimeout(t)
  }, [message])

  function openDraft(date: string, startMin: number) {
    const first = courses?.[0]
    if (!first) {
      setMessage('這個學期還沒有課程，請先建立一門課。')
      return
    }
    setDraft({
      courseId: first.id,
      kind: 'lecture',
      repeat: 'weekly',
      date,
      start: timeOf(startMin),
      end: timeOf(Math.min(23 * 60 + 59, startMin + 120)),
    })
  }

  function openItem(item: CalendarItem) {
    // The term travels with the link: the assignments page scopes to one term,
    // and a deadline from any other one used to land on a page that had already
    // filtered it out — a click that visibly did nothing.
    if (item.assignmentId)
      navigate(`/assignments?term=${activeTermId ?? ''}#${item.assignmentId}`)
    else if (item.sessionId) navigate(`/session/${item.sessionId}`)
    else navigate(`/course/${item.courseId}`)
  }

  async function submitDraft() {
    if (!draft) return
    const { courseId, kind, repeat, date, start, end } = draft

    if (kind === 'work') {
      await addWorkBlock({
        courseId,
        repeat,
        ...(repeat === 'weekly' ? { weekday: weekdayOf(date) } : { date }),
        start,
        end,
      })
      setMessage(repeat === 'weekly' ? '已加入每週固定的作業時間。' : '已加入這一天的作業時間。')
      setDraft(null)
      return
    }

    const meetingKind = kind as MeetingKind
    if (repeat === 'once') {
      await createSessionOn(courseId, date, meetingKind, { start, end })
      await renumberSessions(courseId)
      setMessage(`已新增 ${date} 的${MEETING_KIND_LABEL[meetingKind]}。`)
      setDraft(null)
      return
    }

    // Weekly meetings become a timetable slot, then expand across the term —
    // creating one occurrence would silently lose the recurrence.
    const course = await db.courses.get(courseId)
    if (!course) return
    await db.courses.update(courseId, {
      slots: [...course.slots, { weekday: weekdayOf(date), start, end, kind: meetingKind }],
    })
    try {
      const { created } = await generateSessionsFromTimetable(courseId)
      await renumberSessions(courseId)
      setMessage(`已加入每週的${MEETING_KIND_LABEL[meetingKind]}，並產生 ${created} 個週次。`)
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
            onOpenItem={openItem}
          />
        ) : (
          <MonthCalendar
            anchor={anchor}
            items={items}
            onPickDay={(date) => openDraft(date, 9 * 60)}
            onOpenItem={openItem}
          />
        )}
      </main>

      {draft && (
        <Modal
          title="新增行程"
          onClose={() => setDraft(null)}
          onSubmit={submitDraft}
          submitLabel="建立"
        >
          <div className="field">
            <label htmlFor="d-course">課程</label>
            <select
              id="d-course"
              value={draft.courseId}
              onChange={(e) => setDraft({ ...draft, courseId: e.target.value })}
            >
              {(courses ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="d-kind">類型</label>
              <select
                id="d-kind"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as ItemKind })}
              >
                <option value="lecture">正課</option>
                <option value="discussion">分組討論</option>
                <option value="work">作業時間</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="d-repeat">重複</label>
              <select
                id="d-repeat"
                value={draft.repeat}
                onChange={(e) => setDraft({ ...draft, repeat: e.target.value as Recurrence })}
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
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
              <div className="hint">
                {draft.repeat === 'weekly'
                  ? `每週的這一天（週${['日', '一', '二', '三', '四', '五', '六'][weekdayOf(draft.date)]}）`
                  : '只發生在這一天'}
              </div>
            </div>
            <TimeField
              id="d-start"
              label="開始"
              value={draft.start}
              onChange={(v) => setDraft({ ...draft, start: v })}
            />
            <TimeField
              id="d-end"
              label="結束"
              value={draft.end}
              onChange={(v) => setDraft({ ...draft, end: v })}
            />
          </div>

          {draft.kind === 'work' ? (
            <div className="notice">作業時間不會產生錄音檔案，只用來算出還剩多少時間可以寫。</div>
          ) : draft.repeat === 'weekly' ? (
            <div className="notice">會寫進課表，並依學期週數一次產生整學期的週次。</div>
          ) : (
            <div className="notice">只會建立這一天的一個週次，不影響課表。</div>
          )}
        </Modal>
      )}
    </>
  )
}
