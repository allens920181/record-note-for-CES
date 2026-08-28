/**
 * 標記 — the three things worth flagging in a lecture note.
 *
 * Stored as Obsidian callout syntax (`> [!重點] …`) rather than a field in the
 * database: notes are markdown, and a mark that only exists in this app would
 * vanish the moment the note is exported to an Obsidian vault — which is where
 * these notes are meant to end up.
 */
export const NOTE_MARKS = ['重點', '疑問', '考點'] as const
export type NoteMark = (typeof NOTE_MARKS)[number]

export const MARK_HINT: Record<NoteMark, string> = {
  重點: '教授強調的、會反覆出現的',
  疑問: '當下沒聽懂，之後要查或要問',
  考點: '明講或暗示會考的',
}

/** Matches the opening line of a callout, capturing its type and first words. */
export const MARK_LINE = /^>\s*\[!(重點|疑問|考點)\]\s*(.*)$/

export function markOf(line: string): NoteMark | null {
  const m = MARK_LINE.exec(line)
  return m ? (m[1] as NoteMark) : null
}

export interface CollectedMark {
  kind: NoteMark
  /** The callout's text, with the `>` and `[!…]` stripped off. */
  text: string
  /** 0-based line where the callout starts, so a caller can jump to it. */
  line: number
}

/**
 * Pulls every mark out of a note.
 *
 * A callout runs until the first line that is not a quote line, so a mark can
 * be several lines long without the reader having to think about it.
 */
export function collectMarks(markdown: string): CollectedMark[] {
  const lines = markdown.split('\n')
  const out: CollectedMark[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = MARK_LINE.exec(lines[i])
    if (!m) continue
    const body = [m[2]]
    for (let j = i + 1; j < lines.length; j++) {
      const cont = /^>\s?(.*)$/.exec(lines[j])
      // A second `[!…]` starts a new mark rather than continuing this one.
      if (!cont || MARK_LINE.test(lines[j])) break
      body.push(cont[1])
    }
    out.push({
      kind: m[1] as NoteMark,
      text: body.join('\n').trim(),
      line: i,
    })
  }
  return out
}
