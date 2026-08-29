import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Names already used in this course, offered first. */
  roster: string[]
  /** The name on this line, or null when the line only inherits one. */
  value: string | null
  /** True when this line already carries the mark, rather than inheriting it. */
  marked: boolean
  /** A silence before this line: probably where a turn begins. */
  suggested: boolean
  onPick: (name: string | null) => void
}

/** Offered when a course has no names yet, so the first mark is one click. */
const STARTERS = ['老師', '同學']

/**
 * Names who starts speaking on one line.
 *
 * The transcription service returns no speakers — the OpenAI-compatible
 * endpoint has no such output — so this is done by hand. It is made cheap
 * rather than automatic: a mark runs forward until the next one, and the
 * silences in the audio put the button where a turn probably starts, so a
 * three-hour class is a handful of clicks rather than two hundred.
 */
export function SpeakerPicker({ roster, value, marked, suggested, onPick }: Props) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Claimed, so the workspace's own Escape handling stays out of it.
      e.preventDefault()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const names = roster.length > 0 ? roster : STARTERS

  function pick(name: string | null) {
    setOpen(false)
    setTyped('')
    onPick(name)
  }

  return (
    <span className="spk" ref={box}>
      <button
        type="button"
        className={`spk-btn${marked ? ' is-marked' : ''}${suggested && !marked ? ' is-hint' : ''}`}
        aria-label={value ? `這一句是${value}講的，換一個人` : '標記這裡開始換人講'}
        aria-expanded={open}
        onClick={(e) => {
          // The row itself seeks the audio; naming a speaker should not also
          // start playing the lecture.
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        {marked ? value : '＋'}
      </button>
      {open && (
        <span className="spk-list" role="menu" onClick={(e) => e.stopPropagation()}>
          {names.map((n) => (
            <button
              key={n}
              type="button"
              role="menuitem"
              className={`spk-item${n === value ? ' is-here' : ''}`}
              onClick={() => pick(n)}
            >
              {n}
            </button>
          ))}
          <span className="spk-new">
            <input
              type="text"
              value={typed}
              placeholder="其他人的名字"
              aria-label="新增說話者"
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                const name = typed.trim()
                if (name) pick(name)
              }}
              onChange={(e) => setTyped(e.target.value)}
            />
            <button
              type="button"
              className="btn sm"
              disabled={!typed.trim()}
              onClick={() => {
                const name = typed.trim()
                if (name) pick(name)
              }}
            >
              加入
            </button>
          </span>
          {marked && (
            <button type="button" role="menuitem" className="spk-item is-danger" onClick={() => pick(null)}>
              取消這個標記
            </button>
          )}
        </span>
      )}
    </span>
  )
}
