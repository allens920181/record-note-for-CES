import { minutesOf } from '../lib/dates'

interface Props {
  id?: string
  value: string
  onChange: (value: string) => void
  /** Rendered above the input; omit when the caller supplies its own label. */
  label?: string
  /** Allow clearing — a deadline may have no time of day, a class slot may not. */
  allowEmpty?: boolean
  style?: React.CSSProperties
}

/**
 * A time of day, as `HH:MM`.
 *
 * `<input type="time">` rather than free text, because every consumer of these
 * values parses them with a strict `^(\d{1,2}):(\d{2})$` and silently returns 0
 * or null otherwise. Typing "7:00 PM" used to pass validation, show a green
 * success message, and then quietly drop the meeting into the calendar's
 * "unscheduled" row or make a whole term's study hours add up to zero — which
 * surfaces much later as "需 6h ／ 有 0h" with no way to trace it back.
 *
 * No am/pm normaliser: the browser's own control cannot produce an invalid
 * value, so that layer would exist only to rescue a problem that no longer
 * happens. The one case still worth handling is a value already in the database
 * that predates this field — `type="time"` renders those as blank and swallows
 * the original, so they fall back to text with the value visible.
 */
export function TimeField({ id, value, onChange, label, allowEmpty = false, style }: Props) {
  const unreadable = value !== '' && minutesOf(value) === null

  const input = unreadable ? (
    <>
      <input
        id={id}
        type="text"
        className="is-bad"
        value={value}
        aria-invalid="true"
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="hint" style={{ color: 'var(--danger)' }}>
        這個時間讀不懂，請改成 19:00 這種寫法。
      </div>
    </>
  ) : (
    <input
      id={id}
      type="time"
      value={value}
      required={!allowEmpty}
      onChange={(e) => onChange(e.target.value)}
    />
  )

  if (!label) return input
  return (
    <div className="field" style={{ marginBottom: 0, ...style }}>
      <label htmlFor={id}>{label}</label>
      {input}
    </div>
  )
}
