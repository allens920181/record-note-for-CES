import { useState } from 'react'

interface Props {
  terms: string[]
  onChange: (terms: string[]) => void
  placeholder?: string
  emptyText?: string
}

/** Split on the separators a reader would actually type, and tidy up. */
function parse(text: string): string[] {
  return text
    .split(/[、,;；\n]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * A course's proper nouns, one chip each.
 *
 * This was a textarea holding one 、-delimited string, remounted via `key`
 * whenever the saved list changed — so a term learned from a transcript
 * correction while you were typing threw away what you had written. Chips have
 * no such conflict: the list is data, the input holds only the next word.
 */
export function GlossaryChips({
  terms,
  onChange,
  placeholder = '加爾文、巴特、chesed…',
  emptyText = '還沒有任何詞。',
}: Props) {
  const [draft, setDraft] = useState('')

  function commit(text: string) {
    const wanted = parse(text)
    if (wanted.length === 0) return
    // Case-insensitive, so 'Chesed' does not join 'chesed' in the prompt.
    const seen = new Set(terms.map((t) => t.toLowerCase()))
    const added = wanted.filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    setDraft('')
    if (added.length > 0) onChange([...terms, ...added])
  }

  return (
    <div className="chips">
      {terms.length === 0 && <span className="small muted">{emptyText}</span>}
      {terms.map((term) => (
        <span key={term} className="chip">
          {term}
          <button
            type="button"
            className="x"
            aria-label={`移除「${term}」`}
            title={`移除「${term}」`}
            onClick={() => onChange(terms.filter((t) => t !== term))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="chip-input"
        type="text"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => {
          // Typing a separator is how people end a word in a list; treat it as
          // pressing Enter rather than letting it sit in the box.
          if (/[、,;；]/.test(e.target.value)) commit(e.target.value)
          else setDraft(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(draft)
            return
          }
          // Backspace on an empty box takes back the last chip, which is what
          // every other tag field does.
          if (e.key === 'Backspace' && draft === '' && terms.length > 0) {
            e.preventDefault()
            onChange(terms.slice(0, -1))
          }
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  )
}
