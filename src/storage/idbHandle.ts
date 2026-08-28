// A directory handle is structured-cloneable but not JSON — it needs its own
// tiny IndexedDB store rather than a slot in the settings record.
const DB_NAME = 'ces-fs-handles'
const STORE = 'handles'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (idb) =>
      new Promise<T>((resolve, reject) => {
        const t = idb.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => idb.close()
      }),
  )
}

export const idbHandle = {
  get: <T>(key: string) => tx<T>('readonly', (s) => s.get(key) as IDBRequest<T>),
  set: (key: string, value: unknown) =>
    tx('readwrite', (s) => s.put(value, key) as IDBRequest<IDBValidKey>),
  del: (key: string) => tx('readwrite', (s) => s.delete(key) as IDBRequest<undefined>),
}
