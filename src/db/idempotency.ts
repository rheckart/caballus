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
  /**
   * The path the write was sent to, not the pattern that matched it —
   * `POST /api/v1/horses/alfie/observations`. A collision that names
   * `:horseId` cannot tell a person which horse it was about.
   */
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
  | { readonly kind: 'performed'; readonly answered: Answered }
  | { readonly kind: 'replayed'; readonly answered: Answered; readonly recordedAt: Instant }
  | { readonly kind: 'reused'; readonly firstRoute: string; readonly recordedAt: Instant }
  | { readonly kind: 'unfinished'; readonly recordedAt: Instant }

/**
 * What a write answered, in the two fields this table keeps — and the whole of
 * what it keeps, deliberately.
 *
 * A response is an HTTP object and this module is bookkeeping; it stores a
 * status and a body and has no opinion about headers. The caller turns these
 * back into a response, which is where the knowledge of what a header should
 * say already lives (`src/server/api/answer.ts`), and it does so identically
 * for a first attempt and a replay because there is one function and one call
 * site (#30).
 */
export interface Answered {
  readonly status: number
  readonly body: string
}

export type Work = (db: OrgScopedDatabase) => Promise<Answered>

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

        const answered = await work(db)

        await db
          .update(idempotencyKeys)
          .set({ status: answered.status, response: answered.body })
          .where(
            and(
              eq(idempotencyKeys.orgId, attempt.orgId),
              eq(idempotencyKeys.key, attempt.key),
            ),
          )

        // What is handed back is what was stored, so a first attempt and a
        // replay are the same two fields going the same way out.
        return { kind: 'performed', answered }
      })
    },
  }
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
    answered: { status: first.status, body: first.response },
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
