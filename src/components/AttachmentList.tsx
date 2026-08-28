import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { Attachment, AttachmentKind, AttachmentScope } from '../db/schema'
import { ATTACHMENT_KIND_LABEL } from '../db/schema'
import { addAttachment, readAttachment, removeAttachment } from '../files/attachments'
import { formatBytes } from '../lib/time'
import { PdfViewer } from './PdfViewer'
import { useConfirm } from './ConfirmProvider'

interface Props {
  scope: AttachmentScope
  ownerId: string
  courseId: string
  /** Which kinds this list offers; course pages and session pages differ. */
  kinds: AttachmentKind[]
  title: string
  hint: string
}

export function AttachmentList({ scope, ownerId, courseId, kinds, title, hint }: Props) {
  const ask = useConfirm()
  const rows = useLiveQuery(
    () => db.attachments.where({ scope, ownerId }).sortBy('createdAt'),
    [scope, ownerId],
  )
  const [kind, setKind] = useState<AttachmentKind>(kinds[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<{ file: File; title: string } | null>(null)

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        await addAttachment({ scope, ownerId, courseId, kind, file })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

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
    // Anything that isn't a PDF opens in whatever the browser can handle.
    const url = URL.createObjectURL(file)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <section className="card" style={{ marginBottom: '1.25rem' }}>
      <div className="row" style={{ alignItems: 'baseline', marginBottom: '.2rem' }}>
        <h2 className="grow">{title}</h2>
      </div>
      <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
        {hint}
      </p>

      {rows && rows.length > 0 && (
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
                    {formatBytes(row.bytes)}
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
                    body: '檔案會從你選的資料夾裡移除。如果閱讀清單有書指著它，那個連結會失效。',
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

      <div className="row" style={{ gap: '.6rem', alignItems: 'flex-end' }}>
        {kinds.length > 1 && (
          <div className="field" style={{ flex: '0 0 9rem', marginBottom: 0 }}>
            <label htmlFor={`kind-${ownerId}`}>類型</label>
            <select
              id={`kind-${ownerId}`}
              value={kind}
              onChange={(e) => setKind(e.target.value as AttachmentKind)}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {ATTACHMENT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
        )}
        <label className="btn" style={{ flex: '0 0 auto' }}>
          {busy ? '處理中…' : '上傳檔案'}
          <input
            type="file"
            multiple
            accept="application/pdf,.pdf,.doc,.docx,.txt,.md,image/*"
            style={{ display: 'none' }}
            disabled={busy}
            onChange={(e) => {
              void upload(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {error && (
        <div className="notice err" style={{ marginTop: '.8rem' }}>
          {error}
        </div>
      )}

      {viewing && (
        <PdfViewer
          file={viewing.file}
          title={viewing.title}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  )
}
