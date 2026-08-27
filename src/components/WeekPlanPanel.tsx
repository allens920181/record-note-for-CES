import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, saveWeekPlan } from '../db'
import type { PlanItem } from '../db/schema'
import { PLAN_TEMPLATES, READING_STATUS_LABEL } from '../db/schema'
import { newId } from '../lib/id'

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
  const [draft, setDraft] = useState('')
  const [hours, setHours] = useState('')

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

  async function toggle(item: PlanItem) {
    const nowDone = !item.done
    await write(items.map((i) => (i.id === item.id ? { ...i, done: nowDone } : i)))
    // Finishing a reading item is the same fact as having read the book.
    if (item.readingId) {
      const reading = await db.readings.get(item.readingId)
      if (reading) {
        await db.readings.update(item.readingId, { status: nowDone ? 'read' : 'reading' })
        setFlash(
          nowDone
            ? `「${reading.title}」在閱讀清單也標成已讀完了。`
            : `「${reading.title}」改回讀到一半。`,
        )
      }
    }
  }

  function add() {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    const h = Number(hours)
    setHours('')
    void write([
      ...items,
      { id: newId('pi'), title, done: false, hours: Number.isFinite(h) && h > 0 ? h : undefined },
    ])
  }

  const unplannedReadings = (readings ?? []).filter(
    (r) => r.status !== 'read' && !items.some((i) => i.readingId === r.id),
  )

  return (
    <section className={compact ? 'card' : 'card'} style={{ marginBottom: compact ? '1rem' : '1.25rem' }}>
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

      {items.length === 0 ? (
        <div className="empty" style={{ padding: '1.1rem' }}>
          <p>還沒排這週要做什麼。</p>
          <div className="row" style={{ gap: '.4rem', justifyContent: 'center' }}>
            {PLAN_TEMPLATES.map((t) => (
              <button
                key={t.name}
                className="btn sm"
                style={{ flex: '0 0 auto' }}
                onClick={() =>
                  void write(
                    t.steps.map((title) => ({ id: newId('pi'), title, done: false })),
                  )
                }
              >
                套用「{t.name}」
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: '.35rem' }}>
          {items.map((item) => (
            <div key={item.id} className={`plan-item${item.done ? ' is-done' : ''}`}>
              <input
                type="checkbox"
                checked={item.done}
                aria-label={item.title}
                onChange={() => void toggle(item)}
              />
              <input
                type="text"
                className="plan-title"
                defaultValue={item.title}
                onBlur={(e) =>
                  void write(
                    items.map((i) => (i.id === item.id ? { ...i, title: e.target.value } : i)),
                  )
                }
              />
              {item.readingId && <span className="tag">閱讀</span>}
              <div className="pct">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  aria-label="預估小時"
                  placeholder="—"
                  defaultValue={item.hours ?? ''}
                  onBlur={(e) =>
                    void write(
                      items.map((i) =>
                        i.id === item.id
                          ? { ...i, hours: e.target.value ? Number(e.target.value) : undefined }
                          : i,
                      ),
                    )
                  }
                />
                <span className="small muted">h</span>
              </div>
              <button
                className="btn ghost sm"
                style={{ flex: '0 0 auto' }}
                onClick={() => void write(items.filter((i) => i.id !== item.id))}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: '.4rem', marginTop: '.7rem' }}>
        <input
          type="text"
          placeholder="再加一項，例如「讀完《基督教要義》21–24 章」"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <div className="pct" style={{ flex: '0 0 5.5rem' }}>
          <input
            type="number"
            min={0}
            step={0.5}
            placeholder="小時"
            aria-label="預估小時"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          <span className="small muted">h</span>
        </div>
        <button className="btn" style={{ flex: '0 0 auto' }} disabled={!draft.trim()} onClick={add}>
          加入
        </button>
      </div>

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
