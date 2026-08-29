import { db } from '../db'
import { COURSE_KIND_LABEL, SESSION_KIND_LABEL } from '../db/schema'
import type { TranscriptSegment } from '../db/schema'
import { ASSIGNMENT_STATUS_LABEL, READING_STATUS_LABEL } from '../db/schema'
import { safeName, writeInto } from '../storage/fsRoot'
import { formatTime } from '../lib/time'
import { WEEKDAY_SHORT, weekdayOf } from '../lib/dates'

export interface ExportProgress {
  stage: string
  done: number
  total: number
}

function frontMatter(fields: Record<string, string | number | undefined>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'string' && /[:#\-]/.test(v) ? JSON.stringify(v) : v}`)
  return `---\n${lines.join('\n')}\n---\n`
}

/**
 * One part's lines, each keeping the `[hh:mm:ss]` you search for.
 *
 * Where a turn was marked, the name leads the line it starts — the same shape
 * the workspace shows, and the one an interview transcript has always had.
 */
function transcriptBody(segments: TranscriptSegment[]): string {
  return `${segments
    .map(
      (seg) =>
        `\`[${formatTime(seg.start)}]\` ${seg.speaker ? `**${seg.speaker}：** ` : ''}${seg.text}`,
    )
    .join('\n\n')}\n`
}

/**
 * Writes a term as a Markdown tree into a folder the reader chose — point it at
 * an Obsidian vault and the notes are simply there.
 *
 * Transcripts keep their timestamps as plain `[hh:mm:ss]` prefixes: the audio
 * lives in this app, so a link would dangle, but the timestamp is still what
 * you search for when you come back to listen.
 */
export async function exportTermMarkdown(
  root: FileSystemDirectoryHandle,
  termId: string,
  onProgress: (p: ExportProgress) => void,
): Promise<{ files: number }> {
  const term = await db.terms.get(termId)
  if (!term) throw new Error('找不到這個學期')

  const courses = await db.courses.where('termId').equals(termId).sortBy('createdAt')
  const termDir = safeName(term.name)
  let files = 0

  const total = courses.length
  for (let ci = 0; ci < courses.length; ci++) {
    const course = courses[ci]
    onProgress({ stage: `匯出「${course.name}」`, done: ci, total })
    const courseDir = `${termDir}/${safeName(course.name)}`

    // ── the course itself ────────────────────────────────────────────
    const slotLines = course.slots.map(
      (s) =>
        `- 週${WEEKDAY_SHORT[s.weekday]} ${s.start}–${s.end}` +
        `${s.room ? ` · ${s.room}` : ''} · ${SESSION_KIND_LABEL[s.kind ?? 'lecture']}`,
    )
    const req = course.requirements

    await writeInto(
      root,
      `${courseDir}/_課程.md`,
      frontMatter({
        title: course.name,
        teacher: course.teacher,
        code: course.code,
        credits: course.credits,
        // Same key the week files use for 正課／分組討論: what sort of thing
        // this is, in the words the reader picked.
        kind: course.kind ? COURSE_KIND_LABEL[course.kind] : undefined,
        term: term.name,
      }) +
        `\n# ${course.name}\n\n` +
        (slotLines.length ? `## 上課時段\n\n${slotLines.join('\n')}\n\n` : '') +
        (req?.rules.trim() ? `## 課堂要求\n\n${req.rules.trim()}\n\n` : '') +
        (course.glossary.length
          ? `## 專有名詞\n\n${course.glossary.map((g) => `- ${g}`).join('\n')}\n`
          : ''),
    )
    files++

    // ── assignments ──────────────────────────────────────────────────
    const assignments = await db.assignments.where('courseId').equals(course.id).sortBy('due')
    if (assignments.length > 0) {
      const body = assignments
        .map((a) => {
          const steps = a.subtasks
            .map((t) => `  - [${t.done ? 'x' : ' '}] ${t.title}${t.estimateHours ? ` （${t.estimateHours}h）` : ''}`)
            .join('\n')
          return (
            `## ${a.title}\n\n` +
            `- 截止：${a.due}${a.dueTime ? ` ${a.dueTime}` : ''}\n` +
            `- 狀態：${ASSIGNMENT_STATUS_LABEL[a.status]}\n` +
            (a.notes ? `\n${a.notes}\n` : '') +
            (steps ? `\n### 步驟\n\n${steps}\n` : '')
          )
        })
        .join('\n')
      await writeInto(root, `${courseDir}/作業.md`, `# ${course.name} · 作業\n\n${body}`)
      files++
    }

    // ── readings ─────────────────────────────────────────────────────
    const readings = await db.readings.where('courseId').equals(course.id).sortBy('createdAt')
    if (readings.length > 0) {
      // Not `files` — that name is already the running count of written files.
      const ecopies = new Map(
        (await db.attachments.where('courseId').equals(course.id).toArray()).map((a) => [
          a.id,
          a.fileName,
        ]),
      )
      const body = readings
        .map(
          (r) =>
            `## ${r.title}\n\n` +
            `- 作者：${r.author || '—'}\n` +
            `- 章節：${r.chapters || '—'}\n` +
            `- 狀態：${READING_STATUS_LABEL[r.status]}` +
            (r.totalPages ? `（${r.pagesRead ?? 0}/${r.totalPages} 頁）` : '') +
            '\n' +
            (r.attachmentId && ecopies.has(r.attachmentId)
              ? `- 電子檔：${ecopies.get(r.attachmentId)}\n`
              : '') +
            (r.notes ? `\n${r.notes}\n` : ''),
        )
        .join('\n')
      await writeInto(root, `${courseDir}/閱讀材料.md`, `# ${course.name} · 閱讀材料\n\n${body}`)
      files++
    }

    // ── one file per week ────────────────────────────────────────────
    const sessions = (await db.sessions.where('courseId').equals(course.id).toArray()).sort(
      (a, b) => a.date.localeCompare(b.date),
    )
    for (const session of sessions) {
      const kind = SESSION_KIND_LABEL[session.kind ?? 'lecture']
      // Every recording of the week, in the order they were made, each with
      // its own transcript: a week is not always one file, and the parts keep
      // their own clocks rather than being laid end to end.
      const [recordings, allTranscripts, note, plan] = await Promise.all([
        db.recordings.where('sessionId').equals(session.id).sortBy('createdAt'),
        db.transcripts.where('sessionId').equals(session.id).toArray(),
        db.notes.get(session.id),
        db.weekPlans.get(session.id),
      ])
      const parts = recordings.length
        ? recordings.map((r) => allTranscripts.find((t) => t.recordingId === r.id) ?? null)
        : // A transcript whose audio was deleted still belongs in the export.
          [allTranscripts[allTranscripts.length - 1] ?? null]
      const written = parts.filter((t): t is NonNullable<typeof t> => t !== null)
      const planLines = (plan?.items ?? []).map(
        (i) => `- [${i.done ? 'x' : ' '}] ${i.title}${i.hours ? ` （${i.hours}h）` : ''}`,
      )

      const name = `第${String(session.index).padStart(2, '0')}週 ${session.date} ${kind}`
      const body =
        frontMatter({
          title: name,
          course: course.name,
          date: session.date,
          weekday: `週${WEEKDAY_SHORT[weekdayOf(session.date)]}`,
          week: session.index,
          kind,
          topic: session.topic,
        }) +
        `\n# ${name}${session.topic ? ` · ${session.topic}` : ''}\n\n` +
        (planLines.length ? `## 本週進度\n\n${planLines.join('\n')}\n\n` : '') +
        (note?.markdown.trim() ? `## 我的筆記\n\n${note.markdown.trim()}\n\n` : '') +
        (written.length > 0
          ? `## 逐字稿\n\n${parts
              .map((t, i) =>
                t
                  ? (parts.length > 1 ? `### 第 ${i + 1} 段錄音\n\n` : '') + transcriptBody(t.segments)
                  : `### 第 ${i + 1} 段錄音\n\n（還沒轉錄）\n`,
              )
              .join('\n')}`
          : '')

      await writeInto(root, `${courseDir}/${safeName(name)}.md`, body)
      files++
    }
  }

  onProgress({ stage: '完成', done: total, total })
  return { files }
}
