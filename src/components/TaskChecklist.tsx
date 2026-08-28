import { useState } from 'react'

export interface ChecklistItem {
  id: string
  title: string
  done: boolean
  /** Rough hours. Both lists weigh themselves against set-aside study time. */
  hours?: number
  /** A short word after the title — where the item came from, usually. */
  tag?: string
}

interface Props {
  items: ChecklistItem[]
  onChange: (items: ChecklistItem[]) => void
  makeId: () => string
  /** Offered in the empty state, and again under a list that has items. */
  templates?: Array<{ name: string; steps: string[] }>
  addPlaceholder?: string
  emptyText?: string
}

/**
 * A list of small things to tick off.
 *
 * The app had two of these — an assignment's steps and a week's plan — doing
 * the same job in visibly different ways: one struck through what was done and
 * the other did not, one saved on every keystroke and the other when you left
 * the field, one hid its templates until the list was empty. Ticking something
 * off should not feel like a different app depending on which page you are on.
 */
export function TaskChecklist({
  items,
  onChange,
  makeId,
  templates = [],
  addPlaceholder = '再加一項',
  emptyText = '還沒有任何項目。',
}: Props) {
  const [draft, setDraft] = useState('')
  const [hours, setHours] = useState('')

  const patch = (id: string, next: Partial<ChecklistItem>) =>
    onChange(items.map((i) => (i.id === id ? { ...i, ...next } : i)))

  function add() {
    const title = draft.trim()
    if (!title) return
    const h = Number(hours)
    setDraft('')
    setHours('')
    onChange([
      ...items,
      { id: makeId(), title, done: false, hours: Number.isFinite(h) && h > 0 ? h : undefined },
    ])
  }

  const applyTemplate = (steps: string[]) =>
    onChange([...items, ...steps.map((title) => ({ id: makeId(), title, done: false }))])

  return (
    <>
      {items.length === 0 ? (
        <div className="empty" style={{ padding: '1.1rem' }}>
          <p>{emptyText}</p>
          {templates.length > 0 && (
            <div className="row" style={{ gap: '.4rem', justifyContent: 'center' }}>
              {templates.map((t) => (
                <button
                  key={t.name}
                  className="btn sm"
                  style={{ flex: '0 0 auto' }}
                  onClick={() => applyTemplate(t.steps)}
                >
                  套用「{t.name}」
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="stack" style={{ gap: '.35rem' }}>
          {items.map((item) => (
            <div key={item.id} className={`plan-item${item.done ? ' is-done' : ''}`}>
              <input
                type="checkbox"
                checked={item.done}
                aria-label={item.title}
                onChange={(e) => patch(item.id, { done: e.target.checked })}
              />
              {/* defaultValue + onBlur: the other copy of this list wrote to
                  IndexedDB on every keystroke, so typing a five-word step was
                  thirty writes and thirty re-renders of everything watching. */}
              <input
                type="text"
                className="plan-title"
                defaultValue={item.title}
                onBlur={(e) => patch(item.id, { title: e.target.value })}
              />
              {item.tag && <span className="tag">{item.tag}</span>}
              <div className="pct">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  aria-label="預估小時"
                  placeholder="—"
                  defaultValue={item.hours ?? ''}
                  onBlur={(e) =>
                    patch(item.id, { hours: e.target.value ? Number(e.target.value) : undefined })
                  }
                />
                <span className="small muted">h</span>
              </div>
              <button
                className="btn ghost sm"
                style={{ flex: '0 0 auto' }}
                onClick={() => onChange(items.filter((i) => i.id !== item.id))}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: '.4rem', marginTop: '.7rem' }}>
        <input
          type="text"
          placeholder={addPlaceholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            add()
          }}
        />
        <div className="pct" style={{ flex: '0 0 5.5rem' }}>
          <input
            type="number"
            min={0}
            step={0.5}
            placeholder="小時"
            aria-label="預估小時"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          <span className="small muted">h</span>
        </div>
        <button className="btn" style={{ flex: '0 0 auto' }} disabled={!draft.trim()} onClick={add}>
          加入
        </button>
      </div>

      {/* Templates stay reachable once the list has items: the old assignment
          list showed them always, the old week plan hid them for ever after
          the first item, and adding a second batch is a normal thing to want. */}
      {items.length > 0 && templates.length > 0 && (
        <div className="row" style={{ gap: '.4rem', marginTop: '.6rem' }}>
          {templates.map((t) => (
            <button
              key={t.name}
              className="btn sm"
              style={{ flex: '0 0 auto' }}
              onClick={() => applyTemplate(t.steps)}
            >
              套用「{t.name}」
            </button>
          ))}
        </div>
      )}
    </>
  )
}
