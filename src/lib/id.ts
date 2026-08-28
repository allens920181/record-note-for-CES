/** Short, sortable, collision-resistant enough for a single-user local app. */
export function newId(prefix: string): string {
  const t = Date.now().toString(36)
  const r = crypto.getRandomValues(new Uint8Array(6))
  const rand = Array.from(r, (b) => b.toString(36).padStart(2, '0')).join('')
  return `${prefix}_${t}${rand}`
}
