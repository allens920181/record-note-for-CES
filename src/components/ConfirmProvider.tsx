import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Modal } from './Modal'

export interface ConfirmRequest {
  title: string
  /** What happens. For a destructive action, list what else goes with it. */
  body?: ReactNode
  /** Red styling and a stated "無法復原" — reserved for deletions and restores. */
  danger?: boolean
  /** The affirmative button. Says what happens, never "確定". */
  confirmLabel: string
  cancelLabel?: string
}

type Ask = (request: ConfirmRequest) => Promise<boolean>

const ConfirmContext = createContext<Ask | null>(null)

/**
 * One way to ask "are you sure".
 *
 * Ten call sites used `window.confirm` while the app had its own dialog, and
 * the weighting was upside down: the two least reversible actions — wiping the
 * database for a restore, and spending the day's remaining transcription quota
 * — got the plainest grey browser box, while adding a course got the styled
 * modal. Worse, `window.confirm` blocks the whole page and cannot say what a
 * deletion will take with it.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const ask = useCallback<Ask>((next) => {
    return new Promise<boolean>((resolve) => {
      // A second question arriving while one is open would strand the first
      // caller's promise for ever; answer it "no" and take over.
      resolver.current?.(false)
      resolver.current = resolve
      setRequest(next)
    })
  }, [])

  const settle = useCallback((ok: boolean) => {
    const resolve = resolver.current
    resolver.current = null
    setRequest(null)
    resolve?.(ok)
  }, [])

  const value = useMemo(() => ask, [ask])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request && (
        <Modal
          title={request.title}
          onClose={() => settle(false)}
          onSubmit={() => settle(true)}
          submitLabel={request.confirmLabel}
          submitDanger={request.danger}
          cancelLabel={request.cancelLabel}
        >
          {request.body && <div className="confirm-body">{request.body}</div>}
          {request.danger && <p className="confirm-final">這個動作無法復原。</p>}
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}

/**
 * Returns `ask`, which resolves true when the reader confirms.
 *
 * Falls back to `window.confirm` outside a provider so a component rendered in
 * isolation still asks rather than silently going ahead.
 */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext)
  return (
    ask ??
    ((request) =>
      Promise.resolve(window.confirm(`${request.title}${request.danger ? '\n這個動作無法復原。' : ''}`)))
  )
}
