import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createReading, db, deleteReading, updateReading } from '../db'
import type { Reading } from '../db'
import { READING_STATUS_LABEL } from '../db/schema'
import type { ReadingStatus } from '../db/schema'

interface Props {
  courseId: string
}

export function ReadingList({ courseId }: Props) {
  const readings = useLiveQuery(
    () => db.readings.where('courseId').equals(courseId).sortBy('createdAt'),
    [courseId],
  )
  const sessions = useLiveQuery(async () => {
    const list = await db.sessions.where('courseId').equals(courseId).toArray()
    return list.sort((a, b) => a.date.localeCompare(b.date))
  }, [courseId])

  const [title, setTitle] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  async function add() {
    const t = title.trim()
    if (!t) return
    const id = await createReading({ courseId, title: t })
    setTitle('')
    setOpen(id)
  }

  function progressOf(r: Reading): number | null {
    if (!r.totalPages || r.totalPages <= 0) return null
    return Math.min(100, Math.round(((r.pagesRead ?? 0) / r.totalPages) * 100))
  }

  return (
    <section className="card" style={{ marginBottom: '1.25rem' }}>
      <h2>閱讀材料</h2>
      <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
        指定書目與進度。可以對應到某一週，之後在那週的工作區就知道該讀什麼。
      </p>

      {readings && readings.length > 0 && (
        <div className="stack" style={{ marginBottom: '.9rem' }}>
          {readings.map((r) => {
            const pct = progressOf(r)
            return (
              <div key={r.id} className="card" style={{ padding: '.8rem 1rem', boxShadow: 'none' }}>
                <div
                  className="row"
                  style={{ gap: '.6rem', alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                >
                  <div className="grow">
                    <div className="title">{r.title}</div>
                    <div className="sub">
                      {[r.author, r.chapters].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  {pct !== null && (
                    <span className="tag mono">
                      {r.pagesRead ?? 0}/{r.totalPages} 頁 · {pct}%
                    </span>
                  )}
                  <span className={`tag${r.status === 'read' ? ' ok' : ''}`}>
                    {READING_STATUS_LABEL[r.status]}
                  </span>
                  <button className="btn ghost sm" style={{ flex: '0 0 auto' }}>
                    {open === r.id ? '收合' : '展開'}
                  </button>
                </div>

                {pct !== null && (
                  <div className="progress" style={{ marginTop: '.5rem' }}>
                    <div style={{ width: `${pct}%` }} />
                  </div>
                )}

                {open === r.id && (
                  <div style={{ marginTop: '.9rem' }}>
                    <div className="row">
                      <div className="field">
                        <label htmlFor={`rt-${r.id}`}>書名／篇名</label>
                        <input
                          id={`rt-${r.id}`}
                          type="text"
                          defaultValue={r.title}
                          onBlur={(e) => void updateReading(r.id, { title: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`ra-${r.id}`}>作者</label>
                        <input
                          id={`ra-${r.id}`}
                          type="text"
                          defaultValue={r.author ?? ''}
                          onBlur={(e) => void updateReading(r.id, { author: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`rc-${r.id}`}>章節</label>
                        <input
                          id={`rc-${r.id}`}
                          type="text"
                          placeholder="第三卷 21–24 章"
                          defaultValue={r.chapters ?? ''}
                          onBlur={(e) => void updateReading(r.id, { chapters: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="row">
                      <div className="field">
                        <label htmlFor={`rs-${r.id}`}>狀態</label>
                        <select
                          id={`rs-${r.id}`}
                          value={r.status}
                          onChange={(e) =>
                            void updateReading(r.id, { status: e.target.value as ReadingStatus })
                          }
                        >
                          {(Object.keys(READING_STATUS_LABEL) as ReadingStatus[]).map((k) => (
                            <option key={k} value={k}>
                              {READING_STATUS_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`rp-${r.id}`}>讀到第幾頁</label>
                        <input
                          id={`rp-${r.id}`}
                          type="number"
                          min={0}
                          value={r.pagesRead ?? ''}
                          onChange={(e) =>
                            void updateReading(r.id, {
                              pagesRead: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`rn-${r.id}`}>總頁數</label>
                        <input
                          id={`rn-${r.id}`}
                          type="number"
                          min={0}
                          value={r.totalPages ?? ''}
                          onChange={(e) =>
                            void updateReading(r.id, {
                              totalPages: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`rw-${r.id}`}>對應週次</label>
                        <select
                          id={`rw-${r.id}`}
                          value={r.sessionId ?? ''}
                          onChange={(e) =>
                            void updateReading(r.id, { sessionId: e.target.value || undefined })
                          }
                        >
                          <option value="">不指定</option>
                          {(sessions ?? []).map((s) => (
                            <option key={s.id} value={s.id}>
                              第 {s.index} 週 · {s.date}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="field">
                      <label htmlFor={`rnotes-${r.id}`}>讀書筆記</label>
                      <textarea
                        id={`rnotes-${r.id}`}
                        rows={3}
                        defaultValue={r.notes}
                        onBlur={(e) => void updateReading(r.id, { notes: e.target.value })}
                      />
                    </div>

                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="btn danger sm"
                        style={{ flex: '0 0 auto' }}
                        onClick={async () => {
                          if (confirm(`刪除「${r.title}」？`)) await deleteReading(r.id)
                        }}
                      >
                        刪除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="row" style={{ gap: '.5rem' }}>
        <input
          type="text"
          className="grow"
          placeholder="加入一本書或一篇文章"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && title.trim()) {
              e.preventDefault()
              void add()
            }
          }}
        />
        <button className="btn" style={{ flex: '0 0 auto' }} disabled={!title.trim()} onClick={add}>
          加入
        </button>
      </div>
    </section>
  )
}
