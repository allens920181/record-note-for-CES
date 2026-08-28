import { db, getSettings, saveSettings } from '../db'

const FORMAT = 'record-note-for-ces/backup'
const VERSION = 1

/**
 * Everything except the audio. The recordings already live in the folder you
 * chose, so they are their own backup — copying tens of gigabytes into a JSON
 * file would make the thing unusable for the one job it has.
 *
 * `settings` and `usage` are left out too: an API key and a quota tally belong
 * to one machine, and restoring them elsewhere would show phantom usage against
 * a key that never sent those requests. The one exception is carried
 * separately below — see `globalGlossary`.
 */
const TABLES = [
  'terms',
  'courses',
  'sessions',
  'recordings',
  'transcripts',
  'notes',
  'attachments',
  'workBlocks',
  'assignments',
  'readings',
  'weekPlans',
  'corrections',
] as const

export interface BackupFile {
  format: string
  version: number
  exportedAt: string
  tables: Record<string, unknown[]>
  /**
   * The cross-course term list.
   *
   * It lives in `settings` next to the API key, so excluding that whole row
   * quietly excluded this — a hand-built list of names and transliterations,
   * exactly the kind of work a backup exists to protect. Carried as its own
   * field so the key and the quota tally stay behind.
   */
  globalGlossary?: string[]
}

export async function buildBackup(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {}
  for (const name of TABLES) {
    tables[name] = await db.table(name).toArray()
  }
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    tables,
    globalGlossary: (await getSettings()).globalGlossary,
  }
}

export function backupBlob(backup: BackupFile): Blob {
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
}

export function backupFileName(): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return `神學院錄音筆記 備份 ${stamp}.json`
}

export interface RestoreResult {
  restored: Record<string, number>
  /** How many global terms came back, so the count can be reported honestly. */
  globalGlossary: number
}

/**
 * Replaces the database with a backup's contents. Settings and the storage
 * handle are left alone: they describe this machine, not the notes.
 */
export async function restoreBackup(file: File): Promise<RestoreResult> {
  let parsed: BackupFile
  try {
    parsed = JSON.parse(await file.text()) as BackupFile
  } catch {
    throw new Error('這不是有效的備份檔（JSON 解析失敗）。')
  }
  if (parsed?.format !== FORMAT) {
    throw new Error('這個檔案不是這個軟體的備份。')
  }
  if (typeof parsed.version !== 'number' || parsed.version > VERSION) {
    throw new Error(`備份檔版本（${parsed.version}）比目前的程式新，請先更新軟體。`)
  }

  const restored: Record<string, number> = {}
  for (const name of TABLES) {
    const rows = parsed.tables?.[name]
    if (!Array.isArray(rows)) continue
    await db.table(name).clear()
    if (rows.length > 0) await db.table(name).bulkAdd(rows)
    restored[name] = rows.length
  }

  // Only this one field: the key and the usage tally stay as they are on this
  // machine. Backups written before this existed simply have nothing to say.
  let globalGlossary = 0
  if (Array.isArray(parsed.globalGlossary)) {
    const terms = parsed.globalGlossary.filter((t): t is string => typeof t === 'string')
    await saveSettings({ globalGlossary: terms })
    globalGlossary = terms.length
  }

  return { restored, globalGlossary }
}

/** Hands the file to the browser's downloader. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
