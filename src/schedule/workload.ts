import type { Assignment, WorkBlock } from '../db'
import { addDays, todayISO, weekdayOf } from '../lib/dates'
import { hoursBetween } from '../lib/time'

/**
 * How much study time a course actually has between two dates.
 *
 * Weekly blocks are rules, so their hours have to be counted per matching
 * weekday in the window rather than multiplied by a rough number of weeks —
 * "three weeks away" and "three Sundays away" are not the same thing when the
 * deadline lands mid-week.
 */
export function availableHours(blocks: WorkBlock[], from: string, to: string): number {
  if (to < from) return 0
  let total = 0

  const weekly = blocks.filter((b) => b.repeat === 'weekly' && b.weekday !== undefined)
  const once = blocks.filter((b) => b.repeat === 'once' && b.date)

  if (weekly.length > 0) {
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const wd = weekdayOf(date)
      for (const block of weekly) {
        if (block.weekday === wd) total += hoursBetween(block.start, block.end)
      }
    }
  }
  for (const block of once) {
    if (block.date! >= from && block.date! <= to) total += hoursBetween(block.start, block.end)
  }

  return Math.round(total * 10) / 10
}

export function daysUntil(due: string, from = todayISO()): number {
  const a = new Date(`${from}T00:00:00`).getTime()
  const b = new Date(`${due}T00:00:00`).getTime()
  return Math.round((b - a) / 86_400_000)
}

export type Pressure = 'done' | 'overdue' | 'tight' | 'ok' | 'unknown'

export interface Workload {
  daysLeft: number
  /** Study hours scheduled between today and the deadline. */
  hoursAvailable: number
  /** Hours the remaining subtasks are estimated to need. */
  hoursNeeded: number
  pressure: Pressure
}

/**
 * Compares what a piece of work still needs against the time actually set aside
 * for it. A deadline three weeks out with no study blocks before it is the case
 * a plain countdown hides.
 */
export function workloadOf(
  assignment: Assignment,
  blocks: WorkBlock[],
  today = todayISO(),
): Workload {
  const daysLeft = daysUntil(assignment.due, today)
  const hoursAvailable = availableHours(blocks, today, assignment.due)
  const hoursNeeded = assignment.subtasks
    .filter((t) => !t.done)
    .reduce((sum, t) => sum + (t.estimateHours ?? 0), 0)

  let pressure: Pressure
  if (assignment.status === 'done') pressure = 'done'
  else if (daysLeft < 0) pressure = 'overdue'
  else if (hoursNeeded === 0) pressure = 'unknown'
  else if (hoursAvailable < hoursNeeded) pressure = 'tight'
  else pressure = 'ok'

  return { daysLeft, hoursAvailable, hoursNeeded, pressure }
}

export function describeDays(daysLeft: number): string {
  if (daysLeft < 0) return `已逾期 ${Math.abs(daysLeft)} 天`
  if (daysLeft === 0) return '今天到期'
  if (daysLeft === 1) return '明天到期'
  return `還有 ${daysLeft} 天`
}
