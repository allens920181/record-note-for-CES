/**
 * One view over vocabulary that is stored in several places.
 *
 * A term can live in the global list (sent with every transcription) or in one
 * course's list (sent only with that course's). Both are real: 加爾文 belongs
 * everywhere, but a lecturer's name belongs to one class. What was missing was
 * a place to see them together — with seven courses a term you would otherwise
 * have to open seven pages to find out whether 士來馬赫 is already known.
 */

import { db, getSettings, saveSettings } from '../db'

export interface CourseUse {
  courseId: string
  courseName: string
  termId: string
  termName: string
  color: string
}

export interface GlossaryEntry {
  term: string
  /** In the global list, so every course's transcription gets it. */
  isGlobal: boolean
  /** Courses whose own list carries it. */
  courses: CourseUse[]
  /** Arrived by resolving a transcript correction rather than being typed. */
  learned: boolean
}

export interface GlossaryView {
  entries: GlossaryEntry[]
  /** Terms in two or more courses — the ones worth making global. */
  suggestions: GlossaryEntry[]
  courses: CourseUse[]
  totalCourses: number
}

/** Collation that puts Latin before Chinese and sorts each sensibly. */
const collator = new Intl.Collator(['en', 'zh-Hant'], { sensitivity: 'base' })

export async function buildGlossaryView(termId?: string): Promise<GlossaryView> {
  const [settings, allTerms, allCourses, corrections] = await Promise.all([
    getSettings(),
    db.terms.toArray(),
    db.courses.toArray(),
    db.corrections.filter((c) => Boolean(c.resolvedTerm)).toArray(),
  ])

  const termName = new Map(allTerms.map((t) => [t.id, t.name]))
  const scoped = termId ? allCourses.filter((c) => c.termId === termId) : allCourses
  const courses: CourseUse[] = scoped
    .map((c) => ({
      courseId: c.id,
      courseName: c.name,
      termId: c.termId,
      termName: termName.get(c.termId) ?? '（已刪除的學期）',
      color: c.color,
    }))
    .sort((a, b) => collator.compare(a.courseName, b.courseName))

  const learnedTerms = new Set(corrections.map((c) => c.resolvedTerm as string))

  const byTerm = new Map<string, GlossaryEntry>()
  const entryFor = (term: string): GlossaryEntry => {
    let entry = byTerm.get(term)
    if (!entry) {
      entry = { term, isGlobal: false, courses: [], learned: learnedTerms.has(term) }
      byTerm.set(term, entry)
    }
    return entry
  }

  // The global list is not scoped to a term: it applies to every course there
  // is, so filtering it by semester would hide terms that are in play.
  for (const term of settings.globalGlossary) entryFor(term).isGlobal = true
  for (const course of scoped) {
    const use = courses.find((c) => c.courseId === course.id)
    if (!use) continue
    for (const term of course.glossary) entryFor(term).courses.push(use)
  }

  const entries = [...byTerm.values()].sort((a, b) => {
    // Global first, then the widely shared, then alphabetically.
    if (a.isGlobal !== b.isGlobal) return a.isGlobal ? -1 : 1
    if (a.courses.length !== b.courses.length) return b.courses.length - a.courses.length
    return collator.compare(a.term, b.term)
  })

  return {
    entries,
    suggestions: entries.filter((e) => !e.isGlobal && e.courses.length >= 2),
    courses,
    totalCourses: allCourses.length,
  }
}

/**
 * Moves a term into the global list and takes it out of every course's.
 * Leaving the copies behind would work — the prompt merges and dedupes — but
 * the term would then show as both global and per-course, which reads as a
 * disagreement rather than one fact.
 */
export async function promoteToGlobal(term: string): Promise<void> {
  const settings = await getSettings()
  if (!settings.globalGlossary.includes(term)) {
    await saveSettings({ globalGlossary: [...settings.globalGlossary, term] })
  }
  const courses = await db.courses.toArray()
  await Promise.all(
    courses
      .filter((c) => c.glossary.includes(term))
      .map((c) => db.courses.update(c.id, { glossary: c.glossary.filter((t) => t !== term) })),
  )
}

/**
 * Takes a term out of the global list. It is handed back to the courses named,
 * so demoting is not the same as deleting — the usual reason to demote is that
 * the term only ever mattered to one class.
 */
export async function demoteToCourses(term: string, courseIds: string[]): Promise<void> {
  const settings = await getSettings()
  await saveSettings({ globalGlossary: settings.globalGlossary.filter((t) => t !== term) })
  await Promise.all(courseIds.map((id) => addToCourse(term, id)))
}

export async function addToCourse(term: string, courseId: string): Promise<void> {
  const course = await db.courses.get(courseId)
  if (!course || course.glossary.includes(term)) return
  await db.courses.update(courseId, { glossary: [...course.glossary, term] })
}

export async function removeFromCourse(term: string, courseId: string): Promise<void> {
  const course = await db.courses.get(courseId)
  if (!course) return
  await db.courses.update(courseId, { glossary: course.glossary.filter((t) => t !== term) })
}

export async function addToGlobal(term: string): Promise<void> {
  const clean = term.trim()
  if (!clean) return
  const settings = await getSettings()
  if (settings.globalGlossary.includes(clean)) return
  await saveSettings({ globalGlossary: [...settings.globalGlossary, clean] })
}

/** Removes a term everywhere it appears. */
export async function deleteEverywhere(term: string): Promise<void> {
  const settings = await getSettings()
  if (settings.globalGlossary.includes(term)) {
    await saveSettings({ globalGlossary: settings.globalGlossary.filter((t) => t !== term) })
  }
  const courses = await db.courses.toArray()
  await Promise.all(
    courses
      .filter((c) => c.glossary.includes(term))
      .map((c) => db.courses.update(c.id, { glossary: c.glossary.filter((t) => t !== term) })),
  )
}

/**
 * Renames a term wherever it appears. The reason this exists is that a wrong
 * term can be learned automatically from a correction, and hunting it down
 * across seven courses to fix one character is exactly the chore this page is
 * meant to remove.
 */
export async function renameEverywhere(from: string, to: string): Promise<void> {
  const clean = to.trim()
  if (!clean || clean === from) return
  const settings = await getSettings()
  if (settings.globalGlossary.includes(from)) {
    const next = settings.globalGlossary.filter((t) => t !== from)
    if (!next.includes(clean)) next.push(clean)
    await saveSettings({ globalGlossary: next })
  }
  const courses = await db.courses.toArray()
  await Promise.all(
    courses
      .filter((c) => c.glossary.includes(from))
      .map((c) => {
        const next = c.glossary.filter((t) => t !== from)
        if (!next.includes(clean)) next.push(clean)
        return db.courses.update(c.id, { glossary: next })
      }),
  )
  // Keep the correction history pointing at the corrected spelling, so the
  // "learned from your fixes" mark follows the rename instead of going stale.
  const learned = await db.corrections.filter((c) => c.resolvedTerm === from).toArray()
  await Promise.all(learned.map((c) => db.corrections.update(c.id, { resolvedTerm: clean })))
}

/** The whole vocabulary as one pasteable list. */
export function asPlainList(entries: GlossaryEntry[]): string {
  return entries.map((e) => e.term).join('、')
}
