import { useLiveQuery } from 'dexie-react-hooks'
import { WEEKDAY_LABELS, addWorkBlock, db, deleteWorkBlock, sumWorkHours, updateWorkBlock } from '../db'
import type { Recurrence, WorkBlock } from '../db'
import { hoursBetween } from '../lib/time'
import { BlurField } from './BlurField'
import { TimeField } from './TimeField'

interface Props {
  courseId: string
  termWeeks: number
  /** Sensible default date for a one-off block. */
  defaultDate: string
}

/**
 * Study time is not part of the timetable: it produces no file, and it is often
 * not weekly — a standing Sunday afternoon, or one Saturday put aside for a
 * particular paper. Both shapes live here.
 */
export function WorkBlockEditor({ courseId, termWeeks, defaultDate }: Props) {
  const blocks = useLiveQuery(
    async () => {
      const list = await db.workBlocks.where('courseId').equals(courseId).toArray()
      // Standing commitments first, then the one-offs in date order. Sorting on
      // the repeat string alphabetically would put 'once' first, which is an
      // arbitrary order that reads as a bug.
      const rank = (r: string) => (r === 'weekly' ? 0 : 1)
      return list.sort(
        (a, b) =>
          rank(a.repeat) - rank(b.repeat) ||
          (a.weekday ?? 0) - (b.weekday ?? 0) ||
          (a.date ?? '').localeCompare(b.date ?? ''),
      )
    },
    [courseId],
  )

  const hours = sumWorkHours(blocks ?? [], termWeeks)

  function add(repeat: Recurrence) {
    void addWorkBlock({
      courseId,
      repeat,
      ...(repeat === 'weekly' ? { weekday: 0 } : { date: defaultDate }),
      start: '14:00',
      end: '17:00',
    })
  }

  function patch(block: WorkBlock, next: Partial<WorkBlock>) {
    void updateWorkBlock(block.id, next)
  }

  return (
    <section className="card" style={{ marginBottom: '1.25rem' }}>
      <h2>寫作業的時段</h2>

      {blocks && blocks.length > 0 ? (
        <div className="stack" style={{ marginBottom: '.9rem' }}>
          {blocks.map((block) => (
            <div key={block.id} className="row slot-row is-work" style={{ gap: '.5rem', alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '0 0 7.5rem', marginBottom: 0 }}>
                <label htmlFor={`wr-${block.id}`}>重複</label>
                <select
                  id={`wr-${block.id}`}
                  value={block.repeat}
                  onChange={(e) => {
                    const repeat = e.target.value as Recurrence
                    patch(
                      block,
                      repeat === 'weekly'
                        ? { repeat, weekday: block.weekday ?? 0, date: undefined }
                        : { repeat, date: block.date ?? defaultDate, weekday: undefined },
                    )
                  }}
                >
                  <option value="weekly">每週</option>
                  <option value="once">單次</option>
                </select>
              </div>

              {block.repeat === 'weekly' ? (
                <div className="field" style={{ flex: '0 0 7rem', marginBottom: 0 }}>
                  <label htmlFor={`ww-${block.id}`}>星期</label>
                  <select
                    id={`ww-${block.id}`}
                    value={block.weekday ?? 0}
                    onChange={(e) => patch(block, { weekday: Number(e.target.value) })}
                  >
                    {WEEKDAY_LABELS.map((label, wd) => (
                      <option key={wd} value={wd}>
                        週{label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="field" style={{ flex: '0 0 10rem', marginBottom: 0 }}>
                  <label htmlFor={`wd-date-${block.id}`}>日期</label>
                  <input
                    id={`wd-date-${block.id}`}
                    type="date"
                    value={block.date ?? defaultDate}
                    onChange={(e) => patch(block, { date: e.target.value })}
                  />
                </div>
              )}

              <TimeField
                id={`ws-${block.id}`}
                label="開始"
                value={block.start}
                onChange={(v) => patch(block, { start: v })}
                style={{ flex: '1 1 5.5rem' }}
              />
              <TimeField
                id={`we-${block.id}`}
                label="結束"
                value={block.end}
                onChange={(v) => patch(block, { end: v })}
                style={{ flex: '1 1 5.5rem' }}
              />
              <div className="field" style={{ flex: '1 1 8rem', marginBottom: 0 }}>
                <label htmlFor={`wn-${block.id}`}>備註</label>
                <BlurField
                  id={`wn-${block.id}`}
                  placeholder="期末報告"
                  value={block.note ?? ''}
                  onCommit={(v) => patch(block, { note: v })}
                />
              </div>
              <span className="slot-hours mono">{hoursBetween(block.start, block.end)} 小時</span>
              <button
                className="btn danger sm"
                style={{ flex: '0 0 auto' }}
                onClick={() => void deleteWorkBlock(block.id)}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty" style={{ padding: '1.25rem', marginBottom: '.9rem' }}>
          <p style={{ margin: 0 }}>還沒安排時段。</p>
          <p
            className="small muted"
            style={{ margin: '.5rem auto 0', maxWidth: '32rem', textAlign: 'left' }}
          >
            你課外坐下來寫作業的時間。不錄音、不產生檔案——
            排在這裡，作業規劃才算得出「截止日之前實際還剩幾小時」。
          </p>
        </div>
      )}

      <div className="row" style={{ gap: '.6rem' }}>
        {/* The row that appears already carries a 重複 select, so a button per
            shape was two ways to reach the same row. */}
        <button className="btn" style={{ flex: '0 0 auto' }} onClick={() => add('weekly')}>
          新增寫作業時段
        </button>
      </div>

      {(hours.weekly > 0 || hours.oneOff > 0) && (
        <p className="small muted" style={{ marginTop: '.8rem' }}>
          每週固定 {hours.weekly} 小時
          {hours.oneOff > 0 && `，另有單次 ${hours.oneOff} 小時`}
          ，整學期共約 <strong>{hours.total} 小時</strong>。
        </p>
      )}
    </section>
  )
}
