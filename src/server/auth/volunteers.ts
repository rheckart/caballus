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
import { and, eq, isNotNull, isNull } from 'drizzle-orm'

import { forOrg, type OrgId } from '../../db/for-org'
import { releaseSignatures, volunteerAccounts, volunteers } from '../../db/schema'
import { todayIn } from '../../shared/time'
import { grantRoleIn } from '../roster/grants'
import {
  publishReleaseVersion,
  recordReleaseSignature,
  releaseVersionList,
} from '../roster/releases'
import { createVolunteerIn, removeVolunteerIn } from '../roster/records'
import type { Role } from '../api/authorization'

export interface Volunteer {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly mobile: string | null
}

/**
 * An address as this application stores and compares it — case-folded and
 * trimmed once so that the unique index on the column holds.
 *
 * Defined beside the insert in `src/server/roster/records.ts` and re-exported
 * here, so the sign-in path keeps one import and there is one spelling of an
 * address rather than two that agree today.
 */
export { normaliseEmail } from '../roster/records'

import { normaliseEmail } from '../roster/records'

export interface NewVolunteer {
  readonly name: string
  readonly email: string
  readonly mobile?: string | null
}

/**
 * Creates a Volunteer, in a transaction of its own.
 *
 * This is the shape the bootstrap command and the tests need: a Volunteer, with
 * no request behind it and therefore no actor. The Coordinator's version of the
 * same act goes through `/api/v1` and lands in `createVolunteerIn`, which is
 * the one implementation — this only wraps it in a transaction and turns a
 * refusal into a throw, because a caller with no user in front of it has
 * nowhere to put one.
 */
export async function createVolunteer(orgId: OrgId, details: NewVolunteer): Promise<Volunteer> {
  const email = normaliseEmail(details.email)
  const outcome = await forOrg(orgId).run((db) =>
    createVolunteerIn(db, orgId, null, { ...details, email }),
  )
  if (!outcome.ok) {
    throw new Error(`The volunteer for ${email} was not created: ${outcome.because}`)
  }
  return {
    id: outcome.value.id,
    name: outcome.value.name,
    email: outcome.value.email,
    mobile: details.mobile ?? null,
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
 * Confers a role, in a transaction of its own and with no actor behind it.
 *
 * The bootstrap's shape, and the one act that legitimately grants a role
 * without being anybody: ADR 0010's *nobody grants themselves a role* has no
 * subject to bite on when there is nobody there yet, and shell access to the
 * box already implies everything this could do. The audit entry it writes
 * carries a null actor, which is what that column's nullability is for.
 *
 * The decisions — the self-grant guard, the last-`grants`-holder guard, the
 * upsert — are all in `src/server/roster/grants.ts`. This is the wrapper.
 */
export async function grantRole(orgId: OrgId, volunteerId: string, role: Role): Promise<void> {
  const outcome = await forOrg(orgId).run((db) =>
    grantRoleIn(db, orgId, null, { volunteerId, role }),
  )
  if (!outcome.ok) {
    throw new Error(`${role} was not granted to ${volunteerId}: ${outcome.because}`)
  }
}

/**
 * Records the founding President's own release, with no actor behind it —
 * the same bootstrap floor `grantRole` stands on, applied to the one record
 * type ADR 0017 is strictest about (*never self-recorded*, because a
 * volunteer's own word that a paper exists is evidence of nothing). Without
 * it the founding President — the only person who could ever record it —
 * could never clear their own release gate.
 *
 * Idempotent: a Volunteer who already holds a signature is left alone, and an
 * already-published Release Version is signed rather than a second one
 * invented on every rerun of the bootstrap command.
 */
export async function recordFoundingRelease(
  orgId: OrgId,
  volunteerId: string,
  timeZone: string,
): Promise<void> {
  await forOrg(orgId).run(async (db) => {
    const [already] = await db
      .select({ id: releaseSignatures.id })
      .from(releaseSignatures)
      .where(eq(releaseSignatures.volunteerId, volunteerId))
      .limit(1)
    if (already !== undefined) return

    const today = todayIn(timeZone)
    const versions = await releaseVersionList(db)
    const current =
      versions[0] ??
      (await publishReleaseVersion(db, orgId, null, {
        label: 'Release on file at founding',
        validFrom: today,
        obsoletesPrior: false,
      }))

    const outcome = await recordReleaseSignature(db, orgId, null, {
      volunteerId,
      releaseVersionId: current.id,
      signedOn: today,
      byParent: false,
    })
    if (!outcome.ok) {
      throw new Error(
        `The founding release was not recorded for ${volunteerId}: ${outcome.because}`,
      )
    }
  })
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
  await forOrg(orgId).run((db) => removeVolunteerIn(db, orgId, null, { volunteerId }))
}
