/**
 * Keyboard shortcuts, written the way this machine's keyboard actually reads.
 *
 * The workspace had one shortcut printed on screen — `⌥T` — which is simply
 * wrong on Windows, where that key says Alt. Shortcuts are defined once in
 * CodeMirror's own notation and formatted here, so a binding and its label
 * cannot drift apart.
 */
const MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

const NAMED: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: MAC ? '↩' : 'Enter',
  Escape: 'Esc',
}

/** `Mod-b` → `⌘B` on a Mac, `Ctrl+B` everywhere else. */
export function keyLabel(spec: string): string {
  const parts = spec.split('-')
  const key = parts.pop() ?? ''
  const mods = parts.map((mod) => {
    if (mod === 'Mod') return MAC ? '⌘' : 'Ctrl'
    if (mod === 'Alt') return MAC ? '⌥' : 'Alt'
    if (mod === 'Shift') return MAC ? '⇧' : 'Shift'
    if (mod === 'Ctrl') return MAC ? '⌃' : 'Ctrl'
    return mod
  })
  const tail = NAMED[key] ?? (key.length === 1 ? key.toUpperCase() : key)
  return MAC ? [...mods, tail].join('') : [...mods, tail].join('+')
}
