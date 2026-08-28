import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, saveRequirements } from '../db'
import { EMPTY_REQUIREMENTS } from '../db/schema'

interface Props {
  courseId: string
}

const PLACEHOLDER = `評分方式：期末報告 40%、讀書報告 30%、出席 30%
報告：8–10 頁，芝加哥格式，雙行間距
出席：缺席三次以上不予計分
遲交：每逾一日扣 5 分
期末考：閉書，範圍第 1–10 週`

/**
 * The course's demands, as one block of text taken off the syllabus.
 *
 * Free text rather than a structured grading table on purpose: what gets looked
 * up mid-task is "報告幾頁、引註什麼格式、遲交扣幾分", and that is a sentence,
 * not a schema. Typing it once beats filling in fields that then need their own
 * screen to read back.
 */
export function RequirementsPanel({ courseId }: Props) {
  const course = useLiveQuery(() => db.courses.get(courseId), [courseId])
  const [saved, setSaved] = useState(false)

  // An earlier version stored a grading table in its own fields. Rather than
  // strand that data when the table went away, fold it into the text once.
  useEffect(() => {
    if (!course) return
    const grading = course.requirements?.grading ?? []
    if (grading.length === 0) return
    const line = `評分方式：${grading
      .map((g) => `${g.label || '（未命名）'} ${g.weight}%`)
      .join('、')}`
    const rules = course.requirements?.rules ?? ''
    void saveRequirements(courseId, {
      grading: [],
      rules: rules.includes(line) ? rules : `${line}\n${rules}`.trim(),
    })
  }, [course, courseId])

  useEffect(() => {
    if (!saved) return
    const t = window.setTimeout(() => setSaved(false), 2000)
    return () => window.clearTimeout(t)
  }, [saved])

  if (!course) return null
  const requirements = course.requirements ?? EMPTY_REQUIREMENTS

  return (
    <section className="card" style={{ marginBottom: '1.25rem' }}>
      <div className="grade-head">
        <h2 style={{ margin: 0 }}>課堂要求</h2>
        {saved && <span className="tag ok">已存檔</span>}
      </div>
      {/* The placeholder already shows the shape of what goes here, so the
          reasoning is only worth a paragraph while the box is still empty. */}
      {requirements.rules.trim() === '' && (
        <p className="small muted" style={{ margin: '.3rem 0 .9rem' }}>
          從教學大綱抄下來的評分方式與規定。放<strong>寫作業寫到一半會想查</strong>的東西——
          報告幾頁、引註用什麼格式、遲交怎麼算——不必為了一句話再去開一次 PDF。
        </p>
      )}
      <textarea
        id={`req-${courseId}`}
        rows={10}
        aria-label="課堂要求"
        placeholder={PLACEHOLDER}
        // Keyed on the saved text so a value written elsewhere (or the legacy
        // fold-in above) shows up, while typing is never interrupted.
        key={requirements.rules}
        defaultValue={requirements.rules}
        onBlur={(e) => {
          if (e.target.value === requirements.rules) return
          void saveRequirements(courseId, { grading: [], rules: e.target.value }).then(() =>
            setSaved(true),
          )
        }}
      />
      <div className="hint">離開輸入框就會存檔。這段也會一起匯出到 Markdown。</div>
    </section>
  )
}
