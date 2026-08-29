import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { EditorState, Prec, RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { TIMESTAMP_TOKEN, formatTime, parseTime } from '../lib/time'
import { richMarkdown } from '../editor/richMarkdown'
import { slashMenu } from '../editor/slashMenu'
import { NOTE_COMMANDS, toggleLinePrefix, wrapSelection, wrapWith } from '../editor/commands'
import {
  HIGHLIGHTS,
  TEXT_COLORS,
  UNDERLINE_CLOSE,
  UNDERLINE_OPEN,
} from '../editor/inline'
import { keyLabel } from '../editor/keys'
import type { NoteContext } from '../editor/commands'
import { MARK_LINE, NOTE_MARKS } from '../editor/marks'
import type { NoteMark } from '../editor/marks'

export interface NoteEditorHandle {
  /** Drops a [[hh:mm:ss]] token at the cursor and refocuses the editor. */
  insertTimestamp: (seconds: number) => void
  /** Runs one of the shared note commands by id. */
  run: (id: string) => void
  /** Puts the cursor on a 1-based line and scrolls it into view. */
  goToLine: (line: number) => void
  focus: () => void
}

interface Props {
  ref?: React.Ref<NoteEditorHandle>
  initialValue: string
  /** Called on every keystroke, for callers that debounce and save as you type. */
  onChange?: (value: string) => void
  /**
   * Called when focus leaves, for the short boxes in cards — they saved on blur
   * as plain textareas and should keep doing so now that they are editors.
   */
  onCommit?: (value: string) => void
  /** Called when a timestamp token in the note is clicked. */
  onSeek?: (seconds: number) => void
  /** Invoked by the Alt+T binding so the caller can supply the current time. */
  onStampRequested?: () => void
  /**
   * What the commands need from the page around the editor. Left out where
   * there is no audio and no transcript: those commands then switch themselves
   * off, which is why they each carry an `enabled` of their own.
   */
  context?: NoteContext
  /** Reports the note's structure so an outline can be drawn beside it. */
  onOutline?: (entries: OutlineEntry[], activeLine: number) => void
  placeholder?: string
  /** Height for a box in a card; the workspace's editor fills its pane. */
  minHeight?: string
  ariaLabel?: string
}

/** One jumpable place in a note: a heading, or something you flagged. */
export type OutlineEntry =
  | { kind: 'heading'; level: number; text: string; line: number }
  | { kind: 'mark'; mark: NoteMark; text: string; line: number }

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

/**
 * The places worth jumping to in a note: its headings, and everything flagged.
 *
 * Marks belong here as much as headings do — the reason to flag something is
 * to come back to it, and coming back is exactly what an outline is for.
 */
export function outlineOf(markdownText: string): OutlineEntry[] {
  const out: OutlineEntry[] = []
  let fenced = false
  markdownText.split('\n').forEach((text, i) => {
    if (/^\s*```/.test(text)) fenced = !fenced
    if (fenced) return
    const heading = /^(#{1,6})\s+(.*)$/.exec(text)
    if (heading && heading[2].trim()) {
      out.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim(), line: i + 1 })
      return
    }
    const mark = MARK_LINE.exec(text)
    if (mark) {
      out.push({ kind: 'mark', mark: mark[1] as NoteMark, text: mark[2].trim(), line: i + 1 })
    }
  })
  return out
}

/*
 * Enter continues the list or quote you are in — `markdown()` binds that
 * itself, including blockquotes, so there is no copy of it here.
 */

/**
 * ...except for one case it does not cover: Enter on an *empty task item*.
 *
 * A blank `- [ ] ` still carries its checkbox, so the built-in continuation
 * never sees it as empty and hands back another one. There is no way out of a
 * checklist except backspacing through the marker, which is exactly the sort
 * of thing that stops someone using checklists at all. This ends the item and
 * leaves everything else to the markdown keymap.
 */
const endEmptyItem = {
  key: 'Enter',
  run: (view: EditorView) => {
    const range = view.state.selection.main
    if (!range.empty) return false
    const line = view.state.doc.lineAt(range.head)
    if (range.head !== line.to) return false
    const m = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?$/.exec(line.text)
    if (!m) return false
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: m[1] },
      selection: { anchor: line.from + m[1].length },
    })
    return true
  },
}

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--ink)' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-wash) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-placeholder': { color: 'var(--muted)' },
})

/**
 * What the selection bar carries.
 *
 * Inline only — things that act on the words you highlighted. Headings, lists
 * and quotes act on whole lines and live in the `/` menu, which keeps one rule
 * a reader can hold: **選取工具列管字，斜線選單管段落**. It also stops the bar
 * growing wider than the pane it floats in.
 */
const BAR = ['bold', 'italic', 'underline', 'strike', 'code'] as const

/** For editors with no audio or transcript beside them. */
const EMPTY_CONTEXT: NoteContext = { now: () => null, transcriptQuote: () => null }

export function NoteEditor({
  ref,
  initialValue,
  onChange,
  onCommit,
  onSeek,
  onStampRequested,
  context,
  onOutline,
  placeholder: hint,
  minHeight,
  ariaLabel,
}: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  const closing = useRef(false)
  const [bar, setBar] = useState<{ top: number; left: number } | null>(null)
  const [palette, setPalette] = useState(false)

  // Callbacks live in refs so changing them never tears down the editor,
  // which would drop the cursor and undo history mid-sentence.
  const cbs = useRef({ onChange, onCommit, onSeek, onStampRequested, context, onOutline })
  cbs.current = { onChange, onCommit, onSeek, onStampRequested, context, onOutline }

  function runCommand(id: string) {
    const v = view.current
    const cmd = NOTE_COMMANDS.find((c) => c.id === id)
    if (v && cmd) cmd.run(v, cbs.current.context ?? EMPTY_CONTEXT)
  }

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
    run: runCommand,
    goToLine(line: number) {
      const v = view.current
      if (!v) return
      const at = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines)).from
      v.dispatch({ selection: { anchor: at }, scrollIntoView: true })
      v.focus()
    },
    focus() {
      view.current?.focus()
    },
  }))

  useEffect(() => {
    if (!host.current) return
    // Reset, not just set on the way out: the ref survives a remount, and in
    // development the effect runs twice — leaving it true after the first
    // teardown meant no field ever saved again.
    closing.current = false
    // A live proxy, so a command reads the playback position at the moment it
    // runs rather than the one captured when the editor was created.
    // Read through the ref every time: the editor is built once, and a context
    // captured here would freeze on the first render's callbacks.
    // `attachFile` is present or absent, never a stub: `/檔案` decides whether
    // to offer itself by whether the key exists, and a stub that resolves null
    // would list a command that does nothing.
    const ctx: NoteContext = {
      now: () => cbs.current.context?.now() ?? null,
      transcriptQuote: () => cbs.current.context?.transcriptQuote() ?? null,
      ...(cbs.current.context?.attachFile
        ? { attachFile: () => cbs.current.context!.attachFile!() }
        : {}),
    }

    const v = new EditorView({
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          history(),
          // Highest, because `markdown()` binds Enter too and would otherwise
          // hand this one another checkbox before we ever see the key.
          Prec.highest(keymap.of([endEmptyItem])),
          keymap.of([
            {
              key: 'Alt-t',
              preventDefault: true,
              run: () => {
                if (!cbs.current.onStampRequested) return false
                cbs.current.onStampRequested()
                return true
              },
            },
            { key: 'Mod-b', preventDefault: true, run: (e) => (wrapSelection(e, '**'), true) },
            { key: 'Mod-i', preventDefault: true, run: (e) => (wrapSelection(e, '*'), true) },
            {
              key: 'Mod-u',
              preventDefault: true,
              run: (e) => (wrapWith(e, UNDERLINE_OPEN, UNDERLINE_CLOSE), true),
            },
            {
              key: 'Mod-Shift-x',
              preventDefault: true,
              run: (e) => (wrapSelection(e, '~~'), true),
            },
            { key: 'Mod-1', preventDefault: true, run: (e) => (toggleLinePrefix(e, '# '), true) },
            { key: 'Mod-2', preventDefault: true, run: (e) => (toggleLinePrefix(e, '## '), true) },
            { key: 'Mod-3', preventDefault: true, run: (e) => (toggleLinePrefix(e, '### '), true) },
            {
              key: 'Mod-Shift-8',
              preventDefault: true,
              run: (e) => (toggleLinePrefix(e, '- '), true),
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          markdown({ base: markdownLanguage }),
          ...(hint ? [cmPlaceholder(hint)] : []),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          slashMenu(ctx),
          richMarkdown,
          timestampHighlighter,
          theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cbs.current.onChange?.(u.state.doc.toString())
            if (u.docChanged || u.selectionSet) {
              const range = u.state.selection.main
              const line = u.state.doc.lineAt(range.head).number
              cbs.current.onOutline?.(outlineOf(u.state.doc.toString()), line)

              // The floating bar follows the selection, and only exists while
              // there is one — an always-on toolbar would eat height the pane
              // does not have.
              if (range.empty) {
                setBar(null)
                setPalette(false)
              }
              else {
                const coords = u.view.coordsAtPos(range.from)
                const box = u.view.dom.getBoundingClientRect()
                setBar(
                  coords
                    ? { top: coords.top - box.top - 8, left: coords.left - box.left }
                    : null,
                )
              }
            }
          }),
          EditorView.domEventHandlers({
            mousedown(event) {
              if (!cbs.current.onSeek) return false
              const el = event.target as HTMLElement | null
              if (!el?.classList.contains('cm-ts')) return false
              const seconds = parseTime(el.textContent?.replace(/[[\]]/g, '') ?? '')
              if (seconds === null) return false
              event.preventDefault()
              cbs.current.onSeek?.(seconds)
              return true
            },
          }),
        ],
      }),
      parent: host.current,
    })
    view.current = v
    cbs.current.onOutline?.(outlineOf(initialValue), 1)

    // Straight on the content element: blur does not bubble, so CodeMirror's
    // own handler map never sees it. Guarded against teardown, whose destroy()
    // fires one last blur that would save on the way out.
    const onBlur = () => {
      if (closing.current) return
      cbs.current.onCommit?.(v.state.doc.toString())
    }
    v.contentDOM.addEventListener('blur', onBlur)

    return () => {
      closing.current = true
      v.contentDOM.removeEventListener('blur', onBlur)
      v.destroy()
      view.current = null
    }
    // Mounted once per session; switching sessions remounts via the key prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className={`note-wrap${minHeight ? ' as-field' : ''}`}
      style={minHeight ? { minHeight, height: 'auto' } : undefined}
    >
      <div ref={host} className="note-host" aria-label={ariaLabel} />
      {bar && (
        <div
          className="note-bar"
          style={{ top: Math.max(0, bar.top), left: Math.max(0, bar.left) }}
          // mousedown, not click: the editor loses its selection on blur, and
          // by click time there would be nothing left to format.
          onMouseDown={(e) => e.preventDefault()}
        >
          {BAR.map((id) => {
            const cmd = NOTE_COMMANDS.find((c) => c.id === id)
            return cmd ? (
              <button
                key={id}
                className="note-bar-btn"
                title={
                  [cmd.hint ?? cmd.label, cmd.shortcut && keyLabel(cmd.shortcut)]
                    .filter(Boolean)
                    .join(' · ')
                }
                onClick={() => runCommand(id)}
              >
                {cmd.label}
              </button>
            ) : null
          })}
          <span className="note-bar-sep" />
          <button
            className={`note-bar-btn${palette ? ' is-on' : ''}`}
            title="字色與螢光筆"
            onClick={() => setPalette((v) => !v)}
          >
            顏色 ▾
          </button>
          <span className="note-bar-sep" />
          {NOTE_MARKS.map((kind) => (
            <button
              key={kind}
              className={`note-bar-btn is-${kind}`}
              title={`標記為${kind}`}
              onClick={() => runCommand(`mark-${kind}`)}
            >
              {kind}
            </button>
          ))}

          {palette && (
            <div className="note-palette">
              <div className="note-palette-row">
                <span className="note-palette-label">字色</span>
                {TEXT_COLORS.map((swatch) => (
                  <button
                    key={swatch.id}
                    className={`note-swatch is-text c-${swatch.id}`}
                    title={`字色：${swatch.label}`}
                    aria-label={`字色：${swatch.label}`}
                    onClick={() => {
                      runCommand(`color-${swatch.id}`)
                      setPalette(false)
                    }}
                  >
                    A
                  </button>
                ))}
              </div>
              <div className="note-palette-row">
                <span className="note-palette-label">螢光筆</span>
                {HIGHLIGHTS.map((swatch) => (
                  <button
                    key={swatch.id}
                    className={`note-swatch hl-${swatch.id}`}
                    title={`螢光筆：${swatch.label}`}
                    aria-label={`螢光筆：${swatch.label}`}
                    onClick={() => {
                      runCommand(`hl-${swatch.id}`)
                      setPalette(false)
                    }}
                  />
                ))}
                <button
                  className="note-bar-btn"
                  title="把選取範圍的顏色與底線拿掉"
                  onClick={() => {
                    runCommand('clear')
                    setPalette(false)
                  }}
                >
                  清除
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
