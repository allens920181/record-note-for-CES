import { useEffect } from 'react'
import type { ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  onSubmit?: () => void
  submitLabel?: string
  submitDisabled?: boolean
  children: ReactNode
}

export function Modal({ title, onClose, onSubmit, submitLabel, submitDisabled, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit?.()
          }}
        >
          {children}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              取消
            </button>
            {onSubmit && (
              <button type="submit" className="btn primary" disabled={submitDisabled}>
                {submitLabel ?? '確定'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
