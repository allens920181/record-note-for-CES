import { useMemo } from 'react'
import type { CalendarItem } from '../schedule/occurrences'
import { WEEKDAY_SHORT, addDays, monthOf, startOfMonthGrid, timeOf, todayISO } from '../lib/dates'

/** Six rows always, so the grid does not jump height between months. */
const ROWS = 6
const MAX_CHIPS = 3

interface Props {
  /** Any date inside the month being shown. */
  anchor: string
  items: CalendarItem[]
  onPickDay: (date: string) => void
  onOpenItem: (item: CalendarItem) => void
  /** Show everything on one day — the month grid only has room for three. */
  onOpenDay: (date: string) => void
}

export function MonthCalendar({ anchor, items, onPickDay, onOpenItem, onOpenDay }: Props) {
  const gridStart = startOfMonthGrid(anchor)
  const month = monthOf(anchor)
  const today = todayISO()

  const days = useMemo(
    () => Array.from({ length: ROWS * 7 }, (_, i) => addDays(gridStart, i)),
    [gridStart],
  )
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>()
    for (const item of items) {
      const list = map.get(item.date)
      if (list) list.push(item)
      else map.set(item.date, [item])
    }
    return map
  }, [items])

  return (
    <div className="mo">
      <div className="mo-head">
        {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
          <div key={wd} className="mo-dow">
            週{WEEKDAY_SHORT[wd]}
          </div>
        ))}
      </div>
      <div className="mo-grid">
        {days.map((day) => {
          const dayItems = byDay.get(day) ?? []
          const shown = dayItems.slice(0, MAX_CHIPS)
          const hidden = dayItems.length - shown.length
          return (
            <div
              key={day}
              className={`mo-cell${monthOf(day) === month ? '' : ' is-outside'}${
                day === today ? ' is-today' : ''
              }`}
              onClick={(e) => {
                if (e.currentTarget === e.target) onPickDay(day)
              }}
              title="點一下空白處新增"
            >
              <span className="mo-num mono">{Number(day.slice(8))}</span>
              {shown.map((item) => (
                <button
                  key={item.key}
                  className={`cal-chip kind-${item.kind}${item.canceled ? ' is-canceled' : ''}`}
                  style={{ borderLeftColor: item.color }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenItem(item)
                  }}
                >
                  {item.startMin !== null && (
                    <span className="mono">{timeOf(item.startMin)} </span>
                  )}
                  {item.title}
                </button>
              ))}
              {hidden > 0 && (
                // It used to be plain text, so a busy day simply withheld the
                // rest with no way to ask for them.
                <button
                  className="mo-more"
                  title={`看 ${day} 這一天的全部行程`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenDay(day)
                  }}
                >
                  還有 {hidden} 項 →
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
