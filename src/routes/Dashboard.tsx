import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { createTerm, db, deleteTermCascade, todayISO } from '../db'
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
  const [weeks, setWeeks] = useState(15)

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    const end = new Date(`${startDate}T00:00:00`)
    end.setDate(end.getDate() + weeks * 7)
    await createTerm({
      name: trimmed,
      startDate,
      endDate: end.toISOString().slice(0, 10),
      weeks,
    })
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
                    {t.startDate} 起 · {t.weeks} 週 · {counts?.[t.id] ?? 0} 門課
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
          submitDisabled={!name.trim()}
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
              <label htmlFor="term-weeks">週數</label>
              {/* A number, not three options: the generator loops over whatever
                  integer it is given, so 6 for a summer intensive and 12 for a
                  block course were only ever excluded by this control. */}
              <input
                id="term-weeks"
                type="number"
                min={1}
                max={30}
                value={weeks}
                onChange={(e) => setWeeks(Math.max(1, Number(e.target.value) || 1))}
              />
              <div className="hint">之後在學期頁可以改。</div>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
