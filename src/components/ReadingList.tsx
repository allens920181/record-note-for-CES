import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createReading, db, deleteReading, updateReading } from '../db'
import type { Reading } from '../db'
import type { Attachment } from '../db/schema'
import { READING_STATUS_LABEL } from '../db/schema'
import type { ReadingStatus } from '../db/schema'
import { addAttachment, readAttachment, removeAttachment } from '../files/attachments'
import { formatBytes } from '../lib/time'
import { PdfViewer } from './PdfViewer'

interface Props {
  courseId: string
}

export function ReadingList({ courseId }: Props) {
  const readings = useLiveQuery(
    () => db.readings.where('courseId').equals(courseId).sortBy('createdAt'),
    [courseId],
  )
  const sessions = useLiveQuery(async () => {
    const list = await db.sessions.where('courseId').equals(courseId).toArray()
    return list.sort((a, b) => a.date.localeCompare(b.date))
  }, [courseId])

  const [title, setTitle] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<{ file: File; title: string } | null>(null)

  // Files already on this course, so a book uploaded once under 課程檔案 can be
  // pointed at rather than uploaded a second time.
  const courseFiles = useLiveQuery(
    async () =>
      (await db.attachments.where({ scope: 'course', ownerId: courseId }).toArray()).sort((a, b) =>
        a.fileName.localeCompare(b.fileName),
      ),
    [courseId],
  )

  async function uploadFor(reading: Reading, file: File) {
    setBusy(reading.id)
    setError(null)
    try {
      const attachmentId = await addAttachment({
        scope: 'course',
        ownerId: courseId,
        courseId,
        kind: 'reading',
        file,
      })
      await updateReading(reading.id, { attachmentId })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function openFile(attachmentId: string) {
    setError(null)
    const row = await db.attachments.get(attachmentId)
    if (!row) {
      setError('這個檔案的紀錄不見了，可能在「課程檔案」被刪掉了。')
      return
    }
    const file = await readAttachment(row)
    if (!file) {
      setError(`找不到 ${row.fileName}——資料夾可能移動過，或權限需要重新授權。`)
      return
    }
    if (row.mimeType === 'application/pdf') {
      setViewing({ file, title: row.fileName })
      return
    }
    // epub, mobi, a scanned jpg — hand it to whatever the browser can do.
    const url = URL.createObjectURL(file)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  async function add() {
    const t = title.trim()
    if (!t) return
    const id = await createReading({ courseId, title: t })
    setTitle('')
    setOpen(id)
  }

  function progressOf(r: Reading): number | null {
    if (!r.totalPages || r.totalPages <= 0) return null
    return Math.min(100, Math.round(((r.pagesRead ?? 0) / r.totalPages) * 100))
  }

  return (
    <section className="card" style={{ marginBottom: '1.25rem' }}>
      <h2>閱讀材料</h2>
      <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
        指定書目與進度。可以對應到某一週，之後在那週的工作區就知道該讀什麼。
      </p>

      {error && (
        <div className="notice err" style={{ marginBottom: '.9rem' }}>
          {error}
        </div>
      )}

      {viewing && (
        <PdfViewer file={viewing.file} title={viewing.title} onClose={() => setViewing(null)} />
      )}

      {readings && readings.length > 0 && (
        <div className="stack" style={{ marginBottom: '.9rem' }}>
          {readings.map((r) => {
            const pct = progressOf(r)
            return (
              <div key={r.id} className="card" style={{ padding: '.8rem 1rem', boxShadow: 'none' }}>
                <div
                  className="row"
                  style={{ gap: '.6rem', alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                >
                  <div className="grow">
                    <div className="title">{r.title}</div>
                    <div className="sub">
                      {[r.author, r.chapters].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  {pct !== null && (
                    <span className="tag mono">
                      {r.pagesRead ?? 0}/{r.totalPages} 頁 · {pct}%
                    </span>
                  )}
                  {r.attachmentId && (
                    <button
                      className="btn sm"
                      style={{ flex: '0 0 auto' }}
                      title="開啟電子檔"
                      onClick={(e) => {
                        e.stopPropagation()
                        void openFile(r.attachmentId!)
                      }}
                    >
                      開啟電子檔
                    </button>
                  )}
                  <span className={`tag${r.status === 'read' ? ' ok' : ''}`}>
                    {READING_STATUS_LABEL[r.status]}
                  </span>
                  <button className="btn ghost sm" style={{ flex: '0 0 auto' }}>
                    {open === r.id ? '收合' : '展開'}
                  </button>
                </div>

                {pct !== null && (
                  <div className="progress" style={{ marginTop: '.5rem' }}>
                    <div style={{ width: `${pct}%` }} />
                  </div>
                )}

                {open === r.id && (
                  <div style={{ marginTop: '.9rem' }}>
                    <div className="row">
                      <div className="field">
                        <label htmlFor={`rt-${r.id}`}>書名／篇名</label>
                        <input
                          id={`rt-${r.id}`}
                          type="text"
                          defaultValue={r.title}
                          onBlur={(e) => void updateReading(r.id, { title: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`ra-${r.id}`}>作者</label>
                        <input
                          id={`ra-${r.id}`}
                          type="text"
                          defaultValue={r.author ?? ''}
                          onBlur={(e) => void updateReading(r.id, { author: e.target.value })}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`rc-${r.id}`}>章節</label>
                        <input
                          id={`rc-${r.id}`}
                          type="text"
                          placeholder="第三卷 21–24 章"
                          defaultValue={r.chapters ?? ''}
                          onBlur={(e) => void updateReading(r.id, { chapters: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="row">
                      <div className="field">
                        <label htmlFor={`rs-${r.id}`}>狀態</label>
                        <select
                          id={`rs-${r.id}`}
                          value={r.status}
                          onChange={(e) =>
                            void updateReading(r.id, { status: e.target.value as ReadingStatus })
                          }
                        >
                          {(Object.keys(READING_STATUS_LABEL) as ReadingStatus[]).map((k) => (
                            <option key={k} value={k}>
                              {READING_STATUS_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`rp-${r.id}`}>讀到第幾頁</label>
                        <input
                          id={`rp-${r.id}`}
                          type="number"
                          min={0}
                          value={r.pagesRead ?? ''}
                          onChange={(e) =>
                            void updateReading(r.id, {
                              pagesRead: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`rn-${r.id}`}>總頁數</label>
                        <input
                          id={`rn-${r.id}`}
                          type="number"
                          min={0}
                          value={r.totalPages ?? ''}
                          onChange={(e) =>
                            void updateReading(r.id, {
                              totalPages: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`rw-${r.id}`}>對應週次</label>
                        <select
                          id={`rw-${r.id}`}
                          value={r.sessionId ?? ''}
                          onChange={(e) =>
                            void updateReading(r.id, { sessionId: e.target.value || undefined })
                          }
                        >
                          <option value="">不指定</option>
                          {(sessions ?? []).map((s) => (
                            <option key={s.id} value={s.id}>
                              第 {s.index} 週 · {s.date}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="field">
                      <label>電子檔</label>
                      <ReadingFile
                        reading={r}
                        files={courseFiles ?? []}
                        busy={busy === r.id}
                        onUpload={(file) => void uploadFor(r, file)}
                        onPick={(id) => void updateReading(r.id, { attachmentId: id || undefined })}
                        onOpen={() => r.attachmentId && void openFile(r.attachmentId)}
                        onRemove={async () => {
                          if (!r.attachmentId) return
                          if (!confirm('刪除這本書的電子檔？檔案會從資料夾移除，無法復原。')) return
                          const id = r.attachmentId
                          await updateReading(r.id, { attachmentId: undefined })
                          await removeAttachment(id)
                        }}
                      />
                      <div className="hint">
                        傳一份 PDF 上來，之後在這裡就能直接讀；PDF 的文字也會進跨週搜尋。
                        已經傳到「課程檔案」的也可以直接挑。
                      </div>
                    </div>

                    <div className="field">
                      <label htmlFor={`rnotes-${r.id}`}>讀書筆記</label>
                      <textarea
                        id={`rnotes-${r.id}`}
                        rows={3}
                        defaultValue={r.notes}
                        onBlur={(e) => void updateReading(r.id, { notes: e.target.value })}
                      />
                    </div>

                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="btn danger sm"
                        style={{ flex: '0 0 auto' }}
                        onClick={async () => {
                          if (confirm(`刪除「${r.title}」？`)) await deleteReading(r.id)
                        }}
                      >
                        刪除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="row" style={{ gap: '.5rem' }}>
        <input
          type="text"
          className="grow"
          placeholder="加入一本書或一篇文章"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && title.trim()) {
              e.preventDefault()
              void add()
            }
          }}
        />
        <button className="btn" style={{ flex: '0 0 auto' }} disabled={!title.trim()} onClick={add}>
          加入
        </button>
      </div>
    </section>
  )
}

interface FileProps {
  reading: Reading
  files: Attachment[]
  busy: boolean
  onUpload: (file: File) => void
  onPick: (attachmentId: string) => void
  onOpen: () => void
  onRemove: () => void
}

/**
 * The e-copy of one book: upload a new file, or point at one already on the
 * course. Pointing rather than re-uploading matters because a scanned volume is
 * often 80 MB and the same file frequently serves several weeks' readings.
 */
function ReadingFile({ reading, files, busy, onUpload, onPick, onOpen, onRemove }: FileProps) {
  const current = files.find((f) => f.id === reading.attachmentId)

  if (reading.attachmentId && !current) {
    return (
      <div className="notice warn">
        指到的檔案已經不在了（可能在「課程檔案」被刪掉）。
        <button className="btn ghost sm" style={{ marginLeft: '.5rem' }} onClick={() => onPick('')}>
          清掉這個連結
        </button>
      </div>
    )
  }

  if (current) {
    return (
      <div className="row" style={{ gap: '.4rem', alignItems: 'center' }}>
        <span className="grow small mono" style={{ wordBreak: 'break-all' }}>
          {current.fileName}
          <span className="muted">
            {' · '}
            {formatBytes(current.bytes)}
            {current.pageCount ? ` · ${current.pageCount} 頁` : ''}
          </span>
        </span>
        <button className="btn sm" style={{ flex: '0 0 auto' }} onClick={onOpen}>
          開啟
        </button>
        <button className="btn ghost sm" style={{ flex: '0 0 auto' }} onClick={() => onPick('')}>
          取消連結
        </button>
        <button className="btn danger sm" style={{ flex: '0 0 auto' }} onClick={onRemove}>
          刪除檔案
        </button>
      </div>
    )
  }

  return (
    <div className="row" style={{ gap: '.4rem', alignItems: 'center' }}>
      <label className="btn" style={{ flex: '0 0 auto' }}>
        {busy ? '上傳中…' : '上傳電子檔'}
        <input
          type="file"
          accept="application/pdf,.pdf,.epub,.txt,.md,image/*"
          style={{ display: 'none' }}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) onUpload(file)
          }}
        />
      </label>
      {files.length > 0 && (
        <select
          aria-label="改用已上傳的課程檔案"
          value=""
          style={{ flex: '1 1 10rem' }}
          onChange={(e) => e.target.value && onPick(e.target.value)}
        >
          <option value="">或挑一個已上傳的課程檔案…</option>
          {files.map((f) => (
            <option key={f.id} value={f.id}>
              {f.fileName}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
