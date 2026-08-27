import { idbHandle } from './idbHandle'

export type RootKind = 'local' | 'opfs'
export type RootStatus = 'none' | 'ready' | 'needs-permission' | 'unsupported'

const HANDLE_KEY = 'root-dir'
const KIND_KEY = 'root-kind'

let cachedRoot: FileSystemDirectoryHandle | null = null
let cachedKind: RootKind | null = null

export function supportsLocalFolder(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

type PermissionCapable = {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<FsPermissionState>
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<FsPermissionState>
}

async function permissionOf(handle: FileSystemDirectoryHandle): Promise<FsPermissionState> {
  // OPFS handles carry no permission model; treat them as always granted.
  const query = (handle as unknown as PermissionCapable).queryPermission
  if (typeof query !== 'function') return 'granted'
  return query.call(handle, { mode: 'readwrite' })
}

function requesterFor(handle: FileSystemDirectoryHandle) {
  const request = (handle as unknown as PermissionCapable).requestPermission
  return typeof request === 'function' ? request.bind(handle) : null
}

/**
 * Reports whether a root is usable right now. A local folder chosen in a
 * previous visit comes back as 'needs-permission': the handle survives, but
 * re-granting access requires a user gesture, so the UI has to ask.
 */
export async function rootStatus(): Promise<RootStatus> {
  const kind = (await idbHandle.get<RootKind>(KIND_KEY)) ?? null
  if (!kind) return 'none'
  if (kind === 'opfs') {
    return typeof navigator.storage?.getDirectory === 'function' ? 'ready' : 'unsupported'
  }
  const handle = await idbHandle.get<FileSystemDirectoryHandle>(HANDLE_KEY)
  if (!handle) return 'none'
  return (await permissionOf(handle)) === 'granted' ? 'ready' : 'needs-permission'
}

export async function currentRootKind(): Promise<RootKind | null> {
  return (await idbHandle.get<RootKind>(KIND_KEY)) ?? null
}

export async function rootName(): Promise<string | null> {
  const kind = await currentRootKind()
  if (kind === 'opfs') return '瀏覽器內建儲存空間'
  const handle = await idbHandle.get<FileSystemDirectoryHandle>(HANDLE_KEY)
  return handle?.name ?? null
}

/** Must be called from a user gesture — the picker requires one. */
export async function pickLocalFolder(): Promise<void> {
  if (!window.showDirectoryPicker) throw new Error('這個瀏覽器不支援選擇本機資料夾，請用 Chrome 或 Edge')
  const handle = await window.showDirectoryPicker({ id: 'ces-notes', mode: 'readwrite' })
  const request = requesterFor(handle)
  if (request && (await request({ mode: 'readwrite' })) !== 'granted') {
    throw new Error('沒有取得資料夾的寫入權限')
  }
  await idbHandle.set(HANDLE_KEY, handle)
  await idbHandle.set(KIND_KEY, 'local')
  cachedRoot = handle
  cachedKind = 'local'
}

/** Fallback for browsers without the folder picker. Subject to storage quota. */
export async function useBrowserStorage(): Promise<void> {
  const handle = await navigator.storage.getDirectory()
  await idbHandle.del(HANDLE_KEY)
  await idbHandle.set(KIND_KEY, 'opfs')
  cachedRoot = handle
  cachedKind = 'opfs'
}

/** Must be called from a user gesture. */
export async function regrantPermission(): Promise<boolean> {
  const handle = await idbHandle.get<FileSystemDirectoryHandle>(HANDLE_KEY)
  if (!handle) return false
  const request = requesterFor(handle)
  if (!request) return false
  const granted = (await request({ mode: 'readwrite' })) === 'granted'
  if (granted) cachedRoot = handle
  return granted
}

export async function forgetRoot(): Promise<void> {
  await idbHandle.del(HANDLE_KEY)
  await idbHandle.del(KIND_KEY)
  cachedRoot = null
  cachedKind = null
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  const kind = (await idbHandle.get<RootKind>(KIND_KEY)) ?? null
  if (!kind) throw new Error('還沒選擇儲存位置，請先到「設定」指定一個資料夾')

  if (cachedRoot && cachedKind === kind) return cachedRoot

  if (kind === 'opfs') {
    cachedRoot = await navigator.storage.getDirectory()
    cachedKind = 'opfs'
    return cachedRoot
  }

  const handle = await idbHandle.get<FileSystemDirectoryHandle>(HANDLE_KEY)
  if (!handle) throw new Error('找不到先前選擇的資料夾，請到「設定」重新指定')
  if ((await permissionOf(handle)) !== 'granted') {
    throw new Error('資料夾的存取權限已失效，請到「設定」按一下重新授權')
  }
  cachedRoot = handle
  cachedKind = 'local'
  return handle
}

/** Walks (and optionally creates) the directories in a "a/b/file.ext" key. */
async function resolveDir(
  key: string,
  create: boolean,
): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
  const parts = key.split('/').filter(Boolean)
  const name = parts.pop()
  if (!name) throw new Error(`無效的檔案路徑：${key}`)
  let dir = await getRoot()
  for (const part of parts) {
    try {
      dir = await dir.getDirectoryHandle(part, { create })
    } catch {
      if (!create) return null
      throw new Error(`無法建立資料夾 ${part}`)
    }
  }
  return { dir, name }
}

export async function writeFile(key: string, data: Blob): Promise<void> {
  const resolved = await resolveDir(key, true)
  if (!resolved) throw new Error(`無法寫入 ${key}`)
  const file = await resolved.dir.getFileHandle(resolved.name, { create: true })
  const stream = await file.createWritable()
  try {
    await stream.write(data)
  } finally {
    await stream.close()
  }
}

export async function readFile(key: string): Promise<File | null> {
  const resolved = await resolveDir(key, false)
  if (!resolved) return null
  try {
    const handle = await resolved.dir.getFileHandle(resolved.name)
    return await handle.getFile()
  } catch {
    return null
  }
}

export async function deleteFile(key: string): Promise<void> {
  const resolved = await resolveDir(key, false)
  if (!resolved) return
  try {
    await resolved.dir.removeEntry(resolved.name)
  } catch {
    // Already gone — deleting an absent file is not an error worth surfacing.
  }
}
