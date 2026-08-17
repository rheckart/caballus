/**
 * The Volunteer, which exists before an Account and after it (ADR 0008).
 *
 * The Coordinator creates one from a name and an email address, and it is
 * immediately rosterable — necessary, because ADR 0001 has shifts copying
 * their roster and somebody must be able to roster a person who has not
 * onboarded and may never. Nothing here touches Better Auth; the two are
 * joined only by `claimAccount` below, and only when somebody actually signs
 * in.
 *
 * Everything is scoped through `forOrg`, so the policies of ADR 0007 apply to
 * every read and every write in this file.
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import { forOrg, type OrgId } from '../../db/for-org'
import { volunteerAccounts, volunteerRoles, volunteers } from '../../db/schema'
import type { Role } from '../api/authorization'

export interface Volunteer {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly mobile: string | null
}

/**
 * An address as this application stores and compares it.
 *
 * Case-folded and trimmed once, here, rather than at each call site: the
 * uniqueness of an email within a rescue is a plain unique index, and an index
 * only holds if everything that writes to it agrees on the spelling. Local
 * parts are case-sensitive in the RFC and case-insensitive at every mail
 * provider a volunteer will actually use, and the failure the RFC-correct
 * reading buys is two Volunteers for one person.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export interface NewVolunteer {
  readonly name: string
  readonly email: string
  readonly mobile?: string | null
}

/**
 * Creates a Volunteer. This is the Coordinator's act, and it needs no Account,
 * no code and no login — a name and an email address is the whole of it.
 */
export async function createVolunteer(orgId: OrgId, details: NewVolunteer): Promise<Volunteer> {
  const email = normaliseEmail(details.email)
  const [created] = await forOrg(orgId).run((db) =>
    db
      .insert(volunteers)
      .values({
        id: uuidv7(),
        orgId,
        name: details.name.trim(),
        email,
        mobile: details.mobile ?? null,
      })
      .returning(),
  )
  if (created === undefined) {
    throw new Error(`The volunteer for ${email} was not created`)
  }
  return {
    id: created.id,
    name: created.name,
    email: created.email,
    mobile: created.mobile,
  }
}

/**
 * The Volunteer at this address, or `null`.
 *
 * This is what a code request is gated on. ADR 0008 is deliberate that **an
 * unrecognised address is told it is unrecognised**, against the usual "if
 * that address is registered…" convention: enumerating a sixty-person
 * invite-only roster is not a meaningful threat, and the conventional answer
 * leaves a volunteer standing in a barn waiting for a code that a mistyped
 * character guaranteed would never arrive.
 */
export async function volunteerByEmail(orgId: OrgId, rawEmail: string): Promise<Volunteer | null> {
  const email = normaliseEmail(rawEmail)
  const [found] = await forOrg(orgId).run((db) =>
    db
      .select()
      .from(volunteers)
      // The live one, matching the partial unique index: a rescue may hold
      // several rows for one address over the years, and only one of them is
      // the person who can sign in today.
      .where(and(eq(volunteers.email, email), isNull(volunteers.removedAt)))
      .limit(1),
  )
  if (found === undefined) return null
  return {
    id: found.id,
    name: found.name,
    email: found.email,
    mobile: found.mobile,
  }
}

/**
 * Whether this address belongs to somebody who has left the rescue.
 *
 * Asked only when there is no live Volunteer at it, and asked at all because
 * the two answers are worth telling apart: *we do not have that address* sends
 * somebody hunting for a typo they did not make, and ADR 0008's whole reason
 * for naming an unknown address is that a volunteer should not be left
 * guessing. Removal being a date rather than a delete is what makes this
 * answerable.
 */
export async function hasLeftTheRescue(orgId: OrgId, rawEmail: string): Promise<boolean> {
  const email = normaliseEmail(rawEmail)
  const [gone] = await forOrg(orgId).run((db) =>
    db
      .select({ id: volunteers.id })
      .from(volunteers)
      .where(and(eq(volunteers.email, email), isNotNull(volunteers.removedAt)))
      .limit(1),
  )
  return gone !== undefined
}

/**
 * Confers a role, and with it the Domain Scopes the constant in
 * `src/server/api/authorization.ts` maps it to (ADR 0010).
 *
 * **Grants attach to the Volunteer, never the Account**: a report addressed to
 * `maintenance` has to reach Terry whether or not Terry has ever logged in,
 * and revoking an Account does not vacate a scope.
 *
 * Idempotent, because the primary key already says a person holds a role once.
 */
export async function grantRole(orgId: OrgId, volunteerId: string, role: Role): Promise<void> {
  await forOrg(orgId).run((db) =>
    db
      .insert(volunteerRoles)
      .values({ orgId, volunteerId, role })
      .onConflictDoNothing()
      .returning({ role: volunteerRoles.role }),
  )
}

/**
 * Attaches a Better Auth user to a Volunteer — the Account **claimed** rather
 * than created (ADR 0008).
 *
 * Called after a code has verified, when the address is known to belong to
 * whoever typed the code. A previously revoked link is left revoked: the next
 * code request must not silently undo what an officer decided, which is what
 * an unconditional upsert here would do.
 */
export async function claimAccount(
  orgId: OrgId,
  volunteerId: string,
  userId: string,
): Promise<void> {
  const [held] = await forOrg(orgId).run((db) =>
    db
      .select({ userId: volunteerAccounts.userId, revokedAt: volunteerAccounts.revokedAt })
      .from(volunteerAccounts)
      .where(eq(volunteerAccounts.volunteerId, volunteerId))
      .limit(1),
  )

  if (held !== undefined) {
    if (held.userId !== userId) {
      // A bare `on conflict do nothing` used to swallow this, and the result
      // was the worst answer available: `submitCode` reported success and
      // handed back a session cookie, while every request after it resolved to
      // no membership row and answered 401. Signed in and locked out at the
      // same moment, with nothing written down. It is loud instead — a
      // corrected address or a `user` row recreated by a restore both land
      // here, and both are somebody's decision to make rather than this
      // function's.
      throw new Error(
        `Volunteer ${volunteerId} is already claimed by another identity; ` +
          'revoke the Account before a different one can claim it.',
      )
    }
    // The same identity signing in again, which is every sign-in after the
    // first. A revoked link is left revoked — the gate refused before this.
    return
  }

  await forOrg(orgId).run((db) =>
    db
      .insert(volunteerAccounts)
      .values({ orgId, volunteerId, userId })
      .returning({ userId: volunteerAccounts.userId }),
  )
}

/**
 * Removes a Volunteer from the rescue, and revokes their grants with them
 * (ADR 0010) — the one path where `roster` reaches a grant, which is why it is
 * stated here rather than assumed.
 *
 * A date rather than a delete: the work they did still happened, and it still
 * has to have a subject.
 */
export async function removeVolunteer(orgId: OrgId, volunteerId: string): Promise<void> {
  await forOrg(orgId).run(async (db) => {
    await db
      .update(volunteers)
      .set({ removedAt: sql`now()` })
      .where(eq(volunteers.id, volunteerId))
    await db.delete(volunteerRoles).where(eq(volunteerRoles.volunteerId, volunteerId))
  })
}
