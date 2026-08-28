import { autocompletion } from '@codemirror/autocomplete'
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { NOTE_COMMANDS } from './commands'
import type { NoteContext } from './commands'
import { keyLabel } from './keys'

/**
 * Type `/` and the editor offers what it can do.
 *
 * Markdown's syntax is the barrier this removes: knowing that a heading is
 * `## ` is not knowledge a student should need, and typing `**` on a Chinese
 * keyboard means switching input method for two characters. The menu is the
 * same command list the toolbar and the shortcuts use.
 */
export function slashMenu(ctx: NoteContext) {
  function source(context: CompletionContext): CompletionResult | null {
    const match = context.matchBefore(/\/[^\s/]*/)
    if (!match) return null
    // Only where a command could sensibly start: line start, or after a space.
    const before = context.state.sliceDoc(Math.max(0, match.from - 1), match.from)
    if (match.from > 0 && before.trim() !== '') return null
    if (match.from === match.to && !context.explicit) return null

    const typed = context.state.sliceDoc(match.from + 1, match.to).toLowerCase()
    const options: Completion[] = NOTE_COMMANDS.filter(
      (cmd) =>
        (!cmd.enabled || cmd.enabled(ctx)) &&
        (typed === '' || `${cmd.label} ${cmd.keywords}`.toLowerCase().includes(typed)),
    ).map((cmd) => ({
      label: cmd.label,
      detail: cmd.hint,
      section: cmd.group,
      type: cmd.group === '標記' ? 'keyword' : cmd.group === '課堂' ? 'class' : 'text',
      apply: (view, _completion, from, to) => {
        // Clear the `/query` first: every command works on the real text, and
        // would otherwise wrap or prefix the query itself.
        view.dispatch({ changes: { from, to, insert: '' } })
        cmd.run(view, ctx)
      },
    }))

    if (options.length === 0) return null
    // Our own matching already ran, and it understands the Chinese labels.
    return { from: match.from, options, filter: false }
  }

  return autocompletion({
    override: [source],
    icons: false,
    activateOnTyping: true,
    closeOnBlur: true,
    // The shortcut is printed beside the command it belongs to. Labels are
    // unique, so the command is looked up rather than smuggled through the
    // completion object as an untyped extra field.
    addToOptions: [
      {
        position: 90,
        render: (completion) => {
          const spec = NOTE_COMMANDS.find((c) => c.label === completion.label)?.shortcut
          if (!spec) return null
          const el = document.createElement('span')
          el.className = 'cm-completionKey'
          el.textContent = keyLabel(spec)
          return el
        },
      },
    ],
  })
}
