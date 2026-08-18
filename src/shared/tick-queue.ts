/**
 * The shift prep queue's own retry queue: a tick lands here before the first
 * attempt, keeps the same idempotency key across every retry, and leaves only
 * on a confirmed answer or a denial the server will never reverse under that
 * key (ADR 0005, ADR 0020, #42).
 *
 * **The store is injectable and defaulted to the real one**, the same shape
 * `idempotency`, `context` and `shiftAuthority` already take in
 * `src/server/api/route.ts` — a unit test binds `MemoryTickStore`, which is
 * also what a browser with no IndexedDB falls back to
 * (`src/shared/tick-store.browser.ts`), so the fallback and the test seam are
 * the same code rather than two.
 *
 * **What a caught error means is decided once, here, rather than at every tap
 * site.** `src/shared/api-client.ts` already gives the vocabulary: an
 * `OutdatedServerError` is a rollout this container has not caught up to yet
 * and the claim waits; an `OutdatedClientError` is a bundle that cannot ever
 * succeed and the claim waits for a reload rather than being thrown away; any
 * other `ApiError` is a deliberate answer that ADR 0020 says replays
 * identically under the same key forever, so retrying is pointless and the
 * honest move is to say so and let a fresh tap mint a fresh key; anything else
 * — a network failure, most often — is transient, and the claim waits for the
 * next attempt, which is the entire reason this queue exists.
 */
import { ApiError, OutdatedClientError, OutdatedServerError, newIdempotencyKey } from './api-client'
import { now, type Instant } from './time'

/** One claim, on its way to the server or waiting to retry. */
export interface QueuedTick {
  /** Minted once, before the first attempt, and sent unchanged on every retry (ADR 0005). */
  readonly key: string
  readonly shiftId: string
  readonly itemId: string
  readonly queuedAt: Instant
}

/** Where queued claims survive a reload. `src/shared/tick-store.browser.ts` is the real one. */
export interface TickStore {
  list(): Promise<readonly QueuedTick[]>
  put(tick: QueuedTick): Promise<void>
  remove(key: string): Promise<void>
}

/**
 * A store that keeps nothing past the tab it runs in — the fallback for a
 * browser with no IndexedDB (private browsing, an old WebView) and the whole
 * of what a unit test needs. Ticks made under it do not survive a reload,
 * which is the honest degrade: the queue still dedupes and still drains
 * within the session it has.
 */
export class MemoryTickStore implements TickStore {
  private ticks: readonly QueuedTick[] = []

  list(): Promise<readonly QueuedTick[]> {
    return Promise.resolve(this.ticks)
  }

  put(tick: QueuedTick): Promise<void> {
    this.ticks = [...this.ticks.filter((each) => each.key !== tick.key), tick]
    return Promise.resolve()
  }

  remove(key: string): Promise<void> {
    this.ticks = this.ticks.filter((each) => each.key !== key)
    return Promise.resolve()
  }
}

/** What the queue sends with: `client.post` bound to `/items/done`, so a test binds a stub of the same shape. */
export type PostItemDone = (
  body: { readonly shiftId: string; readonly itemId: string },
  options: { readonly idempotencyKey: string },
) => Promise<unknown>

/** Why the queue stopped trying an Item and let a person read the reason instead. */
export interface TickDenial {
  readonly itemId: string
  readonly message: string
}

export type TickListener = () => void

export class TickQueue {
  private readonly pending = new Map<string, QueuedTick>()
  private readonly denials = new Map<string, TickDenial>()
  private readonly listeners = new Set<TickListener>()
  private draining = false
  private blockedFlag = false

  constructor(
    private readonly store: TickStore,
    private readonly post: PostItemDone,
  ) {}

  /** Loads whatever survived a reload or an airplane-mode session (ADR 0005). */
  async init(): Promise<void> {
    for (const tick of await this.store.list()) this.pending.set(tick.key, tick)
    this.notify()
  }

  /** Whether this Item has a claim the server has not yet confirmed. */
  isUnsent(itemId: string): boolean {
    for (const tick of this.pending.values()) {
      if (tick.itemId === itemId) return true
    }
    return false
  }

  /**
   * How many claims this queue has not yet had confirmed — the client's own
   * half of a Shift's close blockers (ADR 0013, #45): the server cannot see
   * Unsent work, so the close screen folds this count in beside the two it
   * reads, through `src/shared/shift-close.ts`'s one pure function.
   */
  get pendingCount(): number {
    return this.pending.size
  }

  /** The last denial against this Item, if the queue has not since taken a fresh claim for it. */
  denialFor(itemId: string): TickDenial | null {
    return this.denials.get(itemId) ?? null
  }

  /** The client is behind the server's version; nothing will send until it reloads. */
  get blocked(): boolean {
    return this.blockedFlag
  }

  subscribe(listener: TickListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  /**
   * Queues "I did this" and tries to send it immediately. Returns once the
   * claim is durable, whether or not it has sent — the caller's optimistic
   * render does not wait on the network.
   */
  async tick(shiftId: string, itemId: string): Promise<void> {
    const claim: QueuedTick = { key: newIdempotencyKey(), shiftId, itemId, queuedAt: now() }
    this.denials.delete(itemId)
    await this.store.put(claim)
    this.pending.set(claim.key, claim)
    this.notify()
    await this.drain()
  }

  /** Sends every queued claim, oldest first, stopping at the first one that must wait. */
  async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      const ordered = [...this.pending.values()].sort(
        (left, right) => left.queuedAt - right.queuedAt,
      )
      for (const claim of ordered) {
        const sent = await this.send(claim)
        if (!sent) return
      }
    } finally {
      this.draining = false
    }
  }

  /** Attempts one claim. Returns whether it left the queue — sent or denied alike. */
  private async send(claim: QueuedTick): Promise<boolean> {
    try {
      await this.post(
        { shiftId: claim.shiftId, itemId: claim.itemId },
        { idempotencyKey: claim.key },
      )
      this.blockedFlag = false
      await this.forget(claim)
      return true
    } catch (error) {
      return this.settle(claim, error)
    }
  }

  private async settle(claim: QueuedTick, error: unknown): Promise<boolean> {
    if (error instanceof OutdatedServerError) {
      // Nothing about this claim is wrong; the container just has not caught
      // up to this build yet. It stays queued (ADR 0005).
      this.notify()
      return false
    }
    if (error instanceof OutdatedClientError) {
      // Retrying under this bundle cannot succeed. The claim stays — a reload
      // is what drains it — and the queue says so rather than losing it.
      this.blockedFlag = true
      this.notify()
      return false
    }
    if (error instanceof ApiError) {
      // A deliberate answer, and ADR 0020 says a repeat under this key gets
      // the same one forever, so holding on to it would only ever replay a
      // refusal. A fresh tap mints a fresh key and is a genuine new attempt.
      this.denials.set(claim.itemId, { itemId: claim.itemId, message: denialText(error) })
      await this.forget(claim)
      return true
    }
    // A network failure, most likely — the one case this queue exists for.
    // The claim waits for the next attempt.
    this.notify()
    return false
  }

  private async forget(claim: QueuedTick): Promise<void> {
    this.pending.delete(claim.key)
    await this.store.remove(claim.key)
    this.notify()
  }
}

function denialText(error: ApiError): string {
  const body: unknown = error.body
  if (typeof body === 'object' && body !== null && 'wanted' in body) {
    const wanted = (body as { wanted?: unknown }).wanted
    if (typeof wanted === 'string') return `This needs ${wanted}.`
  }
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const reason = (body as { error?: unknown }).error
    if (reason === 'not_rostered') return "You aren't on this Shift's roster."
    if (reason === 'medication_authority_required') return 'This needs Medication Authority.'
  }
  return `This didn't send (${String(error.status)}).`
}
