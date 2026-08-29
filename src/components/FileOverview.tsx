import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { Attachment } from '../db/schema'
import { ATTACHMENT_KIND_LABEL } from '../db/schema'
import { addAttachment, readAttachment, removeAttachment } from '../files/attachments'
import { formatBytes } from '../lib/time'
import { PdfViewer } from './PdfViewer'
import { useConfirm } from './ConfirmProvider'

interface Props {
  courseId: string
}

/**
 * Every file this course has, wherever it came in.
 *
 * Files arrive in three ways — uploaded here, dropped on a week, or inserted
 * into a note with `/檔案` — and used to be findable only from the place they
 * were added. They are all rows in one table keyed by course, so one list can
 * hold the lot; what differs is which week each belongs to.
 */
export function FileOverview({ courseId }: Props) {
  const ask = useConfirm()
  const picker = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<{ file: File; title: string } | null>(null)

  const rows = useLiveQuery(
    () => db.attachments.where('courseId').equals(courseId).sortBy('createdAt'),
    [courseId],
  )
  const sessions = useLiveQuery(
    () => db.sessions.where('courseId').equals(courseId).toArray(),
    [courseId],
  )

  const whereOf = useMemo(() => {
    const byId = new Map((sessions ?? []).map((s) => [s.id, s]))
    return (row: Attachment) => {
      if (row.scope === 'course') return '整門課'
      const s = byId.get(row.ownerId)
      return s ? `第 ${s.index} 週` : '已刪除的週次'
    }
  }, [sessions])

  async function open(row: Attachment) {
    setError(null)
    const file = await readAttachment(row)
    if (!file) {
      setError(`找不到 ${row.fileName}——資料夾可能移動過，或權限需要重新授權。`)
      return
    }
    if (row.mimeType === 'application/pdf') {
      setViewing({ file, title: row.fileName })
      return
    }
    const url = URL.createObjectURL(file)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  async function upload(files: FileList | null) {
    // Copied before anything is awaited: a FileList is live, and the caller
    // clears the input as soon as this yields — await first and the list is
    // empty by the time it is read, so the upload silently does nothing.
    const picked = files ? Array.from(files) : []
    if (picked.length === 0) return
    setBusy(true)
    setError(null)
    try {
      for (const file of picked) {
        await addAttachment({ scope: 'course', ownerId: courseId, courseId, kind: 'other', file })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && <div className="notice err">{error}</div>}

      {rows === undefined ? (
        <div className="empty">載入中…</div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>這門課還沒有任何檔案。</p>
          <p className="small muted" style={{ margin: '.5rem auto 0', maxWidth: '30rem' }}>
            教學大綱、指定書目、當週講義都可以傳這裡；在筆記裡打 <code>/檔案</code> 加的檔案
            也會出現在這份清單上。PDF 會抽出文字，跨週搜尋找得到。
          </p>
        </div>
      ) : (
        <div className="stack" style={{ marginBottom: '.9rem' }}>
          {rows.map((row) => (
            <div key={row.id} className="list-item" style={{ padding: '.6rem .9rem' }}>
              <button
                className="btn ghost grow"
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => void open(row)}
              >
                <span className="grow">
                  <span className="title">{row.fileName}</span>
                  <span className="sub">
                    {whereOf(row)} · {formatBytes(row.bytes)}
                    {row.pageCount ? ` · ${row.pageCount} 頁` : ''}
                    {row.text ? ' · 已抽出文字' : ''}
                  </span>
                </span>
              </button>
              <span className="tag">{ATTACHMENT_KIND_LABEL[row.kind]}</span>
              <button
                className="btn danger sm"
                onClick={async () => {
                  const go = await ask({
                    title: `刪除「${row.fileName}」？`,
                    danger: true,
                    confirmLabel: '刪除這個檔案',
                    body: '檔案會從你選的資料夾裡移除。筆記裡指著它的連結會失效。',
                  })
                  if (go) await removeAttachment(row.id)
                }}
              >
                刪除
              </button>
            </div>
          ))}
        </div>
      )}

      {/* The input is its own element rather than a child of the label: inside
          the dialog's form, a hidden input wrapped in a label would not take a
          file at all — the upload silently did nothing. */}
      <input
        ref={picker}
        id={`files-${courseId}`}
        type="file"
        multiple
        accept="application/pdf,.pdf,.doc,.docx,.txt,.md,image/*"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        onChange={(e) => {
          void upload(e.target.files)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        className="btn"
        style={{ flex: '0 0 auto', alignSelf: 'flex-start' }}
        disabled={busy}
        onClick={() => picker.current?.click()}
      >
        {busy ? '處理中…' : '上傳檔案'}
      </button>

      {viewing && (
        <PdfViewer file={viewing.file} title={viewing.title} onClose={() => setViewing(null)} />
      )}
    </>
  )
}
