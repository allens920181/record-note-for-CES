interface Props {
  done: number
  total: number
  /** Hours the unfinished items still need. */
  hoursLeft?: number
  /** Prefix, where the chip sits among others it must be told apart from. */
  label?: string
  /** Shown instead of "0 / 0" when nothing has been planned yet. */
  emptyLabel?: string
  /** Overrides the default tone, which is 'ok' once everything is ticked. */
  tone?: 'ok' | 'warn' | 'err'
  title?: string
}

/**
 * How far through a list of small things you are.
 *
 * The app said this three ways — `3 / 5`, `3 / 5 · 還要 2 小時`, and
 * `進度 3/5 · 2h` — with different spacing and different words for the same
 * hours, on three screens that a reader moves between constantly.
 */
export function ProgressTag({ done, total, hoursLeft = 0, label, emptyLabel, tone, title }: Props) {
  const cls = tone ?? (total > 0 && done === total ? 'ok' : null)
  if (total === 0 && emptyLabel) {
    return (
      <span className={`tag${cls ? ` ${cls}` : ''}`} title={title}>
        {emptyLabel}
      </span>
    )
  }
  return (
    <span className={`tag${cls ? ` ${cls}` : ''}`} title={title}>
      {label ? `${label} ` : ''}
      {done} / {total}
      {hoursLeft > 0 ? ` · 還要 ${hoursLeft}h` : ''}
    </span>
  )
}
