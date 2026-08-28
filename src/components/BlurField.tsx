import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

interface Props {
  value: string
  /** Called when the field is left, or Enter is pressed — not per keystroke. */
  onCommit: (value: string) => void
  id?: string
  type?: 'text' | 'number'
  placeholder?: string
  min?: number
  step?: number
  style?: CSSProperties
  className?: string
  'aria-label'?: string
}

/**
 * A box that saves when you leave it.
 *
 * A controlled field writing on every keystroke turns "120" into three
 * database writes and three re-renders of everything watching that row, and
 * a half-typed number is briefly the stored truth. `defaultValue` would fix
 * that but goes stale when the row changes from elsewhere — and in a list
 * keyed by index, when a row above is removed. So: local state, synced from
 * the prop only while nobody is typing into it.
 */
export function BlurField({ value, onCommit, type = 'text', ...rest }: Props) {
  const [text, setText] = useState(value)
  const editing = useRef(false)
  const abandoned = useRef(false)

  useEffect(() => {
    if (!editing.current) setText(value)
  }, [value])

  return (
    <input
      {...rest}
      type={type}
      value={text}
      onFocus={() => {
        editing.current = true
        abandoned.current = false
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => {
        editing.current = false
        // Escape blurs to get out of the field; committing what it just threw
        // away would make the undo write the very thing it undid.
        if (abandoned.current) {
          abandoned.current = false
          setText(value)
          return
        }
        onCommit(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        // Escape puts back what was stored, which is the only undo a field has.
        if (e.key === 'Escape') {
          abandoned.current = true
          setText(value)
          e.currentTarget.blur()
        }
      }}
    />
  )
}
