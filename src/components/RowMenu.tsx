import { useEffect, useId, useRef, useState } from 'react'

export interface RowAction {
  label: string
  onSelect: () => void
  /** Red, for the one that cannot be taken back. */
  danger?: boolean
}

interface Props {
  actions: RowAction[]
  /** Names the row this menu belongs to, for anyone not looking at the screen. */
  label: string
}

/**
 * The per-row actions, behind one button.
 *
 * A term is thirty rows, and 刪除 on every one of them made a column of red
 * down the page — the most dangerous action given the most visual weight and
 * the steadiest position. 標記停課 has the same problem for the opposite
 * reason: it is used once or twice a term and sat there all fifteen weeks.
 */
export function RowMenu({ actions, label }: Props) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Claimed, so a dialog around this row does not close as well.
      e.preventDefault()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="row-menu" ref={box}>
      <button
        type="button"
        className="row-menu-btn"
        aria-label={`${label}的其他動作`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      {open && (
        <div className="row-menu-list" id={id} role="menu">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              className={`row-menu-item${a.danger ? ' is-danger' : ''}`}
              onClick={() => {
                setOpen(false)
                a.onSelect()
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
