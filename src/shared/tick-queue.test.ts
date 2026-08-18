/**
 * The retry queue, at the typed-client seam: `post` is stubbed to the same
 * shape `client.post` bound to `/items/done` has, and nothing here touches
 * `fetch` or a real store — `MemoryTickStore` is what a reload is simulated
 * with, by pointing two queues at the same instance (#42).
 */
import { describe, expect, it, vi } from 'vitest'

import { ApiError, OutdatedClientError, OutdatedServerError } from './api-client'
import { MemoryTickStore, TickQueue, type PostItemDone } from './tick-queue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('TickQueue', () => {
  it('lands a tick optimistically and drains it through the typed client', async () => {
    const store = new MemoryTickStore()
    const post = vi.fn<PostItemDone>().mockResolvedValue({ itemOutcomeId: 'outcome-1' })
    const queue = new TickQueue(store, post)

    await queue.tick('shift-1', 'item-1')

    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(
      { shiftId: 'shift-1', itemId: 'item-1' },
      { idempotencyKey: expect.any(String) },
    )
    expect(queue.isUnsent('item-1')).toBe(false)
    expect(await store.list()).toEqual([])
  })

  it('keeps a tick Unsent while it cannot reach the server, and never marks it Done', async () => {
    const store = new MemoryTickStore()
    const post = vi.fn<PostItemDone>().mockRejectedValue(new TypeError('network unreachable'))
    const queue = new TickQueue(store, post)

    await queue.tick('shift-1', 'item-1')

    expect(queue.isUnsent('item-1')).toBe(true)
    expect((await store.list()).map((tick) => tick.itemId)).toEqual(['item-1'])
  })

  it('counts pending claims, and clears back to zero once they send (#45)', async () => {
    const store = new MemoryTickStore()
    const post = vi.fn<PostItemDone>().mockRejectedValueOnce(new TypeError('network unreachable'))
    const queue = new TickQueue(store, post)

    await queue.tick('shift-1', 'item-1')
    expect(queue.pendingCount).toBe(1)

    post.mockResolvedValueOnce({ itemOutcomeId: 'outcome-1' })
    await queue.drain()
    expect(queue.pendingCount).toBe(0)
  })

  it('keeps the same idempotency key across every retry', async () => {
    const store = new MemoryTickStore()
    let firstKey: string | null = null
    const post = vi.fn<PostItemDone>().mockImplementation((_body, options) => {
      firstKey ??= options.idempotencyKey
      return Promise.reject(new TypeError('offline'))
    })
    const queue = new TickQueue(store, post)

    await queue.tick('shift-1', 'item-1')
    expect(firstKey).not.toBeNull()

    post.mockResolvedValueOnce({ itemOutcomeId: 'outcome-1' })
    await queue.drain()

    expect(post).toHaveBeenLastCalledWith(
      { shiftId: 'shift-1', itemId: 'item-1' },
      { idempotencyKey: firstKey },
    )
    expect(queue.isUnsent('item-1')).toBe(false)
  })

  it('survives a reload: a fresh queue over the same store finds the airplane-mode tick and drains it once connectivity returns', async () => {
    const store = new MemoryTickStore()
    const offline = vi.fn<PostItemDone>().mockRejectedValue(new TypeError('offline'))
    const before = new TickQueue(store, offline)
    await before.tick('shift-1', 'apollo-feed')

    expect((await store.list())[0]?.itemId).toBe('apollo-feed')

    // The "reload": a new queue, the same durable store, nothing carried over
    // in memory.
    const online = vi.fn<PostItemDone>().mockResolvedValue({ itemOutcomeId: 'outcome-1' })
    const after = new TickQueue(store, online)
    await after.init()
    expect(after.isUnsent('apollo-feed')).toBe(true)

    await after.drain()

    expect(online).toHaveBeenCalledTimes(1)
    expect(after.isUnsent('apollo-feed')).toBe(false)
    expect(await store.list()).toEqual([])
  })

  it('records exactly one tick server-side worth of attempts once connectivity returns, however many retries it took', async () => {
    const store = new MemoryTickStore()
    let attempts = 0
    const post = vi.fn<PostItemDone>().mockImplementation(() => {
      attempts += 1
      if (attempts < 3) return Promise.reject(new TypeError('offline'))
      return Promise.resolve({ itemOutcomeId: 'outcome-1' })
    })
    const queue = new TickQueue(store, post)

    await queue.tick('shift-1', 'item-1')
    await queue.drain()
    await queue.drain()

    expect(attempts).toBe(3)
    expect(post).toHaveBeenNthCalledWith(1, expect.anything(), {
      idempotencyKey: expect.any(String),
    })
    const keys = post.mock.calls.map((call) => call[1].idempotencyKey)
    expect(new Set(keys).size).toBe(1)
    expect(queue.isUnsent('item-1')).toBe(false)
  })

  it('keeps a claim queued when the server is behind this client’s version', async () => {
    const store = new MemoryTickStore()
    const post = vi
      .fn<PostItemDone>()
      .mockRejectedValue(new OutdatedServerError(400, { error: 'unsupported_api_version' }, 'v0'))
    const queue = new TickQueue(store, post)

    await queue.tick('shift-1', 'item-1')

    expect(queue.isUnsent('item-1')).toBe(true)
    expect(queue.blocked).toBe(false)
  })

  it('surfaces an outdated client rather than retrying forever, and keeps the claim queued for the reload', async () => {
    const store = new MemoryTickStore()
    const post = vi
      .fn<PostItemDone>()
      .mockRejectedValue(new OutdatedClientError(400, { error: 'unsupported_api_version' }, 'v2'))
    const queue = new TickQueue(store, post)

    await queue.tick('shift-1', 'item-1')

    expect(queue.blocked).toBe(true)
    expect(queue.isUnsent('item-1')).toBe(true)
  })

  it('refuses Medication Authority explicitly, and stops holding the claim under a key that will only replay the same refusal', async () => {
    const store = new MemoryTickStore()
    const post = vi
      .fn<PostItemDone>()
      .mockRejectedValue(new ApiError(409, { error: 'medication_authority_required' }))
    const queue = new TickQueue(store, post)

    await queue.tick('shift-1', 'medicate-1')

    expect(queue.isUnsent('medicate-1')).toBe(false)
    expect(queue.denialFor('medicate-1')?.message).toMatch(/Medication Authority/)
    expect(await store.list()).toEqual([])
  })

  it('notifies subscribers as a tick queues, drains and is denied', async () => {
    const store = new MemoryTickStore()
    const post = vi.fn<PostItemDone>().mockResolvedValue({ itemOutcomeId: 'outcome-1' })
    const queue = new TickQueue(store, post)
    const heard: number[] = []
    queue.subscribe(() => heard.push(heard.length))

    await queue.tick('shift-1', 'item-1')

    expect(heard.length).toBeGreaterThan(0)
  })

  it('does not send a second claim for an Item while the first is still in flight', async () => {
    const store = new MemoryTickStore()
    const first = deferred<unknown>()
    const post = vi
      .fn<PostItemDone>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ itemOutcomeId: 'outcome-2' })
    const queue = new TickQueue(store, post)

    const inFlight = queue.tick('shift-1', 'item-1')
    // A drain triggered while the first attempt has not settled — the online
    // listener firing twice in a row, say — must not send a second copy.
    const overlapping = queue.drain()
    first.resolve({ itemOutcomeId: 'outcome-1' })
    await Promise.all([inFlight, overlapping])

    expect(post).toHaveBeenCalledTimes(1)
  })
})
