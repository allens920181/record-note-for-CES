import {
  COURSE_COLORS,
  COURSE_KINDS,
  COURSE_KIND_LABEL,
  MEETING_KINDS,
  MEETING_KIND_LABEL,
} from '../db/schema'
import type { ClassSlot, CourseKind, MeetingKind } from '../db/schema'
import { WEEKDAY_LABELS } from '../db'
import { TimeField } from './TimeField'

export interface CourseDraft {
  name: string
  teacher: string
  code: string
  credits: number
  color: string
  /** 必修 / 選修, or '' for a course you have not said either way about. */
  kind: CourseKind | ''
  /** When it meets, every week. As much a part of "which course is this" as
      its code — the page header prints it right beside the credits. */
  slots: ClassSlot[]
}

export const EMPTY_COURSE: CourseDraft = {
  name: '',
  teacher: '',
  code: '',
  credits: 3,
  color: COURSE_COLORS[0],
  kind: '',
  slots: [],
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
 *
 * The weekly timetable is one of those fields. It used to sit on a tab of its
 * own, so creating a course and saying when it meets were two errands on two
 * screens; nothing else about a course is set up that way.
 */
export function CourseForm({ value, onChange, showColor = false }: Props) {
  const set = (next: Partial<CourseDraft>) => onChange({ ...value, ...next })
  const patch = (i: number, next: Partial<ClassSlot>) =>
    set({ slots: value.slots.map((s, j) => (j === i ? { ...s, ...next } : s)) })

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
        {/* Three options, not a checkbox: a course nobody has said anything
            about is not the same as one marked 選修. */}
        <div className="field">
          <label htmlFor="c-kind">修別</label>
          <select
            id="c-kind"
            value={value.kind}
            onChange={(e) => set({ kind: e.target.value as CourseKind | '' })}
          >
            <option value="">未指定</option>
            {COURSE_KINDS.map((k) => (
              <option key={k} value={k}>
                {COURSE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {/* ── when it meets ──────────────────────────────────────── */}
      <div className="field">
        <label>每週上課時間</label>
        {value.slots.length === 0 ? (
          <div className="hint" style={{ marginTop: 0 }}>
            只放<strong>每週都會上</strong>的課。正課和分組討論各自每週開一個檔案——
            兩場是分開的錄音，時間軸沒辦法合併，但同一週共用同一個週次編號。
            只上一次的課不必寫在這裡，到「上課週次」用「新增一堂課」挑日期就好。
          </div>
        ) : (
          <div className="stack" style={{ marginBottom: '.6rem' }}>
            {value.slots.map((slot, i) => (
              <div key={i} className="slot-row in-form">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`kd-${i}`}>類型</label>
                  <select
                    id={`kd-${i}`}
                    value={slot.kind ?? 'lecture'}
                    onChange={(e) => patch(i, { kind: e.target.value as MeetingKind })}
                  >
                    {MEETING_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {MEETING_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`wd-${i}`}>星期</label>
                  <select
                    id={`wd-${i}`}
                    value={slot.weekday}
                    onChange={(e) => patch(i, { weekday: Number(e.target.value) })}
                  >
                    {WEEKDAY_LABELS.map((label, wd) => (
                      <option key={wd} value={wd}>
                        週{label}
                      </option>
                    ))}
                  </select>
                </div>
                <TimeField
                  id={`st-${i}`}
                  label="開始"
                  value={slot.start}
                  onChange={(v) => patch(i, { start: v })}
                />
                <TimeField
                  id={`en-${i}`}
                  label="結束"
                  value={slot.end}
                  onChange={(v) => patch(i, { end: v })}
                />
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`rm-${i}`}>教室</label>
                  {/* A plain input, not the blur-to-save field used on pages:
                      nothing here reaches the database until 儲存, so there is
                      no write to postpone. */}
                  <input
                    id={`rm-${i}`}
                    type="text"
                    value={slot.room ?? ''}
                    onChange={(e) => patch(i, { room: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  className="btn danger sm"
                  onClick={() => set({ slots: value.slots.filter((_, j) => j !== i) })}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
        {/* The row carries a 類型 select, so one button reaches both kinds. */}
        <button
          type="button"
          className="btn"
          style={{ flex: '0 0 auto', alignSelf: 'flex-start' }}
          onClick={() =>
            set({
              slots: [...value.slots, { weekday: 2, start: '19:00', end: '22:00', kind: 'lecture' }],
            })
          }
        >
          新增上課時段
        </button>
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
