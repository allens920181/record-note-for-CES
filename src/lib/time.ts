/** 3725.4 → "01:02:05". Always hh:mm:ss so timestamps sort and align. */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return [h, m, r].map((n) => String(n).padStart(2, '0')).join(':')
}

/** "01:02:05" or "02:05" → seconds. Returns null if it isn't a timestamp. */
export function parseTime(text: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!m) return null
  const [, h, mm, ss] = m
  const mins = Number(mm)
  const secs = Number(ss)
  if (mins > 59 || secs > 59) return null
  return (h ? Number(h) * 3600 : 0) + mins * 60 + secs
}

/**
 * Matches the timestamp tokens the note editor makes clickable.
 *
 * A week can hold more than one recording — a break in the middle, a phone that
 * ran out of battery — and each keeps its own clock, so a bare time is ambiguous
 * as soon as there are two. The part is named when there is one to name:
 * `[[第2段 00:12:30]]`. A bare `[[00:12:30]]` is the first recording, which is
 * every token written before this existed and every token in the usual case of
 * a week with one recording.
 */
export const TIMESTAMP_TOKEN = /\[\[(?:第(\d{1,2})段\s*)?(\d{1,2}:\d{2}:\d{2})\]\]/g

/** The token text for a moment, naming the part only when asked to. */
export function stampToken(seconds: number, part?: number): string {
  return part && part > 1 ? `[[第${part}段 ${formatTime(seconds)}]]` : `[[${formatTime(seconds)}]]`
}

/** Reads one token (with or without its brackets) back into part and seconds. */
export function parseStamp(text: string): { part: number; seconds: number } | null {
  const m = /^\[?\[?(?:第(\d{1,2})段\s*)?(\d{1,2}:\d{2}:\d{2})\]?\]?$/.exec(text.trim())
  if (!m) return null
  const seconds = parseTime(m[2])
  if (seconds === null) return null
  return { part: m[1] ? Number(m[1]) : 1, seconds }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h} 小時 ${m} 分` : `${m} 分`
}

/**
 * Durations for the quota meter, where the last minute is the one that matters.
 * `formatDuration` rounds to the nearest minute and renders zero as "—", so 40
 * seconds of headroom reads as a comfortable "1 分" and none left reads as
 * unknown. Here everything rounds down, so the number never promises more room
 * than there is.
 */
export function formatQuota(sec: number): string {
  const whole = Math.max(0, Math.floor(sec))
  if (whole < 60) return `${whole} 秒`
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  return h > 0 ? `${h} 小時 ${m} 分` : `${m} 分`
}

/** Hours between two "HH:MM" times. 0 when either is unparseable or reversed. */
export function hoursBetween(start: string, end: string): number {
  const parse = (t: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim())
    if (!m) return null
    const h = Number(m[1])
    const min = Number(m[2])
    return h > 23 || min > 59 ? null : h * 60 + min
  }
  const from = parse(start)
  const to = parse(end)
  if (from === null || to === null || to <= from) return 0
  return Math.round(((to - from) / 60) * 10) / 10
}
