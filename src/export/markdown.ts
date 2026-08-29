import { db } from '../db'
import { SESSION_KIND_LABEL } from '../db/schema'
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
      const [transcript, note, plan] = await Promise.all([
        db.transcripts.where('sessionId').equals(session.id).last(),
        db.notes.get(session.id),
        db.weekPlans.get(session.id),
      ])
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
        (transcript
          ? `## 逐字稿\n\n${transcript.segments
              .map((seg) => `\`[${formatTime(seg.start)}]\` ${seg.text}`)
              .join('\n\n')}\n`
          : '')

      await writeInto(root, `${courseDir}/${safeName(name)}.md`, body)
      files++
    }
  }

  onProgress({ stage: '完成', done: total, total })
  return { files }
}
