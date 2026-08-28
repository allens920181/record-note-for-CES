import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { findMarks, search } from '../schedule/search'
import type { HitKind, MarkHit, SearchHit } from '../schedule/search'
import { NOTE_MARKS } from '../editor/marks'
import type { NoteMark } from '../editor/marks'
import { formatTime } from '../lib/time'
import { Breadcrumbs, TopBar } from '../components/Layout'

const KIND_LABEL: Record<HitKind, string> = {
  transcript: '逐字稿',
  note: '筆記',
  file: '檔案',
}

export function SearchPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [courseId, setCourseId] = useState('')
  const [kinds, setKinds] = useState<HitKind[]>(['transcript', 'note', 'file'])
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  // Marks are their own question — "show me everything I flagged" is not a
  // phrase search, and it wants whole blocks rather than sixty characters.
  const [marks, setMarks] = useState<NoteMark[]>([])
  const [found, setFound] = useState<MarkHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const courses = useLiveQuery(() => db.courses.toArray(), [])
  // Distinguishes "nothing matched" from "there is nothing here to match".
  const corpus = useLiveQuery(async () => {
    const [tx, notes, files] = await Promise.all([
      db.transcripts.count(),
      db.notes.count(),
      db.attachments.count(),
    ])
    return tx + notes + files
  }, [])

  const timer = useRef<number | null>(null)
  const run = useMemo(
    () => (q: string, cid: string, ks: HitKind[]) => {
      if (timer.current) window.clearTimeout(timer.current)
      if (q.trim().length === 0) {
        setHits(null)
        return
      }
      timer.current = window.setTimeout(async () => {
        setBusy(true)
        const started = performance.now()
        try {
          setHits(await search(q, { courseId: cid || undefined, kinds: ks }))
          setElapsed(Math.round(performance.now() - started))
        } finally {
          setBusy(false)
        }
      }, 250)
    },
    [],
  )

  useEffect(() => {
    run(query, courseId, kinds)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [query, courseId, kinds, run])

  useEffect(() => {
    let live = true
    if (marks.length === 0) {
      setFound(null)
      return
    }
    void findMarks(marks, { courseId: courseId || undefined }).then((rows) => {
      if (live) setFound(rows)
    })
    return () => {
      live = false
    }
  }, [marks, courseId])

  function open(hit: SearchHit) {
    if (!hit.sessionId) {
      navigate(`/course/${hit.courseId}`)
      return
    }
    // The timestamp rides along so the workspace can jump straight to the line.
    navigate(
      hit.seconds !== undefined
        ? `/session/${hit.sessionId}?t=${Math.floor(hit.seconds)}`
        : `/session/${hit.sessionId}`,
    )
  }

  function toggleKind(k: HitKind) {
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))
  }

  return (
    <>
      <TopBar>
        <Breadcrumbs items={[{ label: '搜尋' }]} />
      </TopBar>

      <main className="page">
        <div className="page-head">
          <div className="grow">
            <h1>跨週搜尋</h1>
            <p>
              一次搜尋所有逐字稿、筆記與 PDF 文字。找到逐字稿的句子時，
              點下去會直接跳到那一秒。
            </p>
          </div>
        </div>

        <div className="field">
          <input
            type="text"
            autoFocus
            placeholder="輸入你記得的那句話，例如「預定論」或「chesed」"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ fontSize: '1rem', padding: '.6rem .8rem' }}
          />
        </div>

        <div className="row" style={{ gap: '.6rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
          <div className="field" style={{ flex: '0 0 14rem', marginBottom: 0 }}>
            <label htmlFor="s-course">課程</label>
            <select id="s-course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">全部課程</option>
              {(courses ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ flex: '0 0 auto', gap: '.4rem' }}>
            {(Object.keys(KIND_LABEL) as HitKind[]).map((k) => (
              <button
                key={k}
                className={`btn sm${kinds.includes(k) ? ' primary' : ''}`}
                style={{ flex: '0 0 auto' }}
                onClick={() => toggleKind(k)}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="row" style={{ gap: '.4rem', alignItems: 'center', marginBottom: '1rem' }}>
          <span className="small muted" style={{ flex: '0 0 auto' }}>
            或整學期回顧你標記過的：
          </span>
          {NOTE_MARKS.map((kind) => (
            <button
              key={kind}
              className={`btn sm${marks.includes(kind) ? ' primary' : ''}`}
              style={{ flex: '0 0 auto' }}
              onClick={() =>
                setMarks((prev) =>
                  prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
                )
              }
            >
              {kind}
            </button>
          ))}
          {marks.length > 0 && (
            <button
              className="btn ghost sm"
              style={{ flex: '0 0 auto' }}
              onClick={() => setMarks([])}
            >
              收起
            </button>
          )}
        </div>

        {found !== null && (
          <section className="card" style={{ marginBottom: '1.25rem' }}>
            <h2>{marks.join('、')}</h2>
            <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
              {found.length === 0
                ? '這些類型還沒有任何標記。在筆記裡選一段文字，用浮出的按鈕標一下就會出現在這裡。'
                : `${found.length} 筆，最近的一週在最前面。`}
            </p>
            <div className="stack">
              {found.map((m) => (
                <button
                  key={m.key}
                  className="list-item hit"
                  style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
                  onClick={() => navigate(`/session/${m.sessionId}`)}
                >
                  <span className="swatch" style={{ background: m.courseColor }} />
                  <span className="grow">
                    <span className="sub">
                      {m.courseName} · {m.label}
                    </span>
                    <span className="hit-snippet">{m.text}</span>
                  </span>
                  <span className={`tag mark-${m.kind}`}>{m.kind}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {busy && <div className="notice">搜尋中…</div>}

        {!busy && hits === null && (
          <div className="empty">
            <p>
              一次搜尋所有課程的逐字稿、筆記與 PDF 文字。
              <br />
              中文沒有空白可切詞，所以是整段比對——直接打你記得的那句話就好。
            </p>
            {corpus === 0 && (
              <p className="small">
                （這台電腦上還沒有內容可以搜尋。先錄一堂課，或在某一週寫幾行筆記。）
              </p>
            )}
          </div>
        )}

        {!busy && hits !== null && (
          <>
            <p className="small muted" style={{ marginBottom: '.8rem' }}>
              找到 {hits.length} 筆{hits.length >= 200 ? '（只顯示前 200 筆）' : ''} · {elapsed} ms
            </p>
            {hits.length === 0 ? (
              <div className="empty">
                {kinds.length === 0 ? (
                  <p>
                    三種類型都關掉了，所以不會有任何結果。
                    <br />
                    上面至少打開一種：逐字稿、筆記或檔案。
                  </p>
                ) : corpus === 0 ? (
                  <p>
                    這台電腦上還沒有任何可以搜尋的內容。
                    <br />
                    搜尋找的是逐字稿、筆記與 PDF 的文字——先錄一堂課或寫幾行筆記。
                  </p>
                ) : (
                  <p>沒有找到「{query}」。試試更短的關鍵字，或換一種說法。</p>
                )}
              </div>
            ) : (
              <div className="stack">
                {hits.map((hit) => (
                  <button
                    key={hit.key}
                    className="list-item hit"
                    style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
                    onClick={() => open(hit)}
                  >
                    <span className="swatch" style={{ background: hit.courseColor }} />
                    <span className="grow">
                      <span className="sub">
                        {hit.courseName} · {hit.label}
                        {hit.seconds !== undefined && (
                          <span className="mono"> · {formatTime(hit.seconds)}</span>
                        )}
                      </span>
                      <span className="hit-snippet">
                        {hit.snippet.slice(0, hit.matchStart)}
                        <mark>
                          {hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)}
                        </mark>
                        {hit.snippet.slice(hit.matchStart + hit.matchLength)}
                      </span>
                    </span>
                    <span className="tag">{KIND_LABEL[hit.kind]}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  )
}
