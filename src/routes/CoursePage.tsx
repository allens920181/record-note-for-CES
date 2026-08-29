import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  WEEKDAY_LABELS,
  db,
  deleteSessionCascade,
  sessionsInOrder,
  updateCourse,
  generateSessionsFromTimetable,
  insertNoteBlock,
  renumberSessions,
  todayISO,
} from '../db'
import { SESSION_KIND_LABEL, isMeeting } from '../db/schema'
import type { SessionKind } from '../db/schema'
import { Breadcrumbs, PageShell, TopBar } from '../components/Layout'
import { ReadingList } from '../components/ReadingList'
import { CorrectionsPanel } from '../components/CorrectionsPanel'
import { FileOverview } from '../components/FileOverview'
import { RequirementsPanel } from '../components/RequirementsPanel'
import { ProgressOverview } from '../components/ProgressOverview'
import { Modal } from '../components/Modal'
import { CourseForm } from '../components/CourseForm'
import type { CourseDraft } from '../components/CourseForm'
import { GlossaryChips } from '../components/GlossaryChips'
import { ProgressTag } from '../components/ProgressTag'
import { RowMenu } from '../components/RowMenu'
import { TimeBlockDialog, createTimeBlock, makeDraft } from '../components/TimeBlockDialog'
import type { TimeBlockDraft } from '../components/TimeBlockDialog'
import { useConfirm } from '../components/ConfirmProvider'
import { AssignmentCard, NewAssignmentDialog } from '../components/AssignmentCard'

/** The two dialogs that hold everything which is about the course, not a week. */
type Panel = 'rules' | 'files'
const PANELS: string[] = ['rules', 'files']

const INSERT_KINDS: { kind: SessionKind; label: string; hint: string }[] = [
  { kind: 'discussion', label: '分組討論', hint: '會發生的聚會，可以錄音' },
  { kind: 'log', label: '作業紀錄', hint: '這份報告做到哪、卡在哪' },
  { kind: 'memo', label: '其他筆記', hint: '不屬於任何一堂課的東西' },
]

/**
 * The hairline between two blocks, and the way to put something there.
 *
 * Always in the tree rather than conjured on hover: a control that only exists
 * for a mouse cannot be reached by tab, and this is the only way to file a note
 * between two weeks.
 */
function Inserter({ onPick, label }: { onPick: (kind: SessionKind) => void; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`inserter${open ? ' is-open' : ''}`}>
      <button className="inserter-plus" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>
        ＋
      </button>
      {open && (
        <div className="inserter-menu" role="menu">
          {INSERT_KINDS.map((k) => (
            <button
              key={k.kind}
              role="menuitem"
              className="inserter-item"
              onClick={() => {
                setOpen(false)
                onPick(k.kind)
              }}
            >
              <span className="inserter-label">{k.label}</span>
              <span className="inserter-hint">{k.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}


/**
 * Whether this week's audio has been turned into text.
 *
 * A week can hold more than one recording — a break in the middle, a phone that
 * died — so the honest states are three, not two: nothing recorded, all of it
 * transcribed, and some of it still waiting.
 */
function TranscriptTag({ parts, done }: { parts: number; done: number }) {
  if (parts === 0) return <span className="tag">未轉錄</span>
  if (done >= parts)
    return <span className="tag ok">已轉錄{parts > 1 ? ` · ${parts} 段` : ''}</span>
  return (
    <span className="tag warn">
      {done} / {parts} 段已轉錄
    </span>
  )
}

export function CoursePage() {
  const ask = useConfirm()
  const { courseId = '' } = useParams()
  // In the URL, not in state: a link can point at a specific tab, the back
  // button returns to the one you were on, and the calendar can send you
  // straight to the dialog holding the thing that was clicked.
  const [params, setParams] = useSearchParams()
  // In the URL so a link can open a dialog, the back button closes it, and the
  // calendar can point straight at the study time inside 課程規定與作業.
  const panel = (PANELS.includes(params.get('panel') ?? '') ? params.get('panel') : null) as
    | Panel
    | null
  const setPanel = (next: Panel | null) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next) p.set('panel', next)
        else p.delete('panel')
        return p
      },
      { replace: true },
    )
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [adding, setAdding] = useState<TimeBlockDraft | null>(null)
  const [courseDraft, setCourseDraft] = useState<CourseDraft | null>(null)
  const [openAssignment, setOpenAssignment] = useState<string | null>(null)
  const [creatingAssignment, setCreatingAssignment] = useState(false)

  // `?? null` so a missing row is distinguishable from a pending read: Dexie
  // returns undefined for both, which left the "找不到" branch unreachable and
  // a deleted or mistyped id showing 載入中… for ever.
  const course = useLiveQuery(async () => (await db.courses.get(courseId)) ?? null, [courseId])
  const term = useLiveQuery(
    async () => (course ? db.terms.get(course.termId) : undefined),
    [course?.termId],
  )
  // Ordered by date rather than week number — a week holds several meetings and
  // sorting on the shared number leaves their order to chance. Shared with the
  // workspace's previous/next buttons so the two cannot disagree.
  const sessions = useLiveQuery(() => sessionsInOrder(courseId), [courseId])
  const assignments = useLiveQuery(
    () => db.assignments.where('courseId').equals(courseId).toArray(),
    [courseId],
  )
  const state = useLiveQuery(async () => {
    const ids = (await db.sessions.where('courseId').equals(courseId).primaryKeys()) as string[]
    const [scribed, recordings, notes, plans] = await Promise.all([
      // Keys, not records: a transcript holds every segment of a three-hour
      // lecture, and this only needs to know whether one exists.
      db.transcripts.where('sessionId').anyOf(ids).keys(),
      db.recordings.where('sessionId').anyOf(ids).toArray(),
      db.notes.where('sessionId').anyOf(ids).toArray(),
      db.weekPlans.where('courseId').equals(courseId).toArray(),
    ])
    // A week can hold several recordings, and "已轉錄" should mean all of them:
    // one part still waiting is exactly what you came to this page to notice.
    const partsOf = new Map<string, number>()
    for (const r of recordings) partsOf.set(r.sessionId, (partsOf.get(r.sessionId) ?? 0) + 1)
    const doneOf = new Map<string, number>()
    for (const sid of scribed as string[]) doneOf.set(sid, (doneOf.get(sid) ?? 0) + 1)
    return {
      parts: partsOf,
      transcribedParts: doneOf,
      transcribed: new Set(scribed as string[]),
      noted: new Set(notes.filter((n) => n.markdown.trim()).map((n) => n.sessionId)),
      plans: new Map(plans.map((p) => [p.sessionId, p.items])),
    }
  }, [courseId])

  // Hooks must run on every render, so this sits above the early returns.
  const dueList = useMemo(
    () =>
      [...(assignments ?? [])].sort(
        (a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title),
      ),
    [assignments],
  )

  if (course === undefined)
    return (
      <PageShell crumbs={[{ label: '學期', to: '/' }, { label: '…' }]}>
        <div className="empty">載入中…</div>
      </PageShell>
    )
  if (course === null)
    return (
      <PageShell crumbs={[{ label: '學期', to: '/' }, { label: '找不到' }]}>
        <div className="empty">
          <p>找不到這門課，可能已經被刪掉了。</p>
          <Link className="btn primary" to="/">
            回到學期列表
          </Link>
        </div>
      </PageShell>
    )

  const slots = course.slots
  const today = todayISO()

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
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Opens the course dialog, which is where the weekly timetable lives. */
  function editCourse() {
    if (!course) return
    setCourseDraft({
      name: course.name,
      teacher: course.teacher,
      code: course.code,
      credits: course.credits,
      color: course.color,
      slots: course.slots,
    })
  }

  async function insertAt(kind: SessionKind, after: string | null) {
    const id = await insertNoteBlock(courseId, kind, after)
    await renumberSessions(courseId)
    setMessage({ kind: 'ok', text: `已加入一個${SESSION_KIND_LABEL[kind]}。` })
    return id
  }

  function openAdd() {
    // A course with no weeks yet is being set up, so the term's first day is a
    // far better guess than today — which is usually before the term starts.
    setAdding(
      makeDraft(
        course ?? undefined,
        sessions?.length ? todayISO() : (term?.startDate ?? todayISO()),
        null,
        'lecture',
        'once',
      ),
    )
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
            </p>
          </div>
        </div>

        {message && (
          <div className={`notice ${message.kind}`} style={{ marginBottom: '1rem' }}>
            {message.text}
          </div>
        )}

        <div className="course-body">
          <div className="course-blocks">
            <ProgressOverview courseId={courseId} />

            <div className="row" style={{ gap: '.6rem', marginBottom: '1rem' }}>
              <button className="btn primary" style={{ flex: '0 0 auto' }} onClick={openAdd}>
                新增一堂課
              </button>
              {slots.length > 0 ? (
                <button className="btn" style={{ flex: '0 0 auto' }} onClick={generate}>
                  依課表產生整學期
                </button>
              ) : (
                sessions !== undefined &&
                sessions.length > 0 && (
                  <span className="small muted" style={{ flex: '0 0 auto', alignSelf: 'center' }}>
                    還沒有每週固定的時段，
                    <button className="linkish" onClick={editCourse}>
                      去設課表
                    </button>
                    後就能一次產生整學期。
                  </span>
                )
              )}
            </div>

            {sessions === undefined ? (
              <div className="empty">載入中…</div>
            ) : sessions.length === 0 ? (
              <div className="empty">
                <p>還沒有任何一堂課。</p>
                <p className="small muted">每週都上的課先設好課表，就能一次產生整學期。</p>
                {slots.length === 0 ? (
                  <button className="btn primary" onClick={editCourse}>
                    去設定課表
                  </button>
                ) : (
                  <button className="btn primary" onClick={generate}>
                    依課表產生整學期
                  </button>
                )}
              </div>
            ) : (
              <div className="blocks">
                {/* Above the first block as well as between them, so a note can
                    be filed before week one without reordering anything. */}
                <Inserter onPick={(k) => void insertAt(k, null)} label="在最前面加一個筆記區" />
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
                  const meeting = isMeeting(s.kind)
                  return (
                    <div key={s.id}>
                      <div className={`block wk-${planState}`}>
                        {/* The whole card is the link: the block is the note,
                            and hunting for a small title to click is friction
                            on the one thing this page is for. */}
                        <Link to={`/session/${s.id}`} className="block-hit">
                          <div className="block-main">
                            <div className="block-title">
                              第 {s.index} 週 · {SESSION_KIND_LABEL[s.kind ?? 'lecture']}
                              {s.topic ? ` · ${s.topic}` : ''}
                            </div>
                            <div className="block-sub mono">
                              {meeting
                                ? `${s.date} 週${WEEKDAY_LABELS[new Date(`${s.date}T00:00:00`).getDay()]}${
                                    s.start ? ` ${s.start}` : ''
                                  }`
                                : '筆記區'}
                            </div>
                          </div>
                        </Link>

                        <div className="block-tags">
                          {s.canceled ? (
                            <span className="tag warn">停課</span>
                          ) : meeting ? (
                            <TranscriptTag
                              parts={state?.parts.get(s.id) ?? 0}
                              done={state?.transcribedParts.get(s.id) ?? 0}
                            />
                          ) : null}
                          {state?.noted.has(s.id) && <span className="tag ok">有筆記</span>}
                          {!s.canceled && meeting && (
                            <ProgressTag
                              done={planDone}
                              total={items.length}
                              hoursLeft={planLeft}
                              label="進度"
                              emptyLabel="未排進度"
                              tone={
                                planState === 'done'
                                  ? 'ok'
                                  : planState === 'unplanned-past'
                                    ? 'warn'
                                    : undefined
                              }
                              title="本週進度"
                            />
                          )}
                        </div>

                        <div className="block-acts">
                          <RowMenu
                            label={`第 ${s.index} 週`}
                            actions={[
                              ...(meeting
                                ? [
                                    {
                                      label: s.canceled ? '取消停課' : '標記停課',
                                      onSelect: () =>
                                        void db.sessions.update(s.id, { canceled: !s.canceled }),
                                    },
                                  ]
                                : []),
                              {
                                label: meeting ? '刪除這個週次' : '刪除這個筆記區',
                                danger: true,
                                onSelect: async () => {
                                  const go = await ask({
                                    title: `刪除${
                                      meeting ? `${s.date} 的` : '這個'
                                    }${SESSION_KIND_LABEL[s.kind ?? 'lecture']}？`,
                                    danger: true,
                                    confirmLabel: meeting ? '刪除這個週次' : '刪除這個筆記區',
                                    body: meeting ? (
                                      <>
                                        會一起消失的：這一週的逐字稿、筆記、本週進度與講義。
                                        <br />
                                        只是想重新轉錄的話，到那一週的工作區用逐字稿旁的「⋯」，筆記會留著。
                                      </>
                                    ) : (
                                      '這個筆記區裡寫的東西會一起消失。'
                                    ),
                                  })
                                  if (go) {
                                    await deleteSessionCascade(s.id)
                                    await renumberSessions(courseId)
                                  }
                                },
                              },
                            ]}
                          />
                        </div>
                      </div>
                      <Inserter
                        onPick={(k) => void insertAt(k, s.id)}
                        label={`在第 ${s.index} 週後面加一個筆記區`}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Everything that describes the course rather than a week in it.
              Three dialogs, so the page itself stays the list of blocks. */}
          <aside className="course-rail" aria-label="這門課的設定">
            <button className="btn rail-btn" onClick={editCourse}>
              編輯課程
            </button>
            <button className="btn rail-btn" onClick={() => setPanel('rules')}>
              課程規定與作業
            </button>
            <button className="btn rail-btn" onClick={() => setPanel('files')}>
              文件總覽
            </button>
          </aside>
        </div>
      </main>

      {courseDraft && (
        <Modal
          wide
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
            // Renumbering is the generator's job, not the dialog's: changing a
            // slot's weekday does not move the meetings already on the calendar.
            setCourseDraft(null)
          }}
          submitLabel="儲存"
          submitDisabled={!courseDraft.name.trim()}
        >
          <CourseForm value={courseDraft} onChange={setCourseDraft} showColor />

          {/* Words the transcriber needs, kept with the course they belong to.
              Written straight through rather than through the draft: the list
              is its own record, and 取消 should not silently drop a word you
              added while the dialog happened to be open. */}
          <div className="field" style={{ marginTop: '1rem' }}>
            <label>專有名詞表</label>
            <div className="hint" style={{ marginTop: 0, marginBottom: '.5rem' }}>
              {course.glossary.length === 0
                ? '轉錄時連同這串一起送給模型，讓它知道該怎麼寫這些字。打完一個詞按 Enter 或頓號。'
                : `${course.glossary.length} 個詞，會隨這門課的每次轉錄一起送出。`}
            </div>
            <GlossaryChips
              terms={course.glossary}
              onChange={(glossary) => void db.courses.update(courseId, { glossary })}
              placeholder="加爾文、巴特、chesed…"
              emptyText="還沒有這門課的專有名詞。"
            />
          </div>
          <CorrectionsPanel courseId={courseId} />
        </Modal>
      )}

      {panel === 'rules' && (
        <Modal wide title="課程規定與作業" onClose={() => setPanel(null)} cancelLabel="關閉">
          <RequirementsPanel courseId={courseId} />

          <section className="card" style={{ marginBottom: '1.25rem' }}>
            <div className="page-head" style={{ marginBottom: '.6rem' }}>
              <div className="grow">
                <h2>這門課的作業</h2>
                <p className="small muted" style={{ margin: '.3rem 0 0' }}>
                  依截止日排序。所有課程一起看在 <Link to="/assignments">作業頁</Link>。
                </p>
              </div>
              <button
                className="btn primary"
                style={{ flex: '0 0 auto' }}
                onClick={() => setCreatingAssignment(true)}
              >
                新增作業
              </button>
            </div>
            {assignments === undefined ? (
              <div className="empty">載入中…</div>
            ) : dueList.length === 0 ? (
              <div className="empty">這門課還沒有作業。</div>
            ) : (
              <div className="stack">
                {dueList.map((a) => (
                  <AssignmentCard
                    key={a.id}
                    assignment={a}
                    course={course}
                    open={openAssignment === a.id}
                    onToggle={() => setOpenAssignment(openAssignment === a.id ? null : a.id)}
                    showCourse={false}
                  />
                ))}
              </div>
            )}
          </section>

          <ReadingList courseId={courseId} />
        </Modal>
      )}

      {panel === 'files' && (
        <Modal wide title="文件總覽" onClose={() => setPanel(null)} cancelLabel="關閉">
          <FileOverview courseId={courseId} />
        </Modal>
      )}

      {creatingAssignment && (
        <NewAssignmentDialog
          courses={[course]}
          courseId={courseId}
          onClose={() => setCreatingAssignment(false)}
          onCreated={(id) => {
            setCreatingAssignment(false)
            setOpenAssignment(id)
          }}
        />
      )}

      {adding && (
        <TimeBlockDialog
          draft={adding}
          onChange={setAdding}
          courses={[course]}
          onClose={() => setAdding(null)}
          onSubmit={async () => {
            try {
              setMessage({ kind: 'ok', text: await createTimeBlock(adding) })
            } catch (err) {
              setMessage({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
            }
            setAdding(null)
          }}
          title="新增一堂課"
        />
      )}
    </>
  )
}
