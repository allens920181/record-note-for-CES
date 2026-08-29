import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, dismissCorrection, resolveCorrection } from '../db'
import { diffOnce, suggestFrom } from '../schedule/corrections'

interface Props {
  courseId: string
}

/** How many candidate spans to offer before falling back to free text. */
const MAX_CHIPS = 8

export function CorrectionsPanel({ courseId }: Props) {
  const corrections = useLiveQuery(
    async () => {
      const list = await db.corrections.where('courseId').equals(courseId).toArray()
      return list
        .filter((c) => !c.resolvedTerm && !c.dismissed)
        .sort((a, b) => b.createdAt - a.createdAt)
    },
    [courseId],
  )
  const learned = useLiveQuery(
    async () => {
      const list = await db.corrections.where('courseId').equals(courseId).toArray()
      return list.filter((c) => c.resolvedTerm)
    },
    [courseId],
  )

  const rows = useMemo(
    () =>
      (corrections ?? []).map((c) => {
        const diff = diffOnce(c.before, c.after)
        return { c, suggestion: diff ? suggestFrom(c.after, diff) : null }
      }),
    [corrections],
  )

  const [custom, setCustom] = useState<Record<string, string>>({})

  if (corrections === undefined || learned === undefined) return null
  // Nothing corrected yet means nothing to decide. An empty panel explaining a
  // queue that does not exist is the kind of card that makes a page look busy
  // while saying nothing; it appears the first time you fix a word.
  if (rows.length === 0 && learned.length === 0) return null

  return (
    <section className="card" style={{ marginBottom: '1.25rem' }}>
      <h2>逐字稿改過的字</h2>
      {rows.length > 0 && (
        <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
          挑出真正的詞加進詞彙表，下次轉錄模型就知道怎麼寫。
          中文沒有詞界可循，所以由你點一下決定——猜錯反而會教模型寫錯字。
        </p>
      )}

      {learned.length > 0 && (
        <p className="small" style={{ margin: '0 0 .9rem', color: 'var(--accent-ink)' }}>
          已從修正學到 {learned.length} 個詞：
          {learned
            .slice(-8)
            .map((c) => c.resolvedTerm)
            .join('、')}
        </p>
      )}

      {rows.length === 0 ? null : (
        <div className="stack">
          {rows.map(({ c, suggestion }) => (
            <div key={c.id} className="correction">
              <div className="small muted">
                改前：<span className="cor-before">{c.before}</span>
              </div>
              <div className="cor-context">{suggestion?.context ?? c.after}</div>

              <div className="row" style={{ gap: '.35rem', marginTop: '.5rem', alignItems: 'center' }}>
                {suggestion?.term ? (
                  <button
                    type="button"
                    className="btn primary sm"
                    style={{ flex: '0 0 auto' }}
                    onClick={() => void resolveCorrection(c.id, suggestion.term!)}
                  >
                    加入「{suggestion.term}」
                  </button>
                ) : (
                  (suggestion?.options ?? []).slice(0, MAX_CHIPS).map((option) => (
                    <button
                      type="button"
                      key={option}
                      className="btn sm"
                      style={{ flex: '0 0 auto' }}
                      onClick={() => void resolveCorrection(c.id, option)}
                    >
                      {option}
                    </button>
                  ))
                )}
                <input
                  type="text"
                  placeholder="或自己輸入"
                  style={{ flex: '1 1 8rem', minWidth: '6rem' }}
                  value={custom[c.id] ?? ''}
                  onChange={(e) => setCustom({ ...custom, [c.id]: e.target.value })}
                  onKeyDown={(e) => {
                    const value = (custom[c.id] ?? '').trim()
                    if (e.key === 'Enter' && value) {
                      e.preventDefault()
                      void resolveCorrection(c.id, value)
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn ghost sm"
                  style={{ flex: '0 0 auto' }}
                  onClick={() => void dismissCorrection(c.id)}
                >
                  不是詞
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
