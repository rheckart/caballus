/**
 * The other half of ADR 0005: the server records the key with the effect, and
 * treats a repeat as success rather than as a new event.
 *
 * The whole of it is `once`. A caller hands over a key and the work, and gets
 * back what happened — performed, replayed, or refused. It cannot perform the
 * work without offering the key, and it cannot record the key without the work
 * being in the same transaction, because the transaction is opened here and
 * the handle is only ever passed inward. That is the point: ADR 0016 rejects a
 * rule every future handler has to remember, and *remember to record your key*
 * is exactly that rule.
 */
import { and, eq, lt, sql } from 'drizzle-orm'

import { instant, type Instant } from '../shared/time'
import { forOrg, type OrgId, type OrgScopedDatabase } from './for-org'
import { idempotencyKeys } from './schema'

/**
 * How long a key is remembered. ADR 0005 notes that iOS has no Background Sync
 * API, so a queue drains only when somebody opens the app — a volunteer who
 * works Thursday and does not open their phone until the following weekend is
 * ordinary, and the queue is durable in IndexedDB across all of it.
 *
 * Thirty days is chosen against that: comfortably past any queue a person
 * still has an app installed for, and short enough that the table is bounded.
 * At sixty volunteers the arithmetic is not close — a busy shift is a few
 * hundred writes, so a month is tens of thousands of narrow rows.
 *
 * The failure at the far end is real and worth stating: a key replayed after
 * expiry is recorded a second time, which is the double-log this exists to
 * prevent. Thirty days buys a margin, it does not remove the edge. Shortening
 * it is the change that needs an argument.
 */
export const RETENTION_DAYS = 30

/** One attempt at a queueable write, as the wrapper knows it. */
export interface Attempt {
  readonly orgId: OrgId
  /** The key the phone minted before its first attempt. */
  readonly key: string
  /** `POST /observations`. */
  readonly route: string
  /** A digest of the request — `src/server/api/fingerprint.ts`. */
  readonly fingerprint: string
}

/**
 * What happened to an attempt.
 *
 * `reused` is the case neither ADR settles and this one decides: the same key
 * carrying a different request. It is a client bug or a collision, and the one
 * answer it must not get is the first response — that would report success for
 * a write nothing recorded. It is refused, and refused with the first
 * response's route and time so the log says which two requests collided.
 */
export type Outcome =
  | { readonly kind: 'performed'; readonly response: Response }
  | { readonly kind: 'replayed'; readonly response: Response; readonly recordedAt: Instant }
  | { readonly kind: 'reused'; readonly firstRoute: string; readonly recordedAt: Instant }
  | { readonly kind: 'unfinished'; readonly recordedAt: Instant }

export type Work = (db: OrgScopedDatabase) => Promise<Response>

export interface Idempotency {
  /** Runs `work` if this key has not been seen, and answers either way. */
  once(attempt: Attempt, work: Work): Promise<Outcome>
}

/**
 * The real one, against the partial-unique-index argument of ADR 0007 and the
 * table that argument produced.
 */
export function postgresIdempotency(): Idempotency {
  return {
    once(attempt, work) {
      return forOrg(attempt.orgId).run(async (db) => {
        // Claiming the key first is what makes two attempts in flight at once
        // safe: the second blocks on the primary key until the first commits
        // or rolls back, and then sees the truth rather than racing it.
        // `on conflict do nothing` rather than catching the violation, because
        // a violation aborts the transaction and the row we need to read is
        // the thing we would have to read next.
        const [claimed] = await db
          .insert(idempotencyKeys)
          .values({
            orgId: attempt.orgId,
            key: attempt.key,
            route: attempt.route,
            fingerprint: attempt.fingerprint,
          })
          .onConflictDoNothing()
          .returning({ key: idempotencyKeys.key })

        if (claimed === undefined) {
          return recall(db, attempt)
        }

        const response = await work(db)
        // Read once, here, and rebuilt below — a body can only be consumed
        // once, and what is stored has to be what the caller is handed.
        const body = await response.text()

        await db
          .update(idempotencyKeys)
          .set({ status: response.status, response: body })
          .where(
            and(
              eq(idempotencyKeys.orgId, attempt.orgId),
              eq(idempotencyKeys.key, attempt.key),
            ),
          )

        return {
          kind: 'performed',
          response: rebuild(body, response.status, response.headers),
        }
      })
    },
  }
}

/**
 * A response, again, from the body that was read out of it.
 *
 * The empty string rather than `null` is a `TypeError` on 204 and its three
 * siblings, and a handler answering 204 is an ordinary thing to write — so the
 * distinction is made here once rather than crashing the first write that
 * takes it. Exported so the in-memory double answers identically; two copies
 * of this that agree today are two that can disagree later.
 */
export function rebuild(body: string, status: number, headers: HeadersInit): Response {
  return new Response(body === '' ? null : body, { status, headers })
}

/** What the server already answered for a key it has seen before. */
async function recall(db: OrgScopedDatabase, attempt: Attempt): Promise<Outcome> {
  const [first] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.orgId, attempt.orgId), eq(idempotencyKeys.key, attempt.key)))

  if (first === undefined) {
    // The insert conflicted, so a row exists — unless the policies hid it,
    // which would mean the scope changed underneath a transaction that set it.
    throw new Error(`Idempotency key ${attempt.key} conflicted but cannot be read`)
  }

  const recordedAt = instant(first.recordedAt.getTime())

  if (first.fingerprint !== attempt.fingerprint) {
    return { kind: 'reused', firstRoute: first.route, recordedAt }
  }
  if (first.status === null || first.response === null) {
    // Unreachable while the claim and the answer are one transaction. It is
    // handled rather than asserted so the two cannot drift apart quietly: if
    // they ever do, a retry is refused instead of being told nothing happened.
    return { kind: 'unfinished', recordedAt }
  }

  return {
    kind: 'replayed',
    recordedAt,
    // Every response here was built by `json`, which is the only builder the
    // API layer exports, so the type is known without storing it.
    response: rebuild(first.response, first.status, { 'content-type': 'application/json' }),
  }
}

/**
 * Drops keys past their retention, and answers how many. Idempotent, so a
 * missed run costs nothing but a slightly larger table.
 *
 * Not scheduled yet: ADR 0007 puts durable background work on pg-boss, which
 * lands with the jobs that need it, and an in-process interval is the thing
 * that ADR explicitly says is not durable. Until then this is the sweep a
 * person or a cron on the VPS runs, and the table grows at the rate of writes.
 */
export async function forgetKeysPastRetention(
  orgId: OrgId,
  days: number = RETENTION_DAYS,
): Promise<number> {
  return forOrg(orgId).run(async (db) => {
    const dropped = await db
      .delete(idempotencyKeys)
      // Elapsed time, not a calendar day: retention is "thirty days after it
      // was written", which has the same answer in every timezone.
      .where(lt(idempotencyKeys.recordedAt, sql`now() - make_interval(days => ${days})`))
      .returning({ key: idempotencyKeys.key })

    return dropped.length
  })
}
