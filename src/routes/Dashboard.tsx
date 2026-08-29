import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { createTerm, db, deleteTermCascade, todayISO } from '../db'
import { endOfWeeks, weeksBetween } from '../lib/dates'
import { Breadcrumbs, TopBar } from '../components/Layout'
import { Modal } from '../components/Modal'
import { SetupBanner } from '../components/SetupBanner'
import { useConfirm } from '../components/ConfirmProvider'

export function Dashboard() {
  const ask = useConfirm()
  const terms = useLiveQuery(() => db.terms.orderBy('createdAt').reverse().toArray(), [])
  const counts = useLiveQuery(async () => {
    const all = await db.courses.toArray()
    const byTerm: Record<string, number> = {}
    for (const c of all) byTerm[c.termId] = (byTerm[c.termId] ?? 0) + 1
    return byTerm
  }, [])

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState(todayISO())
  // A default end date rather than a default week count: fifteen weeks is the
  // usual term, but the date is the thing the app actually uses, so that is
  // what the reader adjusts.
  const [endDate, setEndDate] = useState(endOfWeeks(todayISO(), 15))

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || endDate < startDate) return
    await createTerm({ name: trimmed, startDate, endDate })
    setName('')
    setCreating(false)
  }

  return (
    <>
      <TopBar>
        <Breadcrumbs items={[{ label: '學期' }]} />
      </TopBar>

      <main className="page">
        <SetupBanner />

        <div className="page-head">
          <div className="grow">
            <h1>學期</h1>
            <p>每個學期底下放課程，課程底下放每週的錄音與筆記。</p>
          </div>
          <button className="btn primary" onClick={() => setCreating(true)}>
            新增學期
          </button>
        </div>

        {terms === undefined ? (
          <div className="empty">載入中…</div>
        ) : terms.length === 0 ? (
          <div className="empty">
            <p>還沒有任何學期。先建一個，例如「2026 秋季」。</p>
            <button className="btn primary" onClick={() => setCreating(true)}>
              新增學期
            </button>
          </div>
        ) : (
          <div className="stack">
            {terms.map((t) => (
              <div key={t.id} className="list-item">
                <Link to={`/term/${t.id}`} className="grow" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="title">{t.name}</div>
                  <div className="sub">
                    {t.startDate} 起 · {weeksBetween(t.startDate, t.endDate)} 週 ·{' '}
                    {counts?.[t.id] ?? 0} 門課
                  </div>
                </Link>
                <button
                  className="btn danger sm"
                  onClick={async () => {
                    const go = await ask({
                      title: `刪除學期「${t.name}」？`,
                      danger: true,
                      confirmLabel: '刪除這個學期',
                      body: (
                        <>
                          會一起消失的：
                          <ul>
                            <li>這個學期底下的 {counts?.[t.id] ?? 0} 門課程</li>
                            <li>那些課的所有週次、逐字稿與筆記</li>
                            <li>作業、閱讀材料、上傳的檔案</li>
                          </ul>
                        </>
                      ),
                    })
                    if (go) await deleteTermCascade(t.id)
                  }}
                >
                  刪除
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

      {creating && (
        <Modal
          title="新增學期"
          onClose={() => setCreating(false)}
          onSubmit={submit}
          submitLabel="建立"
          submitDisabled={!name.trim() || endDate < startDate}
        >
          <div className="field">
            <label htmlFor="term-name">學期名稱</label>
            <input
              id="term-name"
              type="text"
              value={name}
              autoFocus
              placeholder="2026 秋季"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="term-start">開始日期</label>
              <input
                id="term-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="term-end">結束日期</label>
              <input
                id="term-end"
                type="date"
                min={startDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          {/* The week count is read off the dates rather than typed beside
              them:密集課 6 週、暑期班 8 週都只是不同的結束日。 */}
          <div className="hint" data-testid="term-weeks">
            {endDate < startDate
              ? '結束日期不能早於開始日期。'
              : `共 ${weeksBetween(startDate, endDate)} 週。之後在學期頁可以改。`}
          </div>
        </Modal>
      )}
    </>
  )
}
