import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  deleteSessionCascade,
  deleteWorkBlock,
  renumberSessions,
  updateWorkBlock,
} from '../db'
import { MEETING_KIND_LABEL } from '../db/schema'
import type { CalendarItem } from '../schedule/occurrences'
import { WEEKDAY_SHORT, minutesOf, timeOf, weekdayOf } from '../lib/dates'
import { Modal } from './Modal'
import { TimeField } from './TimeField'
import { useConfirm } from './ConfirmProvider'

interface Props {
  item: CalendarItem
  onClose: () => void
  /** Go to where this thing actually lives — the workspace, or the course page. */
  onOpen: (item: CalendarItem) => void
}

const KIND_LABEL: Record<CalendarItem['kind'], string> = {
  lecture: MEETING_KIND_LABEL.lecture,
  discussion: MEETING_KIND_LABEL.discussion,
  work: '寫作業時段',
  deadline: '繳交期限',
}

/**
 * What a calendar item is, and what can be done to it.
 *
 * Clicking an item used to navigate straight out of the calendar, which left
 * no way at all to fix a wrong time or drop something added by mistake — the
 * only route was to remember which course page owned it. The card keeps the
 * reader where they are and puts the three questions in one place: what is
 * this, take me to it, and get it off my calendar.
 */
export function CalendarItemCard({ item, onClose, onOpen }: Props) {
  const ask = useConfirm()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const session = useLiveQuery(
    async () => (item.sessionId ? ((await db.sessions.get(item.sessionId)) ?? null) : null),
    [item.sessionId],
  )
  const block = useLiveQuery(
    async () => (item.workBlockId ? ((await db.workBlocks.get(item.workBlockId)) ?? null) : null),
    [item.workBlockId],
  )

  // A weekly study block is one row standing for every occurrence, so there is
  // no such thing as changing "this Tuesday" — the whole series moves or none
  // of it does. Saying so is kinder than an edit that silently rewrites twelve
  // weeks at once.
  const series = block?.repeat === 'weekly'
  const editable = Boolean(item.sessionId) || (Boolean(item.workBlockId) && !series)

  const [date, setDate] = useState(item.date)
  const [start, setStart] = useState(item.startMin === null ? '' : timeOf(item.startMin))
  const [end, setEnd] = useState(item.endMin === null ? '' : timeOf(item.endMin))

  // Reopening on a different item must not keep the previous one's fields.
  useEffect(() => {
    setEditing(false)
    setError(null)
    setDate(item.date)
    setStart(item.startMin === null ? '' : timeOf(item.startMin))
    setEnd(item.endMin === null ? '' : timeOf(item.endMin))
  }, [item.key, item.date, item.startMin, item.endMin])

  async function save() {
    const from = minutesOf(start)
    const to = minutesOf(end)
    if (start && to !== null && from !== null && to <= from) {
      setError('結束時間要晚於開始時間。')
      return
    }
    if (item.sessionId) {
      await db.sessions.update(item.sessionId, {
        date,
        start: start || undefined,
        end: end || undefined,
      })
      // Moving a meeting across a week boundary changes which week it is.
      await renumberSessions(item.courseId)
    } else if (item.workBlockId) {
      if (!start || !end) {
        setError('寫作業時段需要開始與結束。')
        return
      }
      await updateWorkBlock(item.workBlockId, { date, start, end })
    }
    onClose()
  }

  async function remove() {
    if (item.sessionId) {
      const go = await ask({
        title: `刪除 ${item.date} 的${KIND_LABEL[item.kind]}？`,
        danger: true,
        confirmLabel: '刪除這個週次',
        body: <>會一起消失的：這一週的逐字稿、筆記、本週進度與講義。</>,
      })
      if (!go) return
      await deleteSessionCascade(item.sessionId)
      await renumberSessions(item.courseId)
    } else if (item.workBlockId) {
      const go = await ask({
        title: series ? '刪除每週固定的寫作業時段？' : `刪除 ${item.date} 的寫作業時段？`,
        danger: true,
        confirmLabel: series ? '刪除整個每週時段' : '刪除這段時間',
        body: series ? (
          <>整個學期每週的這段時間都會消失，可用時數會跟著變少。</>
        ) : (
          <>只影響這一天，其他日子不變。</>
        ),
      })
      if (!go) return
      await deleteWorkBlock(item.workBlockId)
    }
    onClose()
  }

  const when =
    item.startMin === null
      ? '未定時間'
      : `${timeOf(item.startMin)}${item.endMin !== null ? `–${timeOf(item.endMin)}` : ''}`

  // The dialog's title is already the item's own title, so anything repeated
  // here is noise: a study block would otherwise say its course and kind twice
  // before saying anything new.
  const sub = [
    item.kind === 'deadline' ? item.courseName : item.detail,
    session?.room,
  ]
    .filter((part): part is string => Boolean(part) && part !== item.title)
    .join(' · ')

  return (
    <Modal
      title={item.title}
      onClose={onClose}
      onSubmit={editing ? save : () => onOpen(item)}
      submitLabel={editing ? '儲存' : openLabel(item)}
    >
      <div className="item-card-head">
        <span className="swatch" style={{ background: item.color }} />
        <span className="grow">
          <span className="mono">
            {item.date}（週{WEEKDAY_SHORT[weekdayOf(item.date)]}） {when}
          </span>
          {sub && <span className="sub">{sub}</span>}
        </span>
        {item.canceled && <span className="tag">{item.kind === 'deadline' ? '已完成' : '停課'}</span>}
      </div>

      {series && (
        <div className="notice" style={{ marginBottom: '.9rem' }}>
          這是<strong>每週</strong>固定的寫作業時段（每週{WEEKDAY_SHORT[weekdayOf(item.date)]}
          ），不是只有這一天。改時間要改整段，到課程頁的「作業與閱讀」。
        </div>
      )}

      {editing && (
        <>
          {/* Three across does not fit the dialog, and wrapping left 結束 alone
              on a full-width row. Date, then the pair that belongs together. */}
          <div className="field">
            <label htmlFor="ic-date">日期</label>
            <input id="ic-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="row">
            <TimeField id="ic-start" label="開始" value={start} onChange={setStart} />
            <TimeField id="ic-end" label="結束" value={end} onChange={setEnd} />
          </div>
          {item.sessionId && date !== item.date && (
            <div className="notice">
              移到別的日期後，「第 N 週」會照學期開始日重新算一次。
            </div>
          )}
        </>
      )}

      {error && <div className="notice warn">{error}</div>}

      <div className="item-card-actions">
        {editable && !editing && (
          <button type="button" className="btn sm" onClick={() => setEditing(true)}>
            改時間
          </button>
        )}
        {editing && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              setEditing(false)
              setError(null)
              setDate(item.date)
              setStart(item.startMin === null ? '' : timeOf(item.startMin))
              setEnd(item.endMin === null ? '' : timeOf(item.endMin))
            }}
          >
            不改了
          </button>
        )}
        {item.sessionId && session && (
          <button
            type="button"
            className="btn sm"
            onClick={() => void db.sessions.update(session.id, { canceled: !session.canceled })}
          >
            {session.canceled ? '恢復這一週' : '標記停課'}
          </button>
        )}
        <span className="spacer" />
        {(item.sessionId || item.workBlockId) && (
          <button type="button" className="btn danger sm" onClick={() => void remove()}>
            刪除
          </button>
        )}
      </div>
    </Modal>
  )
}

/** The submit button says where it goes, so nobody has to guess. */
function openLabel(item: CalendarItem): string {
  if (item.assignmentId) return '去這份作業'
  if (item.sessionId) return '開啟這一週'
  return '去課程設定'
}
