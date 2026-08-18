/**
 * The real `TickStore` (#42): IndexedDB, which is what makes a claim survive
 * a reload and an airplane-mode session across a phone locking and unlocking
 * — the property `src/shared/tick-queue.ts`'s own store cannot give.
 *
 * The twin of `src/shared/observability.browser.ts` in shape: one module that
 * knows the browser API, imported only from the phone's own routes, with
 * everything testable sitting in the module that does not know it.
 *
 * `resolveTickStore` is what a route actually calls, and it is the fallback
 * that makes this whole file optional: a browser with no IndexedDB — private
 * browsing in some engines, an old WebView — gets `MemoryTickStore` instead,
 * which is the honest degrade (the queue still dedupes and still drains
 * within the session it has) rather than a crash on the first tap.
 */
import { MemoryTickStore, type QueuedTick, type TickStore } from './tick-queue'

const DB_NAME = 'caballus-tick-queue'
const STORE_NAME = 'ticks'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed to open.'))
  })
}

function requestOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

/** One IndexedDB database, opened once and reused for every call this store makes. */
export class IndexedDbTickStore implements TickStore {
  private opened: Promise<IDBDatabase> | null = null

  private db(): Promise<IDBDatabase> {
    this.opened ??= openDb()
    return this.opened
  }

  async list(): Promise<readonly QueuedTick[]> {
    const db = await this.db()
    const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME)
    return requestOf(store.getAll() as IDBRequest<QueuedTick[]>)
  }

  async put(tick: QueuedTick): Promise<void> {
    const db = await this.db()
    const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME)
    await requestOf(store.put(tick))
  }

  async remove(key: string): Promise<void> {
    const db = await this.db()
    const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME)
    await requestOf(store.delete(key))
  }
}

/**
 * The store a route actually reaches for. IndexedDB where the browser has
 * one; otherwise the same in-memory store the unit tests bind, so the tick
 * still queues and drains within the tab it runs in.
 */
export function resolveTickStore(): TickStore {
  return typeof indexedDB === 'undefined' ? new MemoryTickStore() : new IndexedDbTickStore()
}
