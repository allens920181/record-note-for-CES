import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, courseProgress } from '../db'
import type { CourseProgress } from '../db'

interface Props {
  courseId: string
}

/**
 * The headline for a course's term: how much of what you planned is done, and
 * how many hours the rest still wants.
 *
 * Deliberately not a grid of weeks — the week list directly below already is
 * one, and showing the same fifteen weeks twice made the page long without
 * saying anything new. Each week's own progress rides on its row down there.
 *
 * Weeks with no plan are not counted as behind: "4 / 4 planned weeks done" is
 * true, while "4 / 15" would only mean the term has not happened yet.
 */
export function ProgressOverview({ courseId }: Props) {
  const [progress, setProgress] = useState<CourseProgress | null>(null)

  const stamp = useLiveQuery(async () => {
    const [plans, sessions] = await Promise.all([
      db.weekPlans.where('courseId').equals(courseId).toArray(),
      db.sessions.where('courseId').equals(courseId).count(),
    ])
    return `${sessions}:${plans.map((p) => `${p.id}${p.updatedAt}`).join(',')}`
  }, [courseId])

  useEffect(() => {
    let live = true
    void courseProgress(courseId).then((p) => {
      if (live) setProgress(p)
    })
    return () => {
      live = false
    }
  }, [courseId, stamp])

  if (!progress) return null
  const { plannedWeeks, completedWeeks, itemsDone, itemsTotal, hoursLeft, weeks } = progress
  // With no weeks yet there is nothing to be behind on, and the list below
  // already says so. Two empty states for one fact read as a cluttered page.
  if (weeks.length === 0) return null
  const pct = itemsTotal > 0 ? Math.round((itemsDone / itemsTotal) * 100) : 0
  const unplanned = weeks.filter((w) => !w.canceled && w.total === 0).length

  return (
    <section className="card" style={{ marginBottom: '1.25rem' }}>
      <div className="grade-head">
        <h2 style={{ margin: 0 }}>學習進度</h2>
        {plannedWeeks > 0 && (
          <span className={`tag${completedWeeks === plannedWeeks ? ' ok' : ''}`}>
            {completedWeeks} / {plannedWeeks} 堂完成
          </span>
        )}
      </div>

      {plannedWeeks === 0 ? (
        <p className="small muted" style={{ margin: '.4rem 0 0' }}>
          點下面任何一週，在「本週進度」排你打算做的事——課前讀完、課後整理、報告推進一段。
        </p>
      ) : (
        <>
          {/* 堂, not 週: a fifteen-week term has thirty of these once it has
              a lecture and a discussion each week, and "還有 29 週沒排" in a
              term that is fifteen weeks long reads as a mistake. */}
          <p className="small muted" style={{ margin: '.3rem 0 .7rem' }}>
            已排進度的 {plannedWeeks} 堂裡完成 {itemsDone} / {itemsTotal} 項
            {hoursLeft > 0 && ` · 未完成的部分估計還要 ${hoursLeft} 小時`}
            {unplanned > 0 && ` · 還有 ${unplanned} 堂沒排`}。
          </p>
          <div className="progress">
            <div style={{ width: `${pct}%`, background: 'var(--accent)' }} />
          </div>
        </>
      )}
    </section>
  )
}
