/**
 * What goes in the request's `prompt`, and how to recognise it coming back.
 *
 * Whisper does not take instructions. It takes text, treats it as what was said
 * just before the audio, and carries on — which is why a vocabulary list in the
 * prompt improves how those words are spelled, and why a sentence in 繁體 nudges
 * the output into 繁體.
 *
 * It is also why the prompt sometimes turns up *in* the transcript. The model is
 * continuing a passage, and a passage can be continued by repeating it: given
 * silence, a poor microphone, or a chunk that begins mid-breath, writing our own
 * sentence back out is a perfectly reasonable guess at what comes next. No flag
 * turns this off — the leak is the same mechanism as the benefit — so it is
 * caught on the way back instead, which is what `stripPromptEcho` is for.
 *
 * That catching only works because the prompt contains sentences nobody says out
 * loud. The vocabulary is no use for it: 加爾文 in a transcript is almost
 * certainly the lecturer saying 加爾文. The boilerplate around it is the tell.
 */

/** Prepended context, in the script we want back. */
const TRADITIONAL_HINT = '以下是一段課堂錄音的繁體中文逐字稿。'

const GLOSSARY_LEAD = '以下為本課程可能出現的專有名詞：'

/**
 * The endpoint keeps only the *last* 224 tokens of a prompt and silently drops
 * the rest. Chinese runs close to one token per character, so this is the honest
 * ceiling on what is worth sending — anything past it was never read, and a
 * reader whose glossary has grown past it deserves to have the trim happen
 * where it can be reasoned about rather than inside someone else's server.
 */
const BUDGET = 200

/** Enough shared characters to be a quotation rather than a coincidence. */
const MIN_RUN = 8

export interface Prompt {
  /** The string sent to the API. */
  text: string
  /** Phrases a lecturer never says, normalised — the evidence of an echo. */
  marks: string[]
  /** The vocabulary, normalised, for recognising an echoed term list. */
  terms: string[]
}

/** Letters, digits and Han only: punctuation and spacing vary with every retelling. */
function normalise(text: string): { norm: string; at: number[] } {
  let norm = ''
  const at: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (/[\p{L}\p{N}]/u.test(c)) {
      norm += c.toLowerCase()
      at.push(i)
    }
  }
  return { norm, at }
}

const flatten = (text: string) => normalise(text).norm

/**
 * Builds the prompt for one course.
 *
 * The course's own terms go before the global ones, because the trim below eats
 * from the end: when a reader has more vocabulary than fits, the words belonging
 * to the lecture actually being transcribed are the ones worth keeping.
 *
 * The hint goes last for the same reason the budget exists. It is the piece
 * nearest the audio, and the piece we would least like silently truncated away.
 */
export function buildPrompt(
  courseTerms: string[],
  globalTerms: string[],
  language: string,
): Prompt {
  // Only where the audio is known to be Chinese. Under auto-detect, a Chinese
  // sentence in front of an English lecture is a thumb on the scale of the very
  // thing being detected — and every transcript is converted afterwards anyway.
  const hint = language === 'zh' ? TRADITIONAL_HINT : ''
  const all = [...new Set([...courseTerms, ...globalTerms])].filter(Boolean)

  const room = BUDGET - hint.length - GLOSSARY_LEAD.length
  const kept: string[] = []
  let used = 0
  for (const term of all) {
    if (used + term.length + 1 > room) break
    kept.push(term)
    used += term.length + 1
  }

  const glossary = kept.length > 0 ? `${GLOSSARY_LEAD}${kept.join('、')}。` : ''
  return {
    text: `${glossary}${hint}`,
    marks: [glossary ? GLOSSARY_LEAD : '', hint].filter(Boolean).map(flatten),
    terms: all.map(flatten).filter(Boolean),
  }
}

/**
 * Removes the prompt from a line the model wrote it into, and returns '' when
 * the line was nothing else.
 *
 * A line is only touched once it quotes one of the giveaway phrases. Without
 * that, no amount of overlap with the vocabulary counts, because the vocabulary
 * is what the lecture is about. Once a line is known to be an echo, what else it
 * holds is looked at properly: the model does sometimes read the prompt out and
 * then get on with the lecture in the same breath, and that second half is real.
 */
export function stripPromptEcho(text: string, prompt: Prompt): string {
  if (prompt.marks.length === 0) return text
  const { norm, at } = normalise(text)
  if (norm.length < MIN_RUN) return text

  // Normalised text holds no spaces, so no run can straddle two phrases.
  const hay = prompt.marks.join(' ')
  const cuts: Array<[number, number]> = []
  for (let i = 0; i < norm.length; ) {
    let run = 0
    while (i + run < norm.length && hay.includes(norm.slice(i, i + run + 1))) run++
    if (run >= MIN_RUN) {
      cuts.push([at[i], at[i + run - 1] + 1])
      i += run
    } else {
      i++
    }
  }
  if (cuts.length === 0) return text

  let rest = ''
  let from = 0
  for (const [start, end] of cuts) {
    rest += text.slice(from, start)
    from = end
  }
  rest += text.slice(from)

  // What is left of an echoed prompt is the term list it introduced. Peel the
  // vocabulary off; if the line disappears, there was no speech in it to keep.
  let residue = flatten(rest)
  let peeled = true
  while (peeled && residue.length > 0) {
    peeled = false
    for (const term of prompt.terms) {
      if (residue.startsWith(term)) {
        residue = residue.slice(term.length)
        peeled = true
        break
      }
    }
  }
  if (residue.length === 0) return ''

  // Only the punctuation orphaned by the cut goes: a leading 。 that used to end
  // the prompt, a 、 left dangling. A full stop at the end is the sentence's own.
  return rest.replace(/^[\s\p{P}]+/u, '').replace(/[\s、，,;:：]+$/u, '')
}
