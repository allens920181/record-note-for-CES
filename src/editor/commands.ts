import { ChangeSet } from '@codemirror/state'
import { moveLineDown, moveLineUp } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { NOTE_MARKS } from './marks'
import type { NoteMark } from './marks'

/**
 * Everything the note editor can do to the text, in one list.
 *
 * The slash menu, the selection toolbar and the keyboard shortcuts are three
 * ways into the same commands — written once so they cannot drift into
 * offering different things or naming the same thing differently.
 */

/** What a command may need from the page around the editor. */
export interface NoteContext {
  /** Current playback position, or null when there is no audio. */
  now: () => number | null
  /** The reader's selection in the transcript, if any. */
  transcriptQuote: () => { text: string; seconds: number } | null
}

export interface NoteCommand {
  id: string
  label: string
  hint?: string
  group: '格式' | '標記' | '課堂'
  /**
   * CodeMirror key notation, when there is a shortcut for this.
   *
   * The menu prints it, so a command that can be reached from the keyboard
   * says so — there is no point having a shortcut nobody is ever told about.
   */
  shortcut?: string
  /** Typed after `/` to find it, so the menu works without arrow keys. */
  keywords: string
  /** Off when the command has nothing to work with right now. */
  enabled?: (ctx: NoteContext) => boolean
  run: (view: EditorView, ctx: NoteContext) => void
}

// ── text helpers ─────────────────────────────────────────────────────

const BLOCK_PREFIX = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/

/**
 * Puts a prefix on every line the selection touches, or takes it off again
 * when it is already there — so the same button that made a heading unmakes it.
 */
export function toggleLinePrefix(view: EditorView, prefix: string) {
  const { state } = view
  const changes: Array<{ from: number; to: number; insert: string }> = []
  const seen = new Set<number>()
  const main = state.selection.main
  const mainLine = state.doc.lineAt(main.head)
  let caret: { lineFrom: number; before: number; after: number; into: number } | null = null

  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = state.doc.line(n)
      const m = BLOCK_PREFIX.exec(line.text)
      const indent = m?.[1] ?? ''
      const existing = m?.[2] ?? ''
      const wanted = existing === prefix ? '' : prefix
      changes.push({
        from: line.from,
        to: line.from + indent.length + existing.length,
        insert: indent + wanted,
      })
      if (n === mainLine.number) {
        caret = {
          lineFrom: line.from,
          before: indent.length + existing.length,
          after: indent.length + wanted.length,
          into: Math.max(0, main.head - (line.from + indent.length + existing.length)),
        }
      }
    }
  }
  if (changes.length === 0) return

  // Without this the caret stays where it was — which, on an empty line, is
  // *before* the marker just inserted. The next thing typed then lands in
  // front of `- [ ] ` and the line is not a task at all. Keep the caret the
  // same distance into the line's own text as it was before.
  const set = ChangeSet.of(changes, state.doc.length)
  view.dispatch({
    changes: set,
    ...(caret
      ? { selection: { anchor: set.mapPos(caret.lineFrom, -1) + caret.after + caret.into } }
      : {}),
  })
  view.focus()
}

/** Wraps the selection in `marker`, or peels it off when it is already there. */
export function wrapSelection(view: EditorView, marker: string) {
  const { state } = view
  const range = state.selection.main
  const inner = state.sliceDoc(range.from, range.to)
  const len = marker.length

  const around =
    state.sliceDoc(Math.max(0, range.from - len), range.from) === marker &&
    state.sliceDoc(range.to, Math.min(state.doc.length, range.to + len)) === marker

  if (around) {
    view.dispatch({
      changes: [
        { from: range.from - len, to: range.from, insert: '' },
        { from: range.to, to: range.to + len, insert: '' },
      ],
      selection: { anchor: range.from - len, head: range.to - len },
    })
  } else if (inner.startsWith(marker) && inner.endsWith(marker) && inner.length > len * 2) {
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: inner.slice(len, -len) },
      selection: { anchor: range.from, head: range.to - len * 2 },
    })
  } else {
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: `${marker}${inner}${marker}` },
      // With nothing selected the caret lands between the markers, ready to type.
      selection: inner
        ? { anchor: range.from + len, head: range.to + len }
        : { anchor: range.from + len },
    })
  }
  view.focus()
}

/** Drops a whole block in on its own line, keeping blank lines around it. */
export function insertBlock(view: EditorView, text: string, caretOffset?: number) {
  const { state } = view
  const range = state.selection.main
  const line = state.doc.lineAt(range.from)
  const atLineStart = range.from === line.from
  const lead = line.text.trim() === '' ? '' : '\n'
  // Two `>` blocks with nothing between them are one blockquote in markdown,
  // so a transcript quote dropped straight under a 標記 would be read as part
  // of the question — and would come back that way in the term-wide review.
  const gap = lead && /^\s*>/.test(line.text) && /^\s*>/.test(text) ? '\n' : ''
  const insert = `${atLineStart && !lead ? '' : lead}${gap}${text}`
  const at = lead ? line.to : range.from
  view.dispatch({
    changes: { from: at, to: Math.max(at, range.to), insert },
    selection: { anchor: at + (caretOffset ?? insert.length) },
  })
  view.focus()
}

export function insertMark(view: EditorView, kind: NoteMark) {
  // The caret lands at the end of what was inserted, which is where the note
  // itself goes — `insertBlock` already does that, so no offset arithmetic.
  insertBlock(view, `> [!${kind}] `)
}

// ── the list ─────────────────────────────────────────────────────────

export const NOTE_COMMANDS: NoteCommand[] = [
  {
    id: 'h1',
    shortcut: 'Mod-1',
    label: '大標題',
    hint: '一堂課的主題',
    group: '格式',
    keywords: 'h1 大標題 title heading',
    run: (v) => toggleLinePrefix(v, '# '),
  },
  {
    id: 'h2',
    shortcut: 'Mod-2',
    label: '中標題',
    hint: '一個段落的主題',
    group: '格式',
    keywords: 'h2 中標題 heading',
    run: (v) => toggleLinePrefix(v, '## '),
  },
  {
    id: 'h3',
    shortcut: 'Mod-3',
    label: '小標題',
    group: '格式',
    keywords: 'h3 小標題 heading',
    run: (v) => toggleLinePrefix(v, '### '),
  },
  {
    id: 'bullet',
    shortcut: 'Mod-Shift-8',
    label: '項目清單',
    group: '格式',
    keywords: 'list bullet 清單 項目',
    run: (v) => toggleLinePrefix(v, '- '),
  },
  {
    id: 'number',
    label: '編號清單',
    group: '格式',
    keywords: 'number ordered 編號 清單',
    run: (v) => toggleLinePrefix(v, '1. '),
  },
  {
    id: 'todo',
    label: '待辦事項',
    hint: '課後要做的事，可以打勾',
    group: '格式',
    keywords: 'todo task 待辦 checkbox 打勾',
    run: (v) => toggleLinePrefix(v, '- [ ] '),
  },
  {
    id: 'quote',
    label: '引用',
    group: '格式',
    keywords: 'quote 引用 blockquote',
    run: (v) => toggleLinePrefix(v, '> '),
  },
  {
    id: 'bold',
    shortcut: 'Mod-b',
    label: '粗體',
    group: '格式',
    keywords: 'bold 粗體 strong',
    run: (v) => wrapSelection(v, '**'),
  },
  {
    id: 'italic',
    shortcut: 'Mod-i',
    label: '斜體',
    group: '格式',
    keywords: 'italic 斜體 em',
    run: (v) => wrapSelection(v, '*'),
  },
  {
    id: 'code',
    label: '行內代碼',
    hint: '原文詞、縮寫',
    group: '格式',
    keywords: 'code 代碼 原文',
    run: (v) => wrapSelection(v, '`'),
  },
  {
    id: 'move-up',
    label: '整段往上搬',
    hint: '選起來就能一次搬好幾行',
    group: '格式',
    shortcut: 'Alt-ArrowUp',
    keywords: 'move up 上移 搬 重排 排序',
    run: (v) => {
      moveLineUp(v)
      v.focus()
    },
  },
  {
    id: 'move-down',
    label: '整段往下搬',
    group: '格式',
    shortcut: 'Alt-ArrowDown',
    keywords: 'move down 下移 搬 重排 排序',
    run: (v) => {
      moveLineDown(v)
      v.focus()
    },
  },
  {
    id: 'rule',
    label: '分隔線',
    group: '格式',
    keywords: 'rule divider 分隔線 hr',
    run: (v) => insertBlock(v, '\n---\n'),
  },
  ...NOTE_MARKS.map(
    (kind): NoteCommand => ({
      id: `mark-${kind}`,
      label: `標記：${kind}`,
      hint:
        kind === '重點'
          ? '教授強調的'
          : kind === '疑問'
            ? '沒聽懂，之後要問'
            : '明講或暗示會考的',
      group: '標記',
      keywords: `mark ${kind} 標記`,
      run: (v) => insertMark(v, kind),
    }),
  ),
  {
    id: 'stamp',
    shortcut: 'Alt-t',
    label: '插入目前時間',
    hint: '之後點一下就跳回這一秒',
    group: '課堂',
    keywords: 'time timestamp 時間戳 現在',
    enabled: (ctx) => ctx.now() !== null,
    run: (v, ctx) => {
      const seconds = ctx.now()
      if (seconds === null) return
      const token = `[[${stamp(seconds)}]] `
      const { from, to } = v.state.selection.main
      v.dispatch({ changes: { from, to, insert: token }, selection: { anchor: from + token.length } })
      v.focus()
    },
  },
  {
    id: 'transcript',
    label: '引用左邊選取的逐字稿',
    hint: '帶著那句話自己的時間，不是目前播放時間',
    group: '課堂',
    keywords: 'transcript quote 逐字稿 引用 選取',
    enabled: (ctx) => ctx.transcriptQuote() !== null,
    run: (v, ctx) => {
      const picked = ctx.transcriptQuote()
      if (!picked) return
      insertBlock(v, quoteBlock(picked.text, picked.seconds))
    },
  },
]

/** hh:mm:ss without importing the whole time module into the command list. */
function stamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`
}

/**
 * A quoted line of transcript, carrying the moment it was said.
 *
 * The timestamp goes on its own line under the quote rather than inside it, so
 * the quote stays exactly what was said and the link stays clickable.
 */
export function quoteBlock(text: string, seconds: number): string {
  const body = text
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')
  return `${body}\n> — [[${stamp(seconds)}]]\n`
}
