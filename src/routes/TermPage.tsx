import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { createCourse, db, deleteCourseCascade } from '../db'
import { COURSE_COLORS } from '../db/schema'
import { Breadcrumbs, TopBar } from '../components/Layout'
import { Modal } from '../components/Modal'

export function TermPage() {
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
  const [name, setName] = useState('')
  const [teacher, setTeacher] = useState('')
  const [code, setCode] = useState('')
  const [credits, setCredits] = useState(3)

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    await createCourse({
      termId,
      name: trimmed,
      teacher: teacher.trim(),
      code: code.trim(),
      credits,
      color: COURSE_COLORS[(courses?.length ?? 0) % COURSE_COLORS.length],
    })
    setName('')
    setTeacher('')
    setCode('')
    setCreating(false)
  }

  if (term === undefined) return <div className="page">載入中…</div>
  if (term === null) return <div className="page">找不到這個學期。<Link to="/">回到學期列表</Link></div>

  return (
    <>
      <TopBar>
        <Breadcrumbs items={[{ label: '學期', to: '/' }, { label: term.name }]} />
      </TopBar>

      <main className="page">
        <div className="page-head">
          <div className="grow">
            <h1>{term.name}</h1>
            <p>
              {term.startDate} 起 · {term.weeks} 週
            </p>
          </div>
          <button className="btn primary" onClick={() => setCreating(true)}>
            新增課程
          </button>
        </div>

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
                    if (confirm(`刪除「${c.name}」？底下所有週次、逐字稿與筆記都會一併刪除，無法復原。`)) {
                      await deleteCourseCascade(c.id)
                    }
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
          title="新增課程"
          onClose={() => setCreating(false)}
          onSubmit={submit}
          submitLabel="建立"
          submitDisabled={!name.trim()}
        >
          <div className="field">
            <label htmlFor="c-name">課程名稱</label>
            <input
              id="c-name"
              type="text"
              value={name}
              autoFocus
              placeholder="系統神學（一）"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="c-teacher">授課老師</label>
              <input id="c-teacher" type="text" value={teacher} onChange={(e) => setTeacher(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="c-code">課號</label>
              <input id="c-code" type="text" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="c-credits">學分</label>
              <input
                id="c-credits"
                type="number"
                min={0}
                max={12}
                value={credits}
                onChange={(e) => setCredits(Number(e.target.value))}
              />
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
