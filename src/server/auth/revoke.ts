/**
 * Revocation, which with permanent sessions is the entire security model
 * (ADR 0008).
 *
 * It is two acts committed as one decision: the membership link is marked
 * revoked, and every session row the user holds is deleted. Neither alone is
 * enough. Deleting the sessions without marking the link would let the next
 * code request silently re-claim the Account; marking the link without
 * deleting the sessions would leave rows behind that a person reading the
 * table would have to reason about.
 *
 * **Revoking an Account does not vacate a scope, and it does not delete the
 * Volunteer** (ADR 0010, 0008). The work they did still happened, the reports
 * addressed to a Domain Scope they hold still reach them, and the Coordinator
 * has taken away exactly the thing they meant to.
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import { forOrg, type OrgId } from '../../db/for-org'
import { volunteerAccounts } from '../../db/schema'
import { log } from '../observability'
import { auth } from './auth'

export interface Revocation {
  /** Whether there was a live Account to revoke at all. */
  readonly revoked: boolean
  /** How many session rows were deleted, for the line the operator reads. */
  readonly sessionsEnded: number
}

/**
 * Revokes a Volunteer's Account. An officer's act, under `roster`.
 *
 * Idempotent: revoking twice is not an error, it is the second one finding
 * nothing live. That matters because this runs from an admin screen somebody
 * may double-tap while unsure whether the first one worked.
 *
 * The audit trail is the structured log plus the `revoked_at` on the row. ADR
 * 0008 puts revocations in the audit log because a `pg_dump` up to fifteen
 * minutes old can resurrect a revoked session, and **re-applying revocations
 * made since the dump is a line in the restore runbook** — the mark on the row
 * is what makes that line answerable.
 */
export async function revokeAccount(orgId: OrgId, volunteerId: string): Promise<Revocation> {
  const revokedRows = await forOrg(orgId).run((db) =>
    db
      .update(volunteerAccounts)
      .set({ revokedAt: sql`now()` })
      .where(
        // Only a live one. A second revocation must not rewrite the instant
        // the first one happened.
        and(eq(volunteerAccounts.volunteerId, volunteerId), isNull(volunteerAccounts.revokedAt)),
      )
      .returning({ userId: volunteerAccounts.userId }),
  )

  const user = revokedRows[0]
  if (user === undefined) {
    log('info', 'account_revocation', { volunteerId, orgId, outcome: 'nothing_live' })
    return { revoked: false, sessionsEnded: 0 }
  }

  const ended = await endSessions(user.userId)
  log('warn', 'account_revocation', {
    volunteerId,
    orgId,
    outcome: 'revoked',
    sessionsEnded: ended,
  })
  return { revoked: true, sessionsEnded: ended }
}

/**
 * Deletes every session a user holds, and says how many there were.
 *
 * Through Better Auth's own adapter rather than a delete of our own: `session`
 * is one of the three tables it owns (ADR 0008), and a second writer to
 * somebody else's table is the thing that breaks quietly on an upgrade.
 */
async function endSessions(userId: string): Promise<number> {
  const context = await auth().$context
  const held = await context.internalAdapter.listSessions(userId)
  await context.internalAdapter.deleteUserSessions(userId)
  return held.length
}

/**
 * Un-revokes an Account, so that the next code request can claim it again.
 *
 * The counterpart of a revocation made in error, and deliberately not a
 * "restore the sessions" — the sessions are gone, and whoever was signed out
 * signs in again with a code. There is no path in this application that hands
 * somebody a session they did not authenticate for.
 */
export async function restoreAccount(orgId: OrgId, volunteerId: string): Promise<boolean> {
  const restored = await forOrg(orgId).run((db) =>
    db
      .update(volunteerAccounts)
      .set({ revokedAt: null })
      .where(
        // Only one that was actually revoked. Restoring an Account nobody
        // switched off would write a `account_restored` line answering to no
        // revocation — noise in the one record the restore runbook relies on
        // being readable (ADR 0008).
        and(eq(volunteerAccounts.volunteerId, volunteerId), isNotNull(volunteerAccounts.revokedAt)),
      )
      .returning({ userId: volunteerAccounts.userId }),
  )
  if (restored.length > 0) {
    log('warn', 'account_restored', { volunteerId, orgId })
  }
  return restored.length > 0
}
