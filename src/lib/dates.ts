/** Calendar date helpers. All dates are ISO `yyyy-mm-dd` in local time. */

export function todayISO(): string {
  return toISO(new Date())
}

export function toISO(d: Date): string {
  // Not toISOString(): that converts to UTC and can shift the day.
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromISO(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

export function addDays(iso: string, days: number): string {
  const d = fromISO(iso)
  d.setDate(d.getDate() + days)
  return toISO(d)
}

export function addMonths(iso: string, months: number): string {
  const d = fromISO(iso)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  // Clamp: adding a month to the 31st must not spill into the next one.
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return toISO(d)
}

export function weekdayOf(iso: string): number {
  return fromISO(iso).getDay()
}

/** Monday-based, matching how a class timetable is usually read. */
export function startOfWeek(iso: string): string {
  const wd = weekdayOf(iso)
  return addDays(iso, wd === 0 ? -6 : 1 - wd)
}

/** First cell of a month grid: the Monday on or before the 1st. */
export function startOfMonthGrid(iso: string): string {
  const d = fromISO(iso)
  d.setDate(1)
  return startOfWeek(toISO(d))
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** Minutes since midnight, or null when the time is missing or malformed. */
export function minutesOf(time: string | undefined | null): number | null {
  if (!time) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

export function timeOf(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'] as const

export function formatMonthTitle(iso: string): string {
  const d = fromISO(iso)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
}

export function formatRange(from: string, to: string): string {
  const a = fromISO(from)
  const b = fromISO(to)
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
  return sameMonth
    ? `${a.getFullYear()} 年 ${a.getMonth() + 1} 月 ${a.getDate()}–${b.getDate()} 日`
    : `${a.getMonth() + 1}/${a.getDate()} – ${b.getMonth() + 1}/${b.getDate()}`
}
