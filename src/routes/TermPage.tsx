import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { createCourse, db, deleteCourseCascade, sessionsInTerm, updateCourse, updateTerm } from '../db'
import { COURSE_COLORS } from '../db/schema'
import { Breadcrumbs, TopBar } from '../components/Layout'
import { Modal } from '../components/Modal'
import { SetupBanner } from '../components/SetupBanner'
import { CourseForm, EMPTY_COURSE } from '../components/CourseForm'
import type { CourseDraft } from '../components/CourseForm'
import { useConfirm } from '../components/ConfirmProvider'

export function TermPage() {
  const ask = useConfirm()
  const { termId = '' } = useParams()
  const term = useLiveQuery(() => db.terms.get(termId), [termId])
  const courses = useLiveQuery(
    () => db.courses.where('termId').equals(termId).sortBy('createdAt'),
    [termId],
  )
  const sessionCounts = useLiveQuery(async () => {
    const all = await db.sessions.toArray()
    const byCourse: Record<string, number> = {}
    for (const s of all) byCourse[s.courseId] = (byCourse[s.courseId] ?? 0) + 1
    return byCourse
  }, [])

  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<CourseDraft>(EMPTY_COURSE)
  /** Course being edited, or null. */
  const [editing, setEditing] = useState<string | null>(null)
  const [termDraft, setTermDraft] = useState<{
    name: string
    startDate: string
    endDate: string
    weeks: number
  } | null>(null)
  const [affected, setAffected] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit() {
    const name = draft.name.trim()
    if (!name) return
    if (editing) {
      await updateCourse(editing, { ...draft, name, teacher: draft.teacher.trim(), code: draft.code.trim() })
      setNotice(`已更新「${name}」。`)
    } else {
      await createCourse({
        termId,
        name,
        teacher: draft.teacher.trim(),
        code: draft.code.trim(),
        credits: draft.credits,
        color: COURSE_COLORS[(courses?.length ?? 0) % COURSE_COLORS.length],
      })
    }
    setDraft(EMPTY_COURSE)
    setEditing(null)
    setCreating(false)
  }

  async function submitTerm() {
    if (!termDraft || !termDraft.name.trim()) return
    const { renumbered } = await updateTerm(termId, {
      name: termDraft.name.trim(),
      startDate: termDraft.startDate,
      endDate: termDraft.endDate,
      weeks: termDraft.weeks,
    })
    setTermDraft(null)
    setNotice(renumbered > 0 ? `已更新學期，並重新編號 ${renumbered} 個週次。` : '已更新學期。')
  }

  if (term === undefined) return <div className="page">載入中…</div>
  if (term === null) return <div className="page">找不到這個學期。<Link to="/">回到學期列表</Link></div>

  return (
    <>
      <TopBar>
        <Breadcrumbs items={[{ label: '學期', to: '/' }, { label: term.name }]} />
      </TopBar>

      <main className="page">
        <SetupBanner />

        <div className="page-head">
          <div className="grow">
            <h1>{term.name}</h1>
            <p>
              {term.startDate} 起 · {term.weeks} 週
            </p>
          </div>
          <button
            className="btn"
            style={{ flex: '0 0 auto' }}
            onClick={async () => {
              setAffected(await sessionsInTerm(termId))
              setTermDraft({
                name: term.name,
                startDate: term.startDate,
                endDate: term.endDate,
                weeks: term.weeks,
              })
            }}
          >
            編輯學期
          </button>
          <button className="btn primary" style={{ flex: '0 0 auto' }} onClick={() => setCreating(true)}>
            新增課程
          </button>
        </div>

        {notice && (
          <div className="notice ok" style={{ marginBottom: '1rem' }}>
            {notice}
          </div>
        )}

        {courses === undefined ? (
          <div className="empty">載入中…</div>
        ) : courses.length === 0 ? (
          <div className="empty">
            <p>這個學期還沒有課程。</p>
            <button className="btn primary" onClick={() => setCreating(true)}>
              新增課程
            </button>
          </div>
        ) : (
          <div className="stack">
            {courses.map((c) => (
              <div key={c.id} className="list-item">
                <span className="swatch" style={{ background: c.color }} aria-hidden="true" />
                <Link
                  to={`/course/${c.id}`}
                  className="grow"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div className="title">{c.name}</div>
                  <div className="sub">
                    {[c.teacher, c.code, `${c.credits} 學分`].filter(Boolean).join(' · ')} ·{' '}
                    {sessionCounts?.[c.id] ?? 0} 個週次
                  </div>
                </Link>
                <button
                  className="btn danger sm"
                  onClick={async () => {
                    const go = await ask({
                      title: `刪除課程「${c.name}」？`,
                      danger: true,
                      confirmLabel: '刪除這門課',
                      body: (
                        <>
                          會一起消失的：
                          <ul>
                            <li>這門課的 {sessionCounts?.[c.id] ?? 0} 個週次，以及它們的逐字稿與筆記</li>
                            <li>課表、作業時間、作業、閱讀材料、專有名詞表</li>
                            <li>上傳到這門課的所有檔案</li>
                          </ul>
                          要改課名或老師的話，用旁邊的「編輯」就好。
                        </>
                      ),
                    })
                    if (go) await deleteCourseCascade(c.id)
                  }}
                >
                  刪除
                </button>
                <button
                  className="btn ghost sm"
                  onClick={() => {
                    setDraft({
                      name: c.name,
                      teacher: c.teacher,
                      code: c.code,
                      credits: c.credits,
                      color: c.color,
                    })
                    setEditing(c.id)
                    setCreating(true)
                  }}
                >
                  編輯
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

      {creating && (
        <Modal
          title={editing ? '編輯課程' : '新增課程'}
          onClose={() => {
            setCreating(false)
            setEditing(null)
            setDraft(EMPTY_COURSE)
          }}
          onSubmit={submit}
          submitLabel={editing ? '儲存' : '建立'}
          submitDisabled={!draft.name.trim()}
        >
          <CourseForm value={draft} onChange={setDraft} showColor={Boolean(editing)} />
        </Modal>
      )}

      {termDraft && (
        <Modal
          title="編輯學期"
          onClose={() => setTermDraft(null)}
          onSubmit={submitTerm}
          submitLabel="儲存"
          submitDisabled={!termDraft.name.trim()}
        >
          <div className="field">
            <label htmlFor="t-name">學期名稱</label>
            <input
              id="t-name"
              type="text"
              autoFocus
              value={termDraft.name}
              onChange={(e) => setTermDraft({ ...termDraft, name: e.target.value })}
            />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="t-start">開始日</label>
              <input
                id="t-start"
                type="date"
                value={termDraft.startDate}
                onChange={(e) => setTermDraft({ ...termDraft, startDate: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="t-end">結束日</label>
              <input
                id="t-end"
                type="date"
                value={termDraft.endDate}
                onChange={(e) => setTermDraft({ ...termDraft, endDate: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="t-weeks">週數</label>
              <input
                id="t-weeks"
                type="number"
                min={1}
                max={30}
                value={termDraft.weeks}
                onChange={(e) =>
                  setTermDraft({ ...termDraft, weeks: Math.max(1, Number(e.target.value) || 1) })
                }
              />
              <div className="hint">密集課 6 週、暑期班 8 週都填得進來。</div>
            </div>
          </div>
          {affected > 0 &&
            (termDraft.startDate !== term.startDate || termDraft.weeks !== term.weeks) && (
              <div className="notice warn">
                改動開始日或週數後，這個學期已建立的 {affected} 個週次會依新的開始日重新編號。
                週次本身不會被刪除。
              </div>
            )}
        </Modal>
      )}
    </>
  )
}
