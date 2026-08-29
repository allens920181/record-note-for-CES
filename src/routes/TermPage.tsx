import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { createCourse, db, deleteCourseCascade, sessionsInTerm, updateCourse, updateTerm } from '../db'
import { COURSE_COLORS, COURSE_KIND_LABEL } from '../db/schema'
import { weeksBetween } from '../lib/dates'
import { Breadcrumbs, PageShell, TopBar } from '../components/Layout'
import { Modal } from '../components/Modal'
import { SetupBanner } from '../components/SetupBanner'
import { CourseForm, EMPTY_COURSE } from '../components/CourseForm'
import type { CourseDraft } from '../components/CourseForm'
import { useConfirm } from '../components/ConfirmProvider'

export function TermPage() {
  const ask = useConfirm()
  const { termId = '' } = useParams()
  // See CoursePage: undefined means "still reading", null means "not there".
  const term = useLiveQuery(async () => (await db.terms.get(termId)) ?? null, [termId])
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
  } | null>(null)
  const [affected, setAffected] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit() {
    const name = draft.name.trim()
    if (!name) return
    if (editing) {
      await updateCourse(editing, {
        ...draft,
        name,
        teacher: draft.teacher.trim(),
        code: draft.code.trim(),
        // '' is "not said", which is stored as no field at all rather than as
        // an empty string that every reader would then have to know about.
        kind: draft.kind || undefined,
      })
      setNotice(`已更新「${name}」。`)
    } else {
      await createCourse({
        termId,
        name,
        teacher: draft.teacher.trim(),
        code: draft.code.trim(),
        credits: draft.credits,
        kind: draft.kind || undefined,
        color: COURSE_COLORS[(courses?.length ?? 0) % COURSE_COLORS.length],
        // Said once, here: a new course used to be created without a time and
        // then need a second errand on another screen to acquire one.
        slots: draft.slots,
      })
    }
    setDraft(EMPTY_COURSE)
    setEditing(null)
    setCreating(false)
  }

  /** Credits by 修別, counting only the courses that say which they are. */
  const credits = (courses ?? []).reduce(
    (sum, c) => {
      if (c.kind === 'required') sum.required += c.credits
      else if (c.kind === 'elective') sum.elective += c.credits
      return sum
    },
    { required: 0, elective: 0 },
  )

  async function submitTerm() {
    if (!termDraft || !termDraft.name.trim() || termDraft.endDate < termDraft.startDate) return
    const { renumbered } = await updateTerm(termId, {
      name: termDraft.name.trim(),
      startDate: termDraft.startDate,
      endDate: termDraft.endDate,
    })
    setTermDraft(null)
    setNotice(renumbered > 0 ? `已更新學期，並重新編號 ${renumbered} 個週次。` : '已更新學期。')
  }

  if (term === undefined)
    return (
      <PageShell crumbs={[{ label: '學期', to: '/' }, { label: '…' }]}>
        <div className="empty">載入中…</div>
      </PageShell>
    )
  if (term === null)
    return (
      <PageShell crumbs={[{ label: '學期', to: '/' }, { label: '找不到' }]}>
        <div className="empty">
          <p>找不到這個學期，可能已經被刪掉了。</p>
          <Link className="btn primary" to="/">
            回到學期列表
          </Link>
        </div>
      </PageShell>
    )

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
              {term.startDate} 起 · {weeksBetween(term.startDate, term.endDate)} 週
              {/* Nothing but the addition of what is on the list below — and
                  the reason to mark a course 必修 in the first place. Absent
                  until something has been marked, so it never reads as「這學期
                  沒有必修」when the truth is that nobody has said yet. */}
              {credits.required + credits.elective > 0 && (
                <>
                  {' · '}
                  {[
                    credits.required > 0 ? `必修 ${credits.required} 學分` : '',
                    credits.elective > 0 ? `選修 ${credits.elective} 學分` : '',
                  ]
                    .filter(Boolean)
                    .join('、')}
                </>
              )}
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
                  <div className="title">
                    {c.name}
                    {c.kind && (
                      <span className={`tag${c.kind === 'required' ? ' warn' : ''}`}>
                        {COURSE_KIND_LABEL[c.kind]}
                      </span>
                    )}
                  </div>
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
                            <li>課表、作業、閱讀材料、專有名詞表</li>
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
                      kind: c.kind ?? '',
                      slots: c.slots,
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
          wide
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
          submitDisabled={!termDraft.name.trim() || termDraft.endDate < termDraft.startDate}
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
          </div>
          {/* 週數是從兩個日期算出來的，不是第三個可以和它們打架的欄位。
              密集課 6 週、暑期班 8 週，都只是不同的結束日。 */}
          <div className="hint" data-testid="term-weeks">
            {termDraft.endDate < termDraft.startDate
              ? '結束日期不能早於開始日期。'
              : `共 ${weeksBetween(termDraft.startDate, termDraft.endDate)} 週。`}
          </div>
          {affected > 0 &&
            (termDraft.startDate !== term.startDate || termDraft.endDate !== term.endDate) && (
              <div className="notice warn">
                改動日期後，這個學期已建立的 {affected} 個週次會依新的開始日重新編號。
                週次本身不會被刪除。
              </div>
            )}
        </Modal>
      )}
    </>
  )
}
