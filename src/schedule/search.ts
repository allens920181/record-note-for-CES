import { db } from '../db'

export type HitKind = 'transcript' | 'note' | 'file'

export interface SearchHit {
  key: string
  kind: HitKind
  courseId: string
  courseName: string
  courseColor: string
  sessionId?: string
  label: string
  /** Text around the match, already trimmed to a readable window. */
  snippet: string
  /** Where the match sits inside `snippet`, for highlighting. */
  matchStart: number
  matchLength: number
  /** Seconds into the recording, for transcript hits. */
  seconds?: number
  fileName?: string
}

export interface SearchOptions {
  /** Restrict to one course; empty means all of them. */
  courseId?: string
  kinds?: HitKind[]
  limit?: number
}

const WINDOW = 60

function snippetAround(text: string, at: number, length: number) {
  const from = Math.max(0, at - WINDOW)
  const to = Math.min(text.length, at + length + WINDOW)
  const prefix = from > 0 ? '…' : ''
  const suffix = to < text.length ? '…' : ''
  return {
    snippet: prefix + text.slice(from, to) + suffix,
    matchStart: prefix.length + (at - from),
    matchLength: length,
  }
}

/**
 * Finds a phrase across transcripts, notes and extracted PDF text.
 *
 * Substring matching rather than a tokenised index: Chinese has no spaces, so a
 * word-boundary tokeniser would treat a whole sentence as one term and only
 * ever match it whole. Searching for the exact phrase you remember hearing is
 * also what this is actually for.
 */
export async function search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
  const needle = query.trim()
  if (needle.length === 0) return []
  const lower = needle.toLowerCase()
  const limit = options.limit ?? 200
  const kinds = options.kinds ?? ['transcript', 'note', 'file']

  const courses = await db.courses.toArray()
  const wanted = options.courseId
    ? courses.filter((c) => c.id === options.courseId)
    : courses
  const courseById = new Map(wanted.map((c) => [c.id, c]))
  if (courseById.size === 0) return []

  const sessions = (await db.sessions.toArray()).filter((s) => courseById.has(s.courseId))
  const sessionById = new Map(sessions.map((s) => [s.id, s]))
  const sessionIds = new Set(sessionById.keys())

  const hits: SearchHit[] = []
  const push = (hit: SearchHit) => {
    if (hits.length < limit) hits.push(hit)
  }

  const labelFor = (sessionId: string) => {
    const s = sessionById.get(sessionId)
    if (!s) return ''
    const kind = (s.kind ?? 'lecture') === 'discussion' ? '分組討論' : '正課'
    return `第 ${s.index} 週 · ${kind}${s.topic ? ` · ${s.topic}` : ''}`
  }

  if (kinds.includes('transcript')) {
    const transcripts = await db.transcripts.toArray()
    for (const t of transcripts) {
      if (!sessionIds.has(t.sessionId)) continue
      const session = sessionById.get(t.sessionId)!
      const course = courseById.get(session.courseId)!
      for (let i = 0; i < t.segments.length; i++) {
        const seg = t.segments[i]
        const at = seg.text.toLowerCase().indexOf(lower)
        if (at === -1) continue
        push({
          key: `t:${t.id}:${i}`,
          kind: 'transcript',
          courseId: course.id,
          courseName: course.name,
          courseColor: course.color,
          sessionId: session.id,
          label: labelFor(session.id),
          ...snippetAround(seg.text, at, needle.length),
          seconds: seg.start,
        })
        if (hits.length >= limit) return hits
      }
    }
  }

  if (kinds.includes('note')) {
    const notes = await db.notes.toArray()
    for (const note of notes) {
      if (!sessionIds.has(note.sessionId)) continue
      const session = sessionById.get(note.sessionId)!
      const course = courseById.get(session.courseId)!
      const haystack = note.markdown.toLowerCase()
      let from = 0
      let at = haystack.indexOf(lower, from)
      let n = 0
      while (at !== -1 && n < 5) {
        push({
          key: `n:${note.id}:${at}`,
          kind: 'note',
          courseId: course.id,
          courseName: course.name,
          courseColor: course.color,
          sessionId: session.id,
          label: labelFor(session.id),
          ...snippetAround(note.markdown, at, needle.length),
        })
        if (hits.length >= limit) return hits
        from = at + needle.length
        at = haystack.indexOf(lower, from)
        n++
      }
    }
  }

  if (kinds.includes('file')) {
    const attachments = await db.attachments.toArray()
    for (const file of attachments) {
      if (!file.text || !courseById.has(file.courseId)) continue
      const course = courseById.get(file.courseId)!
      const at = file.text.toLowerCase().indexOf(lower)
      if (at === -1) continue
      push({
        key: `f:${file.id}`,
        kind: 'file',
        courseId: course.id,
        courseName: course.name,
        courseColor: course.color,
        sessionId: file.scope === 'session' ? file.ownerId : undefined,
        label: file.fileName,
        fileName: file.fileName,
        ...snippetAround(file.text, at, needle.length),
      })
      if (hits.length >= limit) return hits
    }
  }

  return hits
}
