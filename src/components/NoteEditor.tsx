import { useEffect, useImperativeHandle, useRef } from 'react'
import { EditorState, RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, keymap } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { TIMESTAMP_TOKEN, formatTime, parseTime } from '../lib/time'

export interface NoteEditorHandle {
  /** Drops a [[hh:mm:ss]] token at the cursor and refocuses the editor. */
  insertTimestamp: (seconds: number) => void
  focus: () => void
}

interface Props {
  ref?: React.Ref<NoteEditorHandle>
  initialValue: string
  onChange: (value: string) => void
  /** Called when a timestamp token in the note is clicked. */
  onSeek: (seconds: number) => void
  /** Invoked by the Alt+T binding so the caller can supply the current time. */
  onStampRequested: () => void
}

const timestampMark = Decoration.mark({ class: 'cm-ts' })

/** Paints every [[hh:mm:ss]] token in the visible viewport as a clickable chip. */
const timestampHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = build(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)
    // A fresh regex per pass: the shared literal carries lastIndex between uses.
    const re = new RegExp(TIMESTAMP_TOKEN.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      builder.add(from + m.index, from + m.index + m[0].length, timestampMark)
    }
  }
  return builder.finish()
}

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--ink)' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-wash) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-placeholder': { color: 'var(--muted)' },
})

export function NoteEditor({ ref, initialValue, onChange, onSeek, onStampRequested }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)

  // Callbacks live in refs so changing them never tears down the editor,
  // which would drop the cursor and undo history mid-sentence.
  const cbs = useRef({ onChange, onSeek, onStampRequested })
  cbs.current = { onChange, onSeek, onStampRequested }

  useImperativeHandle(ref, () => ({
    insertTimestamp(seconds: number) {
      const v = view.current
      if (!v) return
      const token = `[[${formatTime(seconds)}]] `
      const { from, to } = v.state.selection.main
      v.dispatch({
        changes: { from, to, insert: token },
        selection: { anchor: from + token.length },
      })
      v.focus()
    },
    focus() {
      view.current?.focus()
    },
  }))

  useEffect(() => {
    if (!host.current) return

    const v = new EditorView({
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          history(),
          keymap.of([
            {
              key: 'Alt-t',
              preventDefault: true,
              run: () => {
                cbs.current.onStampRequested()
                return true
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          timestampHighlighter,
          theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cbs.current.onChange(u.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            mousedown(event) {
              const el = event.target as HTMLElement | null
              if (!el?.classList.contains('cm-ts')) return false
              const seconds = parseTime(el.textContent?.replace(/[[\]]/g, '') ?? '')
              if (seconds === null) return false
              event.preventDefault()
              cbs.current.onSeek(seconds)
              return true
            },
          }),
        ],
      }),
      parent: host.current,
    })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
    // Mounted once per session; switching sessions remounts via the key prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={host} style={{ height: '100%' }} />
}
