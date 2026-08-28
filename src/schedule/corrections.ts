/**
 * Turning transcript fixes into vocabulary the model can be told about.
 *
 * Latin script gives a clean answer: the edit sits inside a word, and the word
 * is the term — chesid → chesed yields "chesed".
 *
 * Chinese does not. 加爾聞 → 加爾文 diffs to the single character 文, which is
 * useless as a glossary entry, and there is no reliable way to recover the word
 * boundary from one character. A particle-boundary heuristic was tried and
 * fails on exactly the words that matter: 經 is a particle in 已經 and a term
 * character in 釋經學; 來 likewise in 後來 and 士來馬赫.
 *
 * So Latin edits are extracted; Chinese edits are turned into a short list of
 * spans around the change for the reader to pick from. Assisted, not guessed —
 * a wrong term silently added to the glossary would teach the model the wrong
 * spelling, which is worse than asking.
 */

export interface Diff {
  /** Index where the two strings start to differ. */
  at: number
  before: string
  after: string
}

const LATIN = /[A-Za-z0-9'’\-]/
const PUNCT = /[\s，。、；：！？「」『』（）()《》〈〉—…·,.;:!?"']/
/** Longest span offered; 士來馬赫 is four, and five leaves a little room. */
const MAX_SPAN = 5

export function diffOnce(before: string, after: string): Diff | null {
  if (before === after) return null
  let head = 0
  const max = Math.min(before.length, after.length)
  while (head < max && before[head] === after[head]) head++

  let tail = 0
  while (
    tail < max - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++
  }

  return {
    at: head,
    before: before.slice(head, before.length - tail),
    after: after.slice(head, after.length - tail),
  }
}

/** Punctuation and whitespace fixes teach the model nothing. */
export function isMeaningful(diff: Diff): boolean {
  const changed = diff.after + diff.before
  return changed.length > 0 && [...changed].some((ch) => !PUNCT.test(ch))
}

export interface Suggestion {
  /** The one term to use, when it can be trusted without asking. */
  term?: string
  /** Spans to choose between, when it cannot. */
  options: string[]
  context: string
}

function contextAround(text: string, from: number, to: number): string {
  const a = Math.max(0, from - 12)
  const b = Math.min(text.length, to + 12)
  return (a > 0 ? '…' : '') + text.slice(a, b) + (b < text.length ? '…' : '')
}

/**
 * A confident term for Latin edits, or a ranked handful of spans for Chinese.
 * Returns null when the edit carries no vocabulary.
 */
export function suggestFrom(after: string, diff: Diff): Suggestion | null {
  if (!isMeaningful(diff)) return null

  const start = diff.at
  const end = diff.at + Math.max(1, diff.after.length)

  if (LATIN.test(diff.after[0] ?? '') || LATIN.test(after[start] ?? '')) {
    let from = start
    let to = end
    while (from > 0 && LATIN.test(after[from - 1])) from--
    while (to < after.length && LATIN.test(after[to])) to++
    const term = after.slice(from, to).trim()
    if (term.length > 0) {
      return { term, options: [term], context: contextAround(after, from, to) }
    }
  }

  // Every span of 2..MAX_SPAN characters that covers the change and contains no
  // punctuation. Ranked shortest-first, since terms are usually two to four
  // characters and a longer span is the rarer case.
  const seen = new Set<string>()
  const options: string[] = []
  for (let len = 2; len <= MAX_SPAN; len++) {
    for (let from = Math.max(0, end - len); from + len <= after.length && from <= start; from++) {
      const span = after.slice(from, from + len)
      if (span.length !== len) continue
      if ([...span].some((ch) => PUNCT.test(ch))) continue
      if (seen.has(span)) continue
      seen.add(span)
      options.push(span)
    }
  }
  if (options.length === 0) return null
  return { options, context: contextAround(after, Math.max(0, start - 2), end + 2) }
}

/** Key used to notice the same fix being made twice. */
export function correctionKey(diff: Diff): string {
  return `${diff.before}→${diff.after}`
}
