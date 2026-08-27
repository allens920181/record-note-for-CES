import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { appendSession, db, deleteSessionCascade } from '../db'
import { Breadcrumbs, TopBar } from '../components/Layout'

export function CoursePage() {
  const { courseId = '' } = useParams()
  const course = useLiveQuery(() => db.courses.get(courseId), [courseId])
  const term = useLiveQuery(
    async () => (course ? db.terms.get(course.termId) : undefined),
    [course?.termId],
  )
  const sessions = useLiveQuery(
    () => db.sessions.where('courseId').equals(courseId).sortBy('index'),
    [courseId],
  )
  /** Which sessions already have a transcript / a note, for the status chips. */
  const state = useLiveQuery(async () => {
    const [transcripts, notes] = await Promise.all([
      db.transcripts.toArray(),
      db.notes.toArray(),
    ])
    return {
      transcribed: new Set(transcripts.map((t) => t.sessionId)),
      noted: new Set(notes.filter((n) => n.markdown.trim()).map((n) => n.sessionId)),
    }
  }, [])

  if (course === undefined) return <div className="page">載入中…</div>
  if (course === null) return <div className="page">找不到這門課。<Link to="/">回到學期列表</Link></div>

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
            <p>{[course.teacher, course.code, `${course.credits} 學分`].filter(Boolean).join(' · ')}</p>
          </div>
          <button className="btn primary" onClick={() => appendSession(courseId)}>
            新增週次
          </button>
        </div>

        {sessions === undefined ? (
          <div className="empty">載入中…</div>
        ) : sessions.length === 0 ? (
          <div className="empty">
            <p>還沒有任何週次。按「新增週次」開出第一週，之後每按一次就往後排一週。</p>
            <button className="btn primary" onClick={() => appendSession(courseId)}>
              新增週次
            </button>
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
                    第 {s.index} 週{s.topic ? ` · ${s.topic}` : ''}
                  </div>
                  <div className="sub mono">{s.date}</div>
                </Link>
                {state?.transcribed.has(s.id) ? (
                  <span className="tag ok">已轉錄</span>
                ) : (
                  <span className="tag">未轉錄</span>
                )}
                {state?.noted.has(s.id) && <span className="tag ok">有筆記</span>}
                <button
                  className="btn danger sm"
                  onClick={async () => {
                    if (confirm(`刪除第 ${s.index} 週？逐字稿與筆記會一併刪除，無法復原。`)) {
                      await deleteSessionCascade(s.id)
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
    </>
  )
}
