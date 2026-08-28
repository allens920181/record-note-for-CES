import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  WEEKDAY_LABELS,
  createSessionOn,
  db,
  deleteSessionCascade,
  sessionsInOrder,
  updateCourse,
  generateSessionsFromTimetable,
  renumberSessions,
  sumWorkHours,
  todayISO,
} from '../db'
import type { ClassSlot } from '../db'
import { MEETING_KINDS, MEETING_KIND_LABEL, SESSION_KIND_LABEL } from '../db/schema'
import type { MeetingKind } from '../db/schema'
import { Breadcrumbs, TopBar } from '../components/Layout'
import { AttachmentList } from '../components/AttachmentList'
import { WorkBlockEditor } from '../components/WorkBlockEditor'
import { ReadingList } from '../components/ReadingList'
import { CorrectionsPanel } from '../components/CorrectionsPanel'
import { RequirementsPanel } from '../components/RequirementsPanel'
import { ProgressOverview } from '../components/ProgressOverview'
import { Modal } from '../components/Modal'
import { CourseForm } from '../components/CourseForm'
import type { CourseDraft } from '../components/CourseForm'
import { TimeField } from '../components/TimeField'
import { useConfirm } from '../components/ConfirmProvider'

type Tab = 'sessions' | 'setup' | 'work' | 'require'


export function CoursePage() {
  const ask = useConfirm()
  const { courseId = '' } = useParams()
  const [tab, setTab] = useState<Tab>('sessions')
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [adding, setAdding] = useState<MeetingKind | null>(null)
  const [addDate, setAddDate] = useState(todayISO())
  const [courseDraft, setCourseDraft] = useState<CourseDraft | null>(null)

  const course = useLiveQuery(() => db.courses.get(courseId), [courseId])
  const term = useLiveQuery(
    async () => (course ? db.terms.get(course.termId) : undefined),
    [course?.termId],
  )
  // Ordered by date rather than week number — a week holds several meetings and
  // sorting on the shared number leaves their order to chance. Shared with the
  // workspace's previous/next buttons so the two cannot disagree.
  const sessions = useLiveQuery(() => sessionsInOrder(courseId), [courseId])
  const workBlocks = useLiveQuery(
    () => db.workBlocks.where('courseId').equals(courseId).toArray(),
    [courseId],
  )
  const state = useLiveQuery(async () => {
    const ids = (await db.sessions.where('courseId').equals(courseId).primaryKeys()) as string[]
    const [scribed, notes, plans] = await Promise.all([
      // Keys, not records: a transcript holds every segment of a three-hour
      // lecture, and this only needs to know whether one exists.
      db.transcripts.where('sessionId').anyOf(ids).keys(),
      db.notes.where('sessionId').anyOf(ids).toArray(),
      db.weekPlans.where('courseId').equals(courseId).toArray(),
    ])
    return {
      transcribed: new Set(scribed as string[]),
      noted: new Set(notes.filter((n) => n.markdown.trim()).map((n) => n.sessionId)),
      plans: new Map(plans.map((p) => [p.sessionId, p.items])),
    }
  }, [courseId])

  if (course === undefined) return <div className="page">載入中…</div>
  if (course === null)
    return (
      <div className="page">
        找不到這門課。<Link to="/">回到學期列表</Link>
      </div>
    )

  const slots = course.slots
  const hours = sumWorkHours(workBlocks ?? [], term?.weeks ?? 0)
  const today = todayISO()

  async function patchSlots(next: ClassSlot[]) {
    await db.courses.update(courseId, { slots: next })
  }

  async function generate() {
    setMessage(null)
    try {
      const { created, skipped } = await generateSessionsFromTimetable(courseId)
      await renumberSessions(courseId)
      setMessage({
        kind: 'ok',
        text:
          created === 0
            ? '這些時段的週次都已經存在了，沒有新增任何一個。'
            : `產生了 ${created} 個週次${skipped > 0 ? `，另有 ${skipped} 個已存在而略過` : ''}。`,
      })
      setTab('sessions')
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    }
  }

  async function confirmAdd() {
    if (!adding) return
    await createSessionOn(courseId, addDate, adding)
    await renumberSessions(courseId)
    setAdding(null)
  }

  return (
    <>
      <TopBar>
        <Breadcrumbs
          items={[
            { label: '學期', to: '/' },
            { label: term?.name ?? '…', to: `/term/${course.termId}` },
            { label: course.name },
          ]}
        />
      </TopBar>

      <main className="page">
        <div className="page-head">
          <div className="grow">
            <h1>{course.name}</h1>
            <p>
              {[course.teacher, course.code, `${course.credits} 學分`].filter(Boolean).join(' · ')}
              {slots.length > 0 &&
                ` · ${slots
                  .map(
                    (s) =>
                      `週${WEEKDAY_LABELS[s.weekday]} ${s.start}${
                        s.kind === 'discussion' ? '（分組討論）' : ''
                      }`,
                  )
                  .join('、')}`}
              {hours.total > 0 && ` · 作業時間共 ${hours.total} 小時`}
            </p>
          </div>
          <button
            className="btn"
            style={{ flex: '0 0 auto' }}
            onClick={() => {
              setCourseDraft({
                name: course.name,
                teacher: course.teacher,
                code: course.code,
                credits: course.credits,
                color: course.color,
              })
            }}
          >
            編輯課程
          </button>
        </div>

        <div className="tabs">
          <button
            className={`tab${tab === 'sessions' ? ' active' : ''}`}
            onClick={() => setTab('sessions')}
          >
            週次 {sessions ? `(${sessions.length})` : ''}
          </button>
          <button className={`tab${tab === 'setup' ? ' active' : ''}`} onClick={() => setTab('setup')}>
            課表 · 作業時間 · 詞彙表
          </button>
          <button className={`tab${tab === 'work' ? ' active' : ''}`} onClick={() => setTab('work')}>
            作業 · 閱讀
          </button>
          <button
            className={`tab${tab === 'require' ? ' active' : ''}`}
            onClick={() => setTab('require')}
          >
            課堂要求 · 書目
          </button>
        </div>

        {message && (
          <div className={`notice ${message.kind}`} style={{ marginBottom: '1rem' }}>
            {message.text}
          </div>
        )}

        {tab === 'sessions' && (
          <>
            <ProgressOverview courseId={courseId} />

            <div className="row" style={{ gap: '.6rem', marginBottom: '1rem' }}>
              {MEETING_KINDS.map((k) => (
                <button
                  key={k}
                  className={`btn${k === 'lecture' ? ' primary' : ''}`}
                  style={{ flex: '0 0 auto' }}
                  onClick={() => {
                    setAddDate(sessions?.length ? todayISO() : (term?.startDate ?? todayISO()))
                    setAdding(k)
                  }}
                >
                  新增一次{MEETING_KIND_LABEL[k]}
                </button>
              ))}
              <button
                className="btn"
                style={{ flex: '0 0 auto' }}
                disabled={slots.length === 0}
                title={slots.length === 0 ? '先到「課表」設定每週固定的時段' : undefined}
                onClick={generate}
              >
                依課表產生整學期
              </button>
            </div>

            {sessions === undefined ? (
              <div className="empty">載入中…</div>
            ) : sessions.length === 0 ? (
              <div className="empty">
                <p>
                  還沒有任何週次。每週固定的課設好課表後按「依課表產生整學期」；
                  只開一次的聚會用「新增一次…」挑日期。
                </p>
              </div>
            ) : (
              <div className="stack">
                {sessions.map((s) => {
                  const items = state?.plans.get(s.id) ?? []
                  const planDone = items.filter((i) => i.done).length
                  const planLeft = items
                    .filter((i) => !i.done)
                    .reduce((sum, i) => sum + (Number(i.hours) || 0), 0)
                  const planState = s.canceled
                    ? 'off'
                    : items.length === 0
                      ? s.date < today
                        ? 'unplanned-past'
                        : 'unplanned'
                      : planDone === items.length
                        ? 'done'
                        : 'doing'
                  return (
                  <div key={s.id} className={`list-item wk-${planState}`}>
                    <Link
                      to={`/session/${s.id}`}
                      className="grow"
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <div className="title">
                        第 {s.index} 週 · {SESSION_KIND_LABEL[s.kind ?? 'lecture']}
                        {s.topic ? ` · ${s.topic}` : ''}
                      </div>
                      <div className="sub mono">
                        {s.date} 週{WEEKDAY_LABELS[new Date(`${s.date}T00:00:00`).getDay()]}
                      </div>
                    </Link>
                    {s.canceled ? (
                      <span className="tag warn">停課</span>
                    ) : state?.transcribed.has(s.id) ? (
                      <span className="tag ok">已轉錄</span>
                    ) : (
                      <span className="tag">未轉錄</span>
                    )}
                    {state?.noted.has(s.id) && <span className="tag ok">有筆記</span>}
                    {!s.canceled && (
                      <span
                        className={`tag${planState === 'done' ? ' ok' : planState === 'unplanned-past' ? ' warn' : ''}`}
                        title="本週進度"
                      >
                        {items.length === 0
                          ? '未排進度'
                          : `進度 ${planDone}/${items.length}${planLeft > 0 ? ` · ${planLeft}h` : ''}`}
                      </span>
                    )}
                    <button
                      className="btn ghost sm"
                      onClick={() => db.sessions.update(s.id, { canceled: !s.canceled })}
                    >
                      {s.canceled ? '恢復' : '標記停課'}
                    </button>
                    <button
                      className="btn danger sm"
                      onClick={async () => {
                        const go = await ask({
                          title: `刪除 ${s.date} 的${SESSION_KIND_LABEL[s.kind ?? 'lecture']}？`,
                          danger: true,
                          confirmLabel: '刪除這個週次',
                          body: (
                            <>
                              會一起消失的：這一週的逐字稿、筆記、本週進度與講義。
                              <br />
                              只是想重新轉錄的話，到那一週的工作區用逐字稿旁的「⋯」，筆記會留著。
                            </>
                          ),
                        })
                        if (go) {
                          await deleteSessionCascade(s.id)
                          await renumberSessions(courseId)
                        }
                      }}
                    >
                      刪除
                    </button>
                  </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {tab === 'setup' && (
          <>
            {/* ── recurring meetings ────────────────────────────── */}
            <section className="card" style={{ marginBottom: '1.25rem' }}>
              <h2>每週固定的上課時段</h2>
              <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
                只放<strong>每週都會發生</strong>的聚會。正課和分組討論各自每週開一個檔案——
                兩場是分開的錄音，時間軸沒辦法合併，但同一週會共用同一個週次編號。
                <br />
                只開一次的分組討論不必寫在這裡，到「週次」用「新增一次分組討論」挑日期就好。
              </p>

              {slots.length === 0 ? (
                <div className="empty" style={{ padding: '1.25rem', marginBottom: '.9rem' }}>
                  還沒有固定時段。
                </div>
              ) : (
                <div className="stack" style={{ marginBottom: '.9rem' }}>
                  {slots.map((slot, i) => (
                    <div key={i} className="row slot-row" style={{ gap: '.5rem', alignItems: 'flex-end' }}>
                      <div className="field" style={{ flex: '0 0 8rem', marginBottom: 0 }}>
                        <label htmlFor={`kd-${i}`}>類型</label>
                        <select
                          id={`kd-${i}`}
                          value={slot.kind ?? 'lecture'}
                          onChange={(e) =>
                            patchSlots(
                              slots.map((sl, j) =>
                                j === i ? { ...sl, kind: e.target.value as MeetingKind } : sl,
                              ),
                            )
                          }
                        >
                          {MEETING_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {MEETING_KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field" style={{ flex: '0 0 7rem', marginBottom: 0 }}>
                        <label htmlFor={`wd-${i}`}>星期</label>
                        <select
                          id={`wd-${i}`}
                          value={slot.weekday}
                          onChange={(e) =>
                            patchSlots(
                              slots.map((s, j) =>
                                j === i ? { ...s, weekday: Number(e.target.value) } : s,
                              ),
                            )
                          }
                        >
                          {WEEKDAY_LABELS.map((label, wd) => (
                            <option key={wd} value={wd}>
                              週{label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <TimeField
                        id={`st-${i}`}
                        label="開始"
                        value={slot.start}
                        onChange={(v) =>
                          patchSlots(slots.map((s, j) => (j === i ? { ...s, start: v } : s)))
                        }
                        style={{ flex: '1 1 6rem' }}
                      />
                      <TimeField
                        id={`en-${i}`}
                        label="結束"
                        value={slot.end}
                        onChange={(v) =>
                          patchSlots(slots.map((s, j) => (j === i ? { ...s, end: v } : s)))
                        }
                        style={{ flex: '1 1 6rem' }}
                      />
                      <div className="field" style={{ flex: '1 1 7rem', marginBottom: 0 }}>
                        <label htmlFor={`rm-${i}`}>教室</label>
                        <input
                          id={`rm-${i}`}
                          type="text"
                          value={slot.room ?? ''}
                          onChange={(e) =>
                            patchSlots(slots.map((s, j) => (j === i ? { ...s, room: e.target.value } : s)))
                          }
                        />
                      </div>
                      <button
                        className="btn danger sm"
                        style={{ flex: '0 0 auto' }}
                        onClick={() => patchSlots(slots.filter((_, j) => j !== i))}
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="row" style={{ gap: '.6rem' }}>
                {MEETING_KINDS.map((k) => (
                  <button
                    key={k}
                    className="btn"
                    style={{ flex: '0 0 auto' }}
                    onClick={() =>
                      patchSlots([
                        ...slots,
                        { weekday: k === 'discussion' ? 4 : 2, start: '19:00', end: '22:00', kind: k },
                      ])
                    }
                  >
                    新增每週{MEETING_KIND_LABEL[k]}
                  </button>
                ))}
                <button
                  className="btn primary"
                  style={{ flex: '0 0 auto' }}
                  disabled={slots.length === 0}
                  onClick={generate}
                >
                  依課表產生整學期
                </button>
              </div>
            </section>

            <WorkBlockEditor
              courseId={courseId}
              termWeeks={term?.weeks ?? 0}
              defaultDate={term?.startDate ?? todayISO()}
            />

            {/* ── glossary ──────────────────────────────────────── */}
            <section className="card" style={{ marginBottom: '1.25rem' }}>
              <h2>專有名詞表</h2>
              <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
                這串會隨這門課的每次轉錄一起送給模型，讓它知道該怎麼寫這些字。
                在逐字稿選取文字後也可以直接加進來。目前 {course.glossary.length} 個詞。
              </p>
              <textarea
                rows={4}
                placeholder="加爾文、巴特、士來馬赫、預定論、釋經學、稱義、成聖、logos、chesed"
                // Uncontrolled so typing is never interrupted, but keyed on the
                // saved list so a term added from the corrections panel below
                // actually appears here instead of silently disagreeing with it.
                key={course.glossary.join('、')}
                defaultValue={course.glossary.join('、')}
                onBlur={(e) =>
                  db.courses.update(courseId, {
                    glossary: e.target.value
                      .split(/[、,\n]/)
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
              />
              <p className="small muted" style={{ marginTop: '.5rem' }}>
                用頓號或換行分隔。離開輸入框就會存檔。
              </p>
            </section>

            <CorrectionsPanel courseId={courseId} />

          </>
        )}
        {tab === 'require' && (
          <>
            <RequirementsPanel courseId={courseId} />
            <AttachmentList
              scope="course"
              ownerId={courseId}
              courseId={courseId}
              kinds={['syllabus', 'reading', 'other']}
              title="書目與課程檔案"
              hint="教學大綱、指定書目、整學期共用的閱讀材料。PDF 會抽出文字，跨週搜尋找得到；閱讀清單裡的每一本書也可以指到這裡的檔案。"
            />
          </>
        )}

        {tab === 'work' && (
          <>
            <section className="card" style={{ marginBottom: '1.25rem' }}>
              <h2>這門課的作業</h2>
              <p className="small muted" style={{ margin: '.3rem 0 .6rem' }}>
                所有課程的作業一起看、依截止日排序，在{' '}
                <Link to="/assignments">作業頁</Link>。
              </p>
            </section>
            <ReadingList courseId={courseId} />
          </>
        )}
      </main>

      {courseDraft && (
        <Modal
          title="編輯課程"
          onClose={() => setCourseDraft(null)}
          onSubmit={async () => {
            const name = courseDraft.name.trim()
            if (!name) return
            await updateCourse(courseId, {
              ...courseDraft,
              name,
              teacher: courseDraft.teacher.trim(),
              code: courseDraft.code.trim(),
            })
            setCourseDraft(null)
          }}
          submitLabel="儲存"
          submitDisabled={!courseDraft.name.trim()}
        >
          <CourseForm value={courseDraft} onChange={setCourseDraft} showColor />
        </Modal>
      )}

      {adding && (
        <Modal
          title={`新增一次${MEETING_KIND_LABEL[adding]}`}
          onClose={() => setAdding(null)}
          onSubmit={confirmAdd}
          submitLabel="建立"
        >
          <div className="field">
            <label htmlFor="add-date">日期</label>
            <input
              id="add-date"
              type="date"
              value={addDate}
              autoFocus
              onChange={(e) => setAddDate(e.target.value)}
            />
            <div className="hint">
              週次編號會依這個日期自動算出來，和同一週的其他聚會共用。
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
