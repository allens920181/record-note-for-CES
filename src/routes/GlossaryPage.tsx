import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  addToCourse,
  addToGlobal,
  asPlainList,
  buildGlossaryView,
  deleteEverywhere,
  demoteToCourses,
  promoteToGlobal,
  removeFromCourse,
  renameEverywhere,
} from '../schedule/glossary'
import type { GlossaryEntry, GlossaryView } from '../schedule/glossary'
import { Breadcrumbs, TopBar } from '../components/Layout'
import { useTermChoice } from '../components/TermPicker'

export function GlossaryPage() {
  const { setTermId: setScopeTerm, terms } = useTermChoice()
  // '' means every term — the glossary is the one page where that is useful,
  // so the shared choice is a starting point rather than a hard filter.
  const [termId, setTermId] = useState<string | null>(null)
  const shown_term = termId ?? ''
  const [filter, setFilter] = useState('')
  const [view, setView] = useState<GlossaryView | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [rename, setRename] = useState('')
  const [flash, setFlash] = useState<string | null>(null)

  // Rebuilt from a version counter rather than useLiveQuery: the view spans
  // settings, courses and corrections, and Dexie has no single query for that.
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let live = true
    void buildGlossaryView(shown_term || undefined).then((v) => {
      if (live) setView(v)
    })
    return () => {
      live = false
    }
  }, [shown_term, version])

  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 3500)
    return () => window.clearTimeout(t)
  }, [flash])

  async function act(message: string, run: () => Promise<void>) {
    await run()
    refresh()
    setFlash(message)
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!view) return []
    if (!q) return view.entries
    return view.entries.filter(
      (e) =>
        e.term.toLowerCase().includes(q) ||
        e.courses.some((c) => c.courseName.toLowerCase().includes(q)),
    )
  }, [view, filter])

  const globals = view?.entries.filter((e) => e.isGlobal) ?? []

  return (
    <>
      <TopBar>
        <Breadcrumbs items={[{ label: '詞彙表總表' }]} />
      </TopBar>
      <main className="page">
        <h1>詞彙表總表</h1>
        <p className="small muted" style={{ margin: '.35rem 0 1.25rem', maxWidth: '46rem' }}>
          所有課程的專有名詞都在這裡。轉錄時送給模型的是
          <strong>全域詞彙 ＋ 那門課自己的詞彙</strong>，所以同一個詞不必兩邊都放。
          在兩門以上出現的詞，通常該升成全域。
        </p>

        {flash && (
          <div className="notice ok" style={{ marginBottom: '1rem' }}>
            {flash}
          </div>
        )}

        {/* ── add + scope ──────────────────────────────────────────── */}
        <section className="card" style={{ marginBottom: '1.25rem' }}>
          <h2>新增全域詞彙</h2>
          <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
            全域詞彙會隨<strong>每一門課</strong>的轉錄一起送出。神學家人名、宗派術語、
            常見原文音譯放這裡最省事。
          </p>
          <div className="row" style={{ gap: '.5rem' }}>
            <input
              id="g-new"
              type="text"
              placeholder="加爾文、巴特、chesed…（可用頓號一次加多個）"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                const items = draft
                  .split(/[、,\n]/)
                  .map((t) => t.trim())
                  .filter(Boolean)
                if (items.length === 0) return
                setDraft('')
                void act(`已加入 ${items.length} 個全域詞彙。`, async () => {
                  for (const t of items) await addToGlobal(t)
                })
              }}
            />
            <button
              className="btn primary"
              style={{ flex: '0 0 auto' }}
              disabled={draft.trim().length === 0}
              onClick={() => {
                const items = draft
                  .split(/[、,\n]/)
                  .map((t) => t.trim())
                  .filter(Boolean)
                if (items.length === 0) return
                setDraft('')
                void act(`已加入 ${items.length} 個全域詞彙。`, async () => {
                  for (const t of items) await addToGlobal(t)
                })
              }}
            >
              加入
            </button>
          </div>
        </section>

        {/* ── promote suggestions ──────────────────────────────────── */}
        {view && view.suggestions.length > 0 && (
          <section className="card" style={{ marginBottom: '1.25rem' }}>
            <h2>要不要升成全域？</h2>
            <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
              這些詞在兩門以上的課出現過。升成全域之後，往後每門課的轉錄都會帶上它，
              各課程的清單裡就不用重複放。
            </p>
            <div className="row" style={{ gap: '.4rem', flexWrap: 'wrap' }}>
              {view.suggestions.map((e) => (
                <button
                  key={e.term}
                  className="btn sm"
                  style={{ flex: '0 0 auto' }}
                  title={e.courses.map((c) => c.courseName).join('、')}
                  onClick={() =>
                    void act(`「${e.term}」已升為全域詞彙。`, () => promoteToGlobal(e.term))
                  }
                >
                  {e.term}
                  <span className="muted" style={{ marginLeft: '.35rem' }}>
                    ×{e.courses.length}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── the merged table ─────────────────────────────────────── */}
        <section className="card">
          <div className="row" style={{ alignItems: 'flex-end', gap: '.6rem', marginBottom: '.9rem' }}>
            <div className="grow">
              <h2 style={{ margin: 0 }}>全部詞彙</h2>
              <p className="small muted" style={{ margin: '.3rem 0 0' }}>
                {view
                  ? `${view.entries.length} 個詞 · 其中 ${globals.length} 個全域 · 涵蓋 ${view.courses.length} 門課`
                  : '載入中…'}
              </p>
            </div>
            <div className="field" style={{ flex: '0 0 12rem', marginBottom: 0 }}>
              <label htmlFor="g-term">學期</label>
              <select
                id="g-term"
                value={shown_term}
                onChange={(e) => {
                  setTermId(e.target.value)
                  if (e.target.value) setScopeTerm(e.target.value)
                }}
              >
                <option value="">全部學期</option>
                {[...(terms ?? [])]
                  .sort((a, b) => b.startDate.localeCompare(a.startDate))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field" style={{ flex: '0 0 12rem', marginBottom: 0 }}>
              <label htmlFor="g-filter">篩選</label>
              <input
                id="g-filter"
                type="text"
                placeholder="詞或課名"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          </div>

          {view === null ? (
            <div className="empty">載入中…</div>
          ) : shown.length === 0 ? (
            <div className="empty">
              <p>
                {view.entries.length === 0
                  ? '還沒有任何專有名詞。在上面加幾個，或到課程頁的「詞彙表」建立——你在逐字稿上改過的字也會自動累積到這裡。'
                  : '沒有符合的詞。'}
              </p>
            </div>
          ) : (
            <div className="tw">
              <table className="gloss">
                <thead>
                  <tr>
                    <th>詞</th>
                    <th>來源</th>
                    <th>用在哪些課</th>
                    <th className="act">動作</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => (
                    <Row
                      key={e.term}
                      entry={e}
                      allCourses={view.courses}
                      editing={editing === e.term}
                      rename={rename}
                      onRenameChange={setRename}
                      onStartRename={() => {
                        setEditing(e.term)
                        setRename(e.term)
                      }}
                      onCancelRename={() => setEditing(null)}
                      onCommitRename={() => {
                        const to = rename.trim()
                        setEditing(null)
                        if (!to || to === e.term) return
                        void act(`「${e.term}」已改成「${to}」。`, () =>
                          renameEverywhere(e.term, to),
                        )
                      }}
                      onAct={act}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view && view.entries.length > 0 && (
            <p className="small muted" style={{ marginTop: '.9rem' }}>
              整串可直接複製：
              <code style={{ marginLeft: '.35rem', wordBreak: 'break-all' }}>
                {asPlainList(shown)}
              </code>
            </p>
          )}
        </section>
      </main>
    </>
  )
}

interface RowProps {
  entry: GlossaryEntry
  allCourses: GlossaryView['courses']
  editing: boolean
  rename: string
  onRenameChange: (v: string) => void
  onStartRename: () => void
  onCancelRename: () => void
  onCommitRename: () => void
  onAct: (message: string, run: () => Promise<void>) => Promise<void>
}

function Row({
  entry,
  allCourses,
  editing,
  rename,
  onRenameChange,
  onStartRename,
  onCancelRename,
  onCommitRename,
  onAct,
}: RowProps) {
  const unused = allCourses.filter((c) => !entry.courses.some((u) => u.courseId === c.courseId))

  return (
    <tr>
      <td>
        {editing ? (
          <input
            type="text"
            autoFocus
            value={rename}
            style={{ maxWidth: '10rem' }}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
              if (e.key === 'Escape') onCancelRename()
            }}
          />
        ) : (
          <button className="linkish" onClick={onStartRename} title="改名（所有課程一起改）">
            {entry.term}
          </button>
        )}
      </td>
      <td>
        {entry.isGlobal && <span className="tag ok">全域</span>}
        {entry.learned && (
          <span className="tag" title="從你修正逐字稿的紀錄學來的">
            從修正學到
          </span>
        )}
        {!entry.isGlobal && !entry.learned && <span className="muted small">手動</span>}
      </td>
      <td>
        {entry.isGlobal ? (
          <span className="small muted">每一門課</span>
        ) : entry.courses.length === 0 ? (
          <span className="small muted">—</span>
        ) : (
          <span className="uses">
            {entry.courses.map((c) => (
              <Link key={c.courseId} to={`/course/${c.courseId}`} className="use" title={c.termName}>
                <span className="dot" style={{ background: c.color }} />
                {c.courseName}
                <button
                  className="x"
                  title={`從「${c.courseName}」移除`}
                  onClick={(ev) => {
                    ev.preventDefault()
                    void onAct(`已從「${c.courseName}」移除「${entry.term}」。`, () =>
                      removeFromCourse(entry.term, c.courseId),
                    )
                  }}
                >
                  ×
                </button>
              </Link>
            ))}
          </span>
        )}
      </td>
      <td className="act">
        <div className="row" style={{ gap: '.3rem', justifyContent: 'flex-end' }}>
          {entry.isGlobal ? (
            // Demoting has to name a course. Dropping the term out of the global
            // list without giving it one would leave it in no list at all, which
            // is deletion wearing a milder label.
            allCourses.length > 0 && (
              <select
                className="add-to"
                value=""
                aria-label={`把「${entry.term}」改成只給一門課用`}
                onChange={(ev) => {
                  const id = ev.target.value
                  if (!id) return
                  const course = allCourses.find((c) => c.courseId === id)
                  ev.target.value = ''
                  void onAct(`「${entry.term}」現在只給「${course?.courseName}」用。`, () =>
                    demoteToCourses(entry.term, [id]),
                  )
                }}
              >
                <option value="">改成只給…</option>
                {allCourses.map((c) => (
                  <option key={c.courseId} value={c.courseId}>
                    {c.courseName}
                  </option>
                ))}
              </select>
            )
          ) : (
            <button
              className="btn sm"
              style={{ flex: '0 0 auto' }}
              onClick={() => void onAct(`「${entry.term}」已升為全域詞彙。`, () => promoteToGlobal(entry.term))}
            >
              升為全域
            </button>
          )}
          {!entry.isGlobal && unused.length > 0 && (
            <select
              className="add-to"
              value=""
              aria-label={`把「${entry.term}」加到其他課`}
              onChange={(ev) => {
                const id = ev.target.value
                if (!id) return
                const course = unused.find((c) => c.courseId === id)
                ev.target.value = ''
                void onAct(`已把「${entry.term}」加到「${course?.courseName}」。`, () =>
                  addToCourse(entry.term, id),
                )
              }}
            >
              <option value="">加到…</option>
              {unused.map((c) => (
                <option key={c.courseId} value={c.courseId}>
                  {c.courseName}
                </option>
              ))}
            </select>
          )}
          <button
            className="btn ghost sm danger-text"
            style={{ flex: '0 0 auto' }}
            title="從所有課程與全域清單刪除"
            onClick={() => void onAct(`已刪除「${entry.term}」。`, () => deleteEverywhere(entry.term))}
          >
            刪除
          </button>
        </div>
      </td>
    </tr>
  )
}
