import { useEffect, useMemo, useRef } from 'react'
import type { CalendarItem } from '../schedule/occurrences'
import { endOf, hourWindow, layOutDay } from '../schedule/occurrences'
import { WEEKDAY_SHORT, addDays, timeOf, todayISO, weekdayOf } from '../lib/dates'

/** Pixels per hour. Tall enough that a 1-hour block still reads. */
const HOUR_H = 52
/** Clicks snap to this, so dragging out an exact minute is never required. */
const SNAP_MIN = 30

interface Props {
  weekStart: string
  items: CalendarItem[]
  onPickSlot: (date: string, startMin: number) => void
  onOpenItem: (item: CalendarItem) => void
}

export function WeekCalendar({ weekStart, items, onPickSlot, onOpenItem }: Props) {
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )
  const { fromHour, toHour } = useMemo(() => hourWindow(items), [items])
  const gridHeight = (toHour - fromHour) * HOUR_H
  const today = todayISO()

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>()
    for (const day of days) map.set(day, [])
    for (const item of items) map.get(item.date)?.push(item)
    return map
  }, [days, items])

  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Evening classes sit at the bottom of a 14-hour grid, so opening at 08:00
  // shows an empty screen. Start where the week's first item actually is.
  const firstMin = useMemo(() => {
    const timed = items.map((i) => i.startMin).filter((m): m is number => m !== null)
    return timed.length > 0 ? Math.min(...timed) : null
  }, [items])

  useEffect(() => {
    const body = bodyRef.current
    if (!body || firstMin === null) return
    const target = ((firstMin - fromHour * 60) / 60) * HOUR_H - HOUR_H
    body.scrollTop = Math.max(0, target)
  }, [firstMin, fromHour, weekStart])

  function pickFrom(event: React.MouseEvent<HTMLDivElement>, date: string) {
    const rect = event.currentTarget.getBoundingClientRect()
    const minutes = fromHour * 60 + ((event.clientY - rect.top) / HOUR_H) * 60
    const snapped = Math.round(minutes / SNAP_MIN) * SNAP_MIN
    onPickSlot(date, Math.max(0, Math.min(23 * 60 + 30, snapped)))
  }

  return (
    <div className="wk">
      <div className="wk-head">
        <div className="wk-gutter" />
        {days.map((day) => (
          <div key={day} className={`wk-day-head${day === today ? ' is-today' : ''}`}>
            <span className="wk-dow">週{WEEKDAY_SHORT[weekdayOf(day)]}</span>
            <span className="wk-date mono">{day.slice(5).replace('-', '/')}</span>
          </div>
        ))}
      </div>

      {/* items with no usable time would otherwise be invisible */}
      {days.some((d) => (byDay.get(d) ?? []).some((i) => i.startMin === null)) && (
        <div className="wk-allday">
          <div className="wk-gutter small muted">未定時間</div>
          {days.map((day) => (
            <div key={day} className="wk-allday-cell">
              {(byDay.get(day) ?? [])
                .filter((i) => i.startMin === null)
                .map((item) => (
                  <button
                    key={item.key}
                    className={`cal-chip kind-${item.kind}${item.canceled ? ' is-canceled' : ''}`}
                    style={{ borderLeftColor: item.color }}
                    onClick={() => onOpenItem(item)}
                  >
                    {item.title}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      <div className="wk-body" ref={bodyRef}>
        <div className="wk-gutter wk-hours" style={{ height: gridHeight }}>
          {Array.from({ length: toHour - fromHour }, (_, i) => (
            <div key={i} className="wk-hour mono" style={{ height: HOUR_H }}>
              {String(fromHour + i).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {days.map((day) => {
          const laid = layOutDay(byDay.get(day) ?? [])
          return (
            <div
              key={day}
              className={`wk-col${day === today ? ' is-today' : ''}`}
              style={{ height: gridHeight, backgroundSize: `100% ${HOUR_H}px` }}
              onClick={(e) => {
                // Only bare grid clicks create; clicks on an item bubble-stop.
                if (e.currentTarget === e.target) pickFrom(e, day)
              }}
              title="點一下空白處新增"
            >
              {laid.map((item) => {
                const start = item.startMin ?? 0
                const top = ((start - fromHour * 60) / 60) * HOUR_H
                const height = Math.max(22, ((endOf(item) - start) / 60) * HOUR_H - 2)
                return (
                  <button
                    key={item.key}
                    className={`cal-block kind-${item.kind}${item.canceled ? ' is-canceled' : ''}`}
                    style={{
                      top,
                      height,
                      left: `${(item.column / item.columns) * 100}%`,
                      width: `calc(${100 / item.columns}% - 3px)`,
                      borderLeftColor: item.color,
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenItem(item)
                    }}
                  >
                    <span className="cal-time mono">{timeOf(start)}</span>
                    <span className="cal-title">{item.title}</span>
                    {item.detail && <span className="cal-detail">{item.detail}</span>}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
