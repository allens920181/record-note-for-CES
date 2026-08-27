import { COURSE_COLORS } from '../db/schema'

export interface CourseDraft {
  name: string
  teacher: string
  code: string
  credits: number
  color: string
}

export const EMPTY_COURSE: CourseDraft = {
  name: '',
  teacher: '',
  code: '',
  credits: 3,
  color: COURSE_COLORS[0],
}

interface Props {
  value: CourseDraft
  onChange: (next: CourseDraft) => void
  /** Creating picks the colour automatically; editing is where it becomes worth choosing. */
  showColor?: boolean
}

/**
 * The fields of a course, shared by the create and edit dialogs so the two
 * cannot drift apart — and so that editing exists at all, which it did not:
 * a mistyped course name could only be fixed by deleting the course, taking
 * every session, transcript and note under it.
 */
export function CourseForm({ value, onChange, showColor = false }: Props) {
  const set = (patch: Partial<CourseDraft>) => onChange({ ...value, ...patch })

  return (
    <>
      <div className="field">
        <label htmlFor="c-name">課程名稱</label>
        <input
          id="c-name"
          type="text"
          value={value.name}
          autoFocus
          placeholder="系統神學（一）"
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="c-teacher">授課老師</label>
          <input
            id="c-teacher"
            type="text"
            value={value.teacher}
            onChange={(e) => set({ teacher: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="c-code">課號</label>
          <input
            id="c-code"
            type="text"
            value={value.code}
            onChange={(e) => set({ code: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="c-credits">學分</label>
          <input
            id="c-credits"
            type="number"
            min={0}
            max={12}
            value={value.credits}
            onChange={(e) => set({ credits: Number(e.target.value) })}
          />
        </div>
      </div>
      {showColor && (
        <div className="field" style={{ marginBottom: 0 }}>
          <label>代表色</label>
          <div className="swatches">
            {COURSE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch-pick${value.color === c ? ' active' : ''}`}
                style={{ background: c }}
                aria-label={`代表色 ${c}`}
                aria-pressed={value.color === c}
                onClick={() => set({ color: c })}
              />
            ))}
          </div>
          <div className="hint">行事曆上就靠這個顏色分辨是哪一門課。</div>
        </div>
      )}
    </>
  )
}
