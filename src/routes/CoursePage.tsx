import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  WEEKDAY_LABELS,
  createSessionOn,
  db,
  deleteSessionCascade,
  generateSessionsFromTimetable,
  renumberSessions,
  sumWorkHours,
  todayISO,
} from '../db'
import type { ClassSlot } from '../db'
import { MEETING_KIND_LABEL, SESSION_KIND_LABEL } from '../db/schema'
import type { MeetingKind } from '../db/schema'
import { Breadcrumbs, TopBar } from '../components/Layout'
import { AttachmentList } from '../components/AttachmentList'
import { WorkBlockEditor } from '../components/WorkBlockEditor'
import { ReadingList } from '../components/ReadingList'
import { CorrectionsPanel } from '../components/CorrectionsPanel'
import { Modal } from '../components/Modal'

type Tab = 'sessions' | 'setup' | 'work'

const MEETING_KINDS: MeetingKind[] = ['lecture', 'discussion']

export function CoursePage() {
  const { courseId = '' } = useParams()
  const [tab, setTab] = useState<Tab>('sessions')
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [adding, setAdding] = useState<MeetingKind | null>(null)
  const [addDate, setAddDate] = useState(todayISO())

  const course = useLiveQuery(() => db.courses.get(courseId), [courseId])
  const term = useLiveQuery(
    async () => (course ? db.terms.get(course.termId) : undefined),
    [course?.termId],
  )
  const sessions = useLiveQuery(async () => {
    const list = await db.sessions.where('courseId').equals(courseId).toArray()
    // Sort by date, not by week number: a week holds several meetings and
    // sorting on the shared number leaves their order to chance.
    return list.sort(
      (a, b) => a.date.localeCompare(b.date) || (a.kind ?? '').localeCompare(b.kind ?? ''),
    )
  }, [courseId])
  const workBlocks = useLiveQuery(
    () => db.workBlocks.where('courseId').equals(courseId).toArray(),
    [courseId],
  )
  const state = useLiveQuery(async () => {
    const [transcripts, notes] = await Promise.all([db.transcripts.toArray(), db.notes.toArray()])
    return {
      transcribed: new Set(transcripts.map((t) => t.sessionId)),
      noted: new Set(notes.filter((n) => n.markdown.trim()).map((n) => n.sessionId)),
    }
  }, [])

  if (course === undefined) return <div className="page">載入中…</div>
  if (course === null)
    return (
      <div className="page">
        找不到這門課。<Link to="/">回到學期列表</Link>
      </div>
    )

  const slots = course.slots
  const hours = sumWorkHours(workBlocks ?? [], term?.weeks ?? 0)

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
        </div>

        <div className="tabs">
          <button
            className={`tab${tab === 'sessions' ? ' active' : ''}`}
            onClick={() => setTab('sessions')}
          >
            週次 {sessions ? `(${sessions.length})` : ''}
          </button>
          <button className={`tab${tab === 'setup' ? ' active' : ''}`} onClick={() => setTab('setup')}>
            課表 · 作業時間 · 詞彙表 · 檔案
          </button>
          <button className={`tab${tab === 'work' ? ' active' : ''}`} onClick={() => setTab('work')}>
            作業 · 閱讀
          </button>
        </div>

        {message && (
          <div className={`notice ${message.kind}`} style={{ marginBottom: '1rem' }}>
            {message.text}
          </div>
        )}

        {tab === 'sessions' && (
          <>
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
                {sessions.map((s) => (
                  <div key={s.id} className="list-item">
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
                    <button
                      className="btn ghost sm"
                      onClick={() => db.sessions.update(s.id, { canceled: !s.canceled })}
                    >
                      {s.canceled ? '恢復' : '標記停課'}
                    </button>
                    <button
                      className="btn danger sm"
                      onClick={async () => {
                        if (
                          confirm(
                            `刪除 ${s.date} 的${SESSION_KIND_LABEL[s.kind ?? 'lecture']}？逐字稿與筆記會一併刪除，無法復原。`,
                          )
                        ) {
                          await deleteSessionCascade(s.id)
                          await renumberSessions(courseId)
                        }
                      }}
                    >
                      刪除
                    </button>
                  </div>
                ))}
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
                      <div className="field" style={{ flex: '1 1 6rem', marginBottom: 0 }}>
                        <label htmlFor={`st-${i}`}>開始</label>
                        <input
                          id={`st-${i}`}
                          type="text"
                          placeholder="19:00"
                          value={slot.start}
                          onChange={(e) =>
                            patchSlots(slots.map((s, j) => (j === i ? { ...s, start: e.target.value } : s)))
                          }
                        />
                      </div>
                      <div className="field" style={{ flex: '1 1 6rem', marginBottom: 0 }}>
                        <label htmlFor={`en-${i}`}>結束</label>
                        <input
                          id={`en-${i}`}
                          type="text"
                          placeholder="22:00"
                          value={slot.end}
                          onChange={(e) =>
                            patchSlots(slots.map((s, j) => (j === i ? { ...s, end: e.target.value } : s)))
                          }
                        />
                      </div>
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

            <AttachmentList
              scope="course"
              ownerId={courseId}
              courseId={courseId}
              kinds={['syllabus', 'reading', 'other']}
              title="課程檔案"
              hint="教學大綱與整學期共用的閱讀材料。PDF 會抽出文字，之後的跨週搜尋會用到。"
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
