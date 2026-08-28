import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import type { Range } from '@codemirror/state'
import { MARK_LINE } from './marks'

/**
 * Draws markdown as the thing it means, inside the editor.
 *
 * The note pane was a plain source view: a heading looked exactly like a
 * paragraph with a `#` in front of it, so the structure you were building was
 * invisible while you built it. This paints headings, emphasis, quotes, lists,
 * task boxes and 標記 callouts, and — the part that makes it feel like an
 * editor rather than a preview — hides the syntax markers on every line except
 * the one the cursor is on, so you can still see and fix the raw text of the
 * line you are actually editing.
 */

class TextWidget extends WidgetType {
  text: string
  cls: string

  constructor(text: string, cls: string) {
    super()
    this.text = text
    this.cls = cls
  }

  eq(other: TextWidget) {
    return other.text === this.text && other.cls === this.cls
  }

  toDOM() {
    const el = document.createElement('span')
    el.className = this.cls
    el.textContent = this.text
    return el
  }
}

class CheckboxWidget extends WidgetType {
  // A plain field, not a parameter property: `erasableSyntaxOnly` is on, and
  // parameter properties are the one bit of TS that emits real code.
  checked: boolean

  constructor(checked: boolean) {
    super()
    this.checked = checked
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked
  }

  toDOM() {
    const box = document.createElement('span')
    box.className = `cm-task${this.checked ? ' is-done' : ''}`
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', String(this.checked))
    box.textContent = this.checked ? '✓' : ''
    return box
  }

  ignoreEvent() {
    return false
  }
}

const HEADING = /^ATXHeading(\d)$/

/** Which lines the cursor touches — those keep their markers visible. */
function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>()
  for (const range of view.state.selection.ranges) {
    const from = view.state.doc.lineAt(range.from).number
    const to = view.state.doc.lineAt(range.to).number
    for (let n = from; n <= to; n++) lines.add(n)
  }
  return lines
}

function build(view: EditorView): DecorationSet {
  const deco: Range<Decoration>[] = []
  const active = activeLines(view)
  const { doc } = view.state

  /** Hide a syntax marker, unless the reader is on that line. */
  const marker = (from: number, to: number) => {
    if (from >= to) return
    const line = doc.lineAt(from).number
    deco.push(
      active.has(line)
        ? Decoration.mark({ class: 'cm-md-mark' }).range(from, to)
        : Decoration.replace({}).range(from, to),
    )
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const heading = HEADING.exec(node.name)
        if (heading) {
          const line = doc.lineAt(node.from)
          deco.push(
            Decoration.line({ class: `cm-md-h cm-md-h${heading[1]}` }).range(line.from),
          )
          return
        }
        switch (node.name) {
          case 'HeaderMark':
          case 'QuoteMark':
          case 'EmphasisMark':
          case 'CodeMark':
          case 'StrikethroughMark':
          case 'LinkMark':
            marker(node.from, node.to)
            break
          case 'ListMark': {
            // Ordered lists carry meaning in the number, so only the bullet
            // character is swapped for a real bullet.
            const text = doc.sliceString(node.from, node.to)
            if (/^[-*+]$/.test(text)) {
              deco.push(
                Decoration.replace({ widget: new TextWidget('•', 'cm-md-bullet') }).range(
                  node.from,
                  node.to,
                ),
              )
            }
            break
          }
          case 'StrongEmphasis':
            deco.push(Decoration.mark({ class: 'cm-md-strong' }).range(node.from, node.to))
            break
          case 'Emphasis':
            deco.push(Decoration.mark({ class: 'cm-md-em' }).range(node.from, node.to))
            break
          case 'Strikethrough':
            deco.push(Decoration.mark({ class: 'cm-md-strike' }).range(node.from, node.to))
            break
          case 'InlineCode':
            deco.push(Decoration.mark({ class: 'cm-md-code' }).range(node.from, node.to))
            break
          case 'TaskMarker': {
            const checked = /x/i.test(doc.sliceString(node.from, node.to))
            deco.push(
              Decoration.replace({ widget: new CheckboxWidget(checked) }).range(
                node.from,
                node.to,
              ),
            )
            break
          }
          case 'HorizontalRule':
            deco.push(Decoration.line({ class: 'cm-md-rule' }).range(doc.lineAt(node.from).from))
            break
          default:
            break
        }
      },
    })
  }

  // Callouts are a property of consecutive quote lines, which the syntax tree
  // reports one blockquote at a time — simpler to read line by line.
  const first = doc.lineAt(view.visibleRanges[0]?.from ?? 0).number
  const last = doc.lineAt(view.visibleRanges[view.visibleRanges.length - 1]?.to ?? 0).number
  let kind: string | null = null
  for (let n = Math.max(1, first - 40); n <= last; n++) {
    if (n > doc.lines) break
    const line = doc.line(n)
    const opened = MARK_LINE.exec(line.text)
    if (opened) kind = opened[1]
    else if (!/^>/.test(line.text)) kind = null
    if (!kind || n < first) continue
    deco.push(
      Decoration.line({ class: `cm-callout cm-callout-${kind}${opened ? ' is-open' : ''}` }).range(
        line.from,
      ),
    )
    // `[!重點]` is plain text as far as the markdown parser is concerned, so
    // the tree walk leaves it on screen. Swap it for the label it stands for.
    if (opened) {
      const at = line.text.indexOf('[!')
      const end = line.text.indexOf(']', at)
      if (at >= 0 && end > at) {
        deco.push(
          active.has(n)
            ? Decoration.mark({ class: 'cm-md-mark' }).range(line.from + at, line.from + end + 1)
            : Decoration.replace({
                widget: new TextWidget(kind, `cm-callout-label cm-callout-label-${kind}`),
              }).range(line.from + at, line.from + end + 1),
        )
      }
    }
  }

  return Decoration.set(deco, true)
}

export const richMarkdown = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(update: ViewUpdate) {
      // selectionSet matters as much as docChanged: moving the cursor onto a
      // line is what brings that line's markers back.
      //
      // And so does the tree itself. Markdown is parsed incrementally, so a
      // change can land before the parser has caught up — the decorations
      // would then be built from a tree that does not know about the line just
      // typed, and nothing would ever ask again. A freshly typed `- [ ] ` came
      // out as plain text for exactly this reason.
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = build(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(event, view) {
        const el = event.target as HTMLElement | null
        if (!el?.classList.contains('cm-task')) return false
        const pos = view.posAtDOM(el)
        const line = view.state.doc.lineAt(pos)
        const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(line.text)
        if (!m) return false
        event.preventDefault()
        const at = line.from + m[1].length
        view.dispatch({
          changes: { from: at, to: at + 1, insert: m[2] === ' ' ? 'x' : ' ' },
        })
        return true
      },
    },
  },
)
