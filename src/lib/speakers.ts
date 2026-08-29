import type { TranscriptSegment } from '../db/schema'
import { TURN_GAP_SECONDS } from '../db/schema'

/**
 * Who is speaking on each line.
 *
 * A `speaker` on a segment marks where a turn begins; it runs on until the next
 * one. So this fills forward, and answers `null` for the lines before anyone has
 * been named — a transcript nobody has marked up yet reads as it always did.
 */
export function speakersOf(segments: TranscriptSegment[]): (string | null)[] {
  let current: string | null = null
  return segments.map((seg) => {
    if (seg.speaker) current = seg.speaker
    return current
  })
}

/** The names actually used in a transcript, in the order they first speak. */
export function speakersIn(segments: TranscriptSegment[]): string[] {
  const seen: string[] = []
  for (const seg of segments) {
    if (seg.speaker && !seen.includes(seg.speaker)) seen.push(seg.speaker)
  }
  return seen
}

/**
 * Lines where a silence suggests someone else may have started talking.
 *
 * A hint, never a mark: a pause is also what happens when a lecturer looks for
 * a page. It is here so a three-hour class takes a few clicks instead of two
 * hundred — the gaps are where the turns usually are.
 */
export function looksLikeTurn(segments: TranscriptSegment[], i: number): boolean {
  if (i === 0) return true
  const before = segments[i - 1]
  const here = segments[i]
  if (!before || !here) return false
  return here.start - before.end >= TURN_GAP_SECONDS
}
