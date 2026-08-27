import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdf } from '../files/pdf'

interface Props {
  file: File
  title: string
  onClose: () => void
}

export function PdfViewer({ file, title, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1.2)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setPage((p) => Math.min(pageCount, p + 1))
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPage((p) => Math.max(1, p - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pageCount])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const doc = await loadPdf(await file.arrayBuffer())
        if (cancelled) {
          await doc.destroy()
          return
        }
        docRef.current = doc
        setPageCount(doc.numPages)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      void docRef.current?.destroy()
      docRef.current = null
    }
  }, [file])

  useEffect(() => {
    const doc = docRef.current
    const canvas = canvasRef.current
    if (!doc || !canvas || pageCount === 0) return

    let cancelled = false
    void (async () => {
      const p = await doc.getPage(Math.min(page, doc.numPages))
      if (cancelled) return
      // Render at device resolution so text stays crisp on a HiDPI screen.
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const viewport = p.getViewport({ scale: scale * dpr })
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width / dpr}px`
      canvas.style.height = `${viewport.height / dpr}px`
      await p.render({ canvas, canvasContext: ctx, viewport }).promise
      p.cleanup()
    })()
    return () => {
      cancelled = true
    }
  }, [page, scale, pageCount])

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pdf-shell" role="dialog" aria-modal="true" aria-label={title}>
        <div className="pdf-bar">
          <span className="grow" style={{ fontWeight: 500 }}>
            {title}
          </span>
          <button className="btn ghost sm" onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>
            縮小
          </button>
          <span className="mono small">{Math.round(scale * 100)}%</span>
          <button className="btn ghost sm" onClick={() => setScale((s) => Math.min(3, s + 0.2))}>
            放大
          </button>
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一頁
          </button>
          <span className="mono small">
            {page} / {pageCount || '…'}
          </span>
          <button
            className="btn ghost sm"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            下一頁
          </button>
          <button className="btn sm" onClick={onClose}>
            關閉
          </button>
        </div>
        <div className="pdf-body">
          {error ? (
            <div className="notice err">開啟 PDF 失敗：{error}</div>
          ) : (
            <canvas ref={canvasRef} className="pdf-canvas" />
          )}
        </div>
      </div>
    </div>
  )
}
