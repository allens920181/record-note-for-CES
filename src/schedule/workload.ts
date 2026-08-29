import type { Assignment } from '../db'
import { todayISO } from '../lib/dates'

export function daysUntil(due: string, from = todayISO()): number {
  const a = new Date(`${from}T00:00:00`).getTime()
  const b = new Date(`${due}T00:00:00`).getTime()
  return Math.round((b - a) / 86_400_000)
}

export type Pressure = 'done' | 'overdue' | 'tight' | 'ok' | 'unknown'

export interface Workload {
  daysLeft: number
  /** Hours the remaining subtasks are estimated to need. */
  hoursNeeded: number
  pressure: Pressure
}

/**
 * How much of a piece of work is left, and how soon.
 *
 * There used to be a second number here — hours actually set aside before the
 * deadline — read off a table of study blocks. The blocks are gone: a slot that
 * produced nothing but a figure asked to be maintained all term to keep that
 * figure honest, and a stale one is worse than none.
 */
export function workloadOf(assignment: Assignment, today = todayISO()): Workload {
  const daysLeft = daysUntil(assignment.due, today)
  const hoursNeeded = assignment.subtasks
    .filter((t) => !t.done)
    .reduce((sum, t) => sum + (t.estimateHours ?? 0), 0)

  let pressure: Pressure
  if (assignment.status === 'done') pressure = 'done'
  else if (daysLeft < 0) pressure = 'overdue'
  else if (daysLeft <= 3 && hoursNeeded > 0) pressure = 'tight'
  else if (hoursNeeded === 0) pressure = 'unknown'
  else pressure = 'ok'

  return { daysLeft, hoursNeeded, pressure }
}

export function describeDays(daysLeft: number): string {
  if (daysLeft < 0) return `已逾期 ${Math.abs(daysLeft)} 天`
  if (daysLeft === 0) return '今天到期'
  if (daysLeft === 1) return '明天到期'
  return `還有 ${daysLeft} 天`
}
