import { useEffect } from 'react'
import type { ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  onSubmit?: () => void
  submitLabel?: string
  submitDisabled?: boolean
  /** Red affirmative button, for deletions and anything else unrecoverable. */
  submitDanger?: boolean
  cancelLabel?: string
  /** For dialogs holding a table rather than a column of fields. */
  wide?: boolean
  children: ReactNode
}

export function Modal({
  title,
  onClose,
  onSubmit,
  submitLabel,
  submitDisabled,
  submitDanger,
  cancelLabel,
  wide,
  children,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
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
              {cancelLabel ?? '取消'}
            </button>
            {onSubmit && (
              <button
                type="submit"
                className={`btn ${submitDanger ? 'danger-solid' : 'primary'}`}
                disabled={submitDisabled}
                autoFocus={!submitDanger}
              >
                {submitLabel ?? '確定'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
