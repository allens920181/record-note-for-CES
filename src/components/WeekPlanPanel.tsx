import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, saveWeekPlan } from '../db'
import type { PlanItem } from '../db/schema'
import { PLAN_TEMPLATES, READING_STATUS_LABEL } from '../db/schema'
import { newId } from '../lib/id'
import { TaskChecklist } from './TaskChecklist'
import type { ChecklistItem } from './TaskChecklist'

interface Props {
  sessionId: string
  courseId: string
  /** Rendered inside the workspace, where space is tighter than a page. */
  compact?: boolean
}

/**
 * What you mean to get done for this course this week, and how far you got.
 *
 * Ticking an item that came from the reading list also moves that book on, so
 * the two places cannot quietly disagree about whether you have read it.
 */
export function WeekPlanPanel({ sessionId, courseId, compact }: Props) {
  const plan = useLiveQuery(() => db.weekPlans.get(sessionId), [sessionId])
  const readings = useLiveQuery(
    () => db.readings.where('courseId').equals(courseId).sortBy('createdAt'),
    [courseId],
  )
  // Dexie hands back undefined while loading and again when there is no row.
  const items: PlanItem[] = plan?.items ?? []
  const done = items.filter((i) => i.done).length
  const hoursLeft = items.filter((i) => !i.done).reduce((s, i) => s + (Number(i.hours) || 0), 0)

  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 3000)
    return () => window.clearTimeout(t)
  }, [flash])

  const write = (next: PlanItem[]) => saveWeekPlan(sessionId, courseId, next)

  /**
   * The checklist hands back the whole list, so the one thing it cannot know —
   * that this row stands for a book — is worked out by comparing.
   */
  async function apply(next: ChecklistItem[]) {
    const rows: PlanItem[] = next.map((i) => {
      const before = items.find((o) => o.id === i.id)
      return {
        id: i.id,
        title: i.title,
        done: i.done,
        hours: i.hours,
        ...(before?.readingId ? { readingId: before.readingId } : {}),
      }
    })
    await write(rows)

    // Finishing a reading item is the same fact as having read the book.
    const flipped = rows.find((r) => {
      const before = items.find((o) => o.id === r.id)
      return before && before.done !== r.done && r.readingId
    })
    if (!flipped?.readingId) return
    const reading = await db.readings.get(flipped.readingId)
    if (!reading) return
    await db.readings.update(flipped.readingId, { status: flipped.done ? 'read' : 'reading' })
    setFlash(
      flipped.done
        ? `「${reading.title}」在閱讀清單也標成已讀完了。`
        : `「${reading.title}」改回讀到一半。`,
    )
  }

  const unplannedReadings = (readings ?? []).filter(
    (r) => r.status !== 'read' && !items.some((i) => i.readingId === r.id),
  )

  return (
    <section className="card" style={{ marginBottom: compact ? '1rem' : '1.25rem' }}>
      <div className="grade-head">
        <h2 style={{ margin: 0, fontSize: compact ? '.95rem' : undefined }}>本週進度</h2>
        {items.length > 0 && (
          <span className={`tag${done === items.length ? ' ok' : ''}`}>
            {done} / {items.length}
            {hoursLeft > 0 && ` · 還要 ${hoursLeft} 小時`}
          </span>
        )}
      </div>

      {!compact && (
        <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
          這一週你打算為這門課做的事。和作業的步驟不同——那是為了一份有截止日的東西；
          這裡是這一週本身：課前讀完、課後整理、報告再往前推一段。
        </p>
      )}

      {flash && (
        <div className="notice ok" style={{ margin: '.2rem 0 .7rem' }}>
          {flash}
        </div>
      )}

      <TaskChecklist
        items={items.map((i) => ({
          id: i.id,
          title: i.title,
          done: i.done,
          hours: i.hours,
          ...(i.readingId ? { tag: '閱讀' } : {}),
        }))}
        onChange={(next) => void apply(next)}
        makeId={() => newId('pi')}
        templates={PLAN_TEMPLATES}
        addPlaceholder="再加一項，例如「讀完《基督教要義》21–24 章」"
        emptyText="還沒排這週要做什麼。"
      />

      {unplannedReadings.length > 0 && (
        <p className="small muted" style={{ marginTop: '.8rem', marginBottom: 0 }}>
          從閱讀清單拉進來：
          {unplannedReadings.slice(0, 6).map((r) => (
            <button
              key={r.id}
              className="btn sm"
              style={{ flex: '0 0 auto', marginLeft: '.3rem', marginTop: '.3rem' }}
              title={`${READING_STATUS_LABEL[r.status]}${r.chapters ? ` · ${r.chapters}` : ''}`}
              onClick={() =>
                void write([
                  ...items,
                  {
                    id: newId('pi'),
                    title: `讀完《${r.title}》${r.chapters ? ` ${r.chapters}` : ''}`,
                    done: false,
                    readingId: r.id,
                  },
                ])
              }
            >
              {r.title}
            </button>
          ))}
        </p>
      )}
    </section>
  )
}
