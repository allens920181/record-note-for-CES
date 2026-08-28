/**
 * Inline styling that markdown has no syntax for.
 *
 * Strikethrough is GFM. Underline, text colour and highlight are not markdown
 * at all, so they are written as the inline HTML every renderer already
 * understands — Obsidian included, which is where these notes are headed.
 *
 * The stored colour is a literal hex so it means something outside this app.
 * Inside it, the editor maps a known hex back to a theme token instead of
 * painting the hex: a dark red on the dark theme's near-black background is
 * unreadable, and a note should not become unreadable when the lights go out.
 */

export interface Swatch {
  id: string
  label: string
  /** What gets written into the markdown. */
  hex: string
}

export const TEXT_COLORS: Swatch[] = [
  { id: 'red', label: '紅', hex: '#9B2C2C' },
  { id: 'amber', label: '橙', hex: '#8A5D0F' },
  { id: 'green', label: '綠', hex: '#1F6F5C' },
  { id: 'blue', label: '藍', hex: '#1F4E79' },
  { id: 'grey', label: '灰', hex: '#6B7A76' },
]

export const HIGHLIGHTS: Swatch[] = [
  { id: 'yellow', label: '黃', hex: '#F7E9A0' },
  { id: 'green', label: '綠', hex: '#CDE9DC' },
  { id: 'blue', label: '藍', hex: '#D3E4F5' },
  { id: 'pink', label: '粉', hex: '#F6D8DE' },
]

export const textColorTag = (hex: string) => `<span style="color:${hex}">`
export const highlightTag = (hex: string) => `<mark style="background:${hex}">`
export const UNDERLINE_OPEN = '<u>'
export const UNDERLINE_CLOSE = '</u>'

/** Every wrapper this editor writes, for "clear formatting" to undo. */
export const INLINE_WRAPPERS: Array<{ open: RegExp; close: string }> = [
  { open: /^<u>$/, close: '</u>' },
  { open: /^<span style="color:[^"]*">$/, close: '</span>' },
  { open: /^<mark style="background:[^"]*">$/, close: '</mark>' },
]

/**
 * The class to paint an opening tag's range with, or null when this is HTML we
 * did not write and have no opinion about.
 */
export function classOf(tag: string): string | null {
  if (tag === UNDERLINE_OPEN) return 'cm-md-u'
  const color = /^<span style="color:\s*([^";]+)\s*">$/.exec(tag)
  if (color) {
    const known = TEXT_COLORS.find((c) => c.hex.toLowerCase() === color[1].toLowerCase())
    // An unknown colour still gets painted, just literally — it came from
    // somewhere else and guessing a token for it would change what it says.
    return known ? `cm-c-${known.id}` : 'cm-c-other'
  }
  const back = /^<mark style="background:\s*([^";]+)\s*">$/.exec(tag)
  if (back) {
    const known = HIGHLIGHTS.find((c) => c.hex.toLowerCase() === back[1].toLowerCase())
    return known ? `cm-hl-${known.id}` : 'cm-hl-other'
  }
  if (tag === '<mark>') return 'cm-hl-yellow'
  return null
}

/** The literal colour for a tag we do not have a token for. */
export function literalColorOf(tag: string): { color?: string; background?: string } | null {
  const color = /^<span style="color:\s*([^";]+)\s*">$/.exec(tag)
  if (color && !TEXT_COLORS.some((c) => c.hex.toLowerCase() === color[1].toLowerCase())) {
    return { color: color[1] }
  }
  const back = /^<mark style="background:\s*([^";]+)\s*">$/.exec(tag)
  if (back && !HIGHLIGHTS.some((c) => c.hex.toLowerCase() === back[1].toLowerCase())) {
    return { background: back[1] }
  }
  return null
}

/** The closing tag that matches an opening one. */
export function closerFor(tag: string): string | null {
  const name = /^<([a-zA-Z]+)[\s>]/.exec(tag) ?? /^<([a-zA-Z]+)>$/.exec(tag)
  return name ? `</${name[1]}>` : null
}
