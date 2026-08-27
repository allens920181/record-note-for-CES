import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, reviewRequirements, saveRequirements } from '../db'
import type { RequirementsReview } from '../db'
import type { GradeItem } from '../db/schema'
import { newId } from '../lib/id'

interface Props {
  courseId: string
}

export function RequirementsPanel({ courseId }: Props) {
  const [review, setReview] = useState<RequirementsReview | null>(null)
  const [version, setVersion] = useState(0)

  const assignments = useLiveQuery(
    () => db.assignments.where('courseId').equals(courseId).sortBy('due'),
    [courseId],
  )
  const syllabus = useLiveQuery(
    async () =>
      (await db.attachments.where({ scope: 'course', ownerId: courseId }).toArray()).filter(
        (a) => a.kind === 'syllabus',
      ),
    [courseId],
  )

  useEffect(() => {
    let live = true
    void reviewRequirements(courseId).then((r) => {
      if (live) setReview(r)
    })
    return () => {
      live = false
    }
  }, [courseId, version, assignments])

  async function write(next: { grading?: GradeItem[]; rules?: string }) {
    if (!review) return
    await saveRequirements(courseId, { ...review.requirements, ...next })
    setVersion((v) => v + 1)
  }

  if (!review) return null
  const { grading, rules } = review.requirements
  const weightOff = grading.length > 0 && review.totalWeight !== 100

  return (
    <section className="card" style={{ marginBottom: '1.25rem' }}>
      <h2>課堂要求</h2>
      <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
        從教學大綱抄下來的評分方式與規定。這裡放的是<strong>寫作業寫到一半會想查</strong>的東西——
        報告幾頁、引註用什麼格式、遲交怎麼算——不必為了一句話再去開一次 PDF。
      </p>

      {/* ── grading table ─────────────────────────────────────────── */}
      <div className="grade-head">
        <h3>評分方式</h3>
        {grading.length > 0 && (
          <span className={`tag${weightOff ? ' warn' : ' ok'}`}>共 {review.totalWeight}%</span>
        )}
      </div>

      {grading.length === 0 ? (
        <div className="empty" style={{ padding: '1.1rem' }}>
          還沒填。照大綱把「期末報告 40%、讀書報告 30%、出席 30%」這樣一項一項加進來。
        </div>
      ) : (
        <div className="stack" style={{ gap: '.45rem' }}>
          {grading.map((g) => (
            <div key={g.id} className="grade-row">
              <input
                type="text"
                aria-label="項目"
                placeholder="期末報告"
                defaultValue={g.label}
                onBlur={(e) =>
                  void write({
                    grading: grading.map((x) =>
                      x.id === g.id ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
              <div className="pct">
                <input
                  type="number"
                  min={0}
                  max={100}
                  aria-label="比重"
                  defaultValue={g.weight}
                  onBlur={(e) =>
                    void write({
                      grading: grading.map((x) =>
                        x.id === g.id ? { ...x, weight: Number(e.target.value) || 0 } : x,
                      ),
                    })
                  }
                />
                <span className="small muted">%</span>
              </div>
              <select
                aria-label="對應作業"
                value={g.assignmentId ?? ''}
                onChange={(e) =>
                  void write({
                    grading: grading.map((x) =>
                      x.id === g.id ? { ...x, assignmentId: e.target.value || undefined } : x,
                    ),
                  })
                }
              >
                <option value="">還沒建作業</option>
                {(assignments ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
              <button
                className="btn ghost sm"
                style={{ flex: '0 0 auto' }}
                onClick={() => void write({ grading: grading.filter((x) => x.id !== g.id) })}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: '.5rem', marginTop: '.7rem' }}>
        <button
          className="btn"
          style={{ flex: '0 0 auto' }}
          onClick={() =>
            void write({
              grading: [
                ...grading,
                { id: newId('gr'), label: '', weight: 0 } satisfies GradeItem,
              ],
            })
          }
        >
          新增評分項目
        </button>
      </div>

      {weightOff && (
        <div className="notice warn" style={{ marginTop: '.7rem' }}>
          比重加起來是 {review.totalWeight}%，不是 100%。可能少抄了一項，也可能這門課本來就有加分項——
          自己確認一下就好。
        </div>
      )}

      {review.unplanned.length > 0 && (
        <div className="notice" style={{ marginTop: '.7rem' }}>
          有 {review.unplanned.length} 個評分項目還沒有對應的作業：
          <strong>{review.unplanned.map((g) => g.label || '（未命名）').join('、')}</strong>。
          <br />
          <Link to="/assignments">到作業頁建立</Link>，它們就會出現在行事曆和時數規劃裡。
        </div>
      )}

      {/* ── free text rules ───────────────────────────────────────── */}
      <div className="field" style={{ marginTop: '1.1rem', marginBottom: 0 }}>
        <label htmlFor={`req-${courseId}`}>其他規定</label>
        <textarea
          id={`req-${courseId}`}
          rows={5}
          placeholder={
            '出席：缺席三次以上不予計分\n報告：8–10 頁，芝加哥格式，雙行間距\n遲交：每逾一日扣 5 分\n期末考：閉書，範圍為第 1–10 週'
          }
          defaultValue={rules}
          onBlur={(e) => void write({ rules: e.target.value })}
        />
        <div className="hint">離開輸入框就會存檔。這段也會一起匯出到 Markdown。</div>
      </div>

      {syllabus && syllabus.length > 0 && (
        <p className="small muted" style={{ marginTop: '.7rem', marginBottom: 0 }}>
          原始大綱：{syllabus.map((a) => a.fileName).join('、')}——在下面的「課程檔案」可以直接開。
        </p>
      )}
    </section>
  )
}
