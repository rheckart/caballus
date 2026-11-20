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
import { releaseSignatures, users, volunteerAccounts, volunteers } from '../../db/schema'
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
import { normaliseMobile } from '../../shared/mobile'

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
 * The Volunteer at this number, or `null` — the twin of `volunteerByEmail`
 * (#78, ADR 0029).
 *
 * The same gate and the same candour: an unrecognised number is told it is
 * unrecognised, for ADR 0008's own reason. A number that cannot be read as one
 * at all is `null` here too, and the screen says the same thing about it —
 * *check it for a typo* is the right sentence for both.
 */
export async function volunteerByMobile(
  orgId: OrgId,
  rawMobile: string,
): Promise<Volunteer | null> {
  const mobile = normaliseMobile(rawMobile)
  if (mobile === null) return null

  const [found] = await forOrg(orgId).run((db) =>
    db
      .select()
      .from(volunteers)
      // The live one, matching `volunteers_mobile_in_org`: a number may be
      // reused across the years, and only one row is the person signing in.
      .where(and(eq(volunteers.mobile, mobile), isNull(volunteers.removedAt)))
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

/** Whether this number belongs to somebody who has left the rescue. */
export async function hasLeftTheRescueByMobile(orgId: OrgId, rawMobile: string): Promise<boolean> {
  const mobile = normaliseMobile(rawMobile)
  if (mobile === null) return false

  const [gone] = await forOrg(orgId).run((db) =>
    db
      .select({ id: volunteers.id })
      .from(volunteers)
      .where(and(eq(volunteers.mobile, mobile), isNotNull(volunteers.removedAt)))
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
 * The reserved, undeliverable domain every Account is keyed at (ADR 0030).
 *
 * `.invalid` is RFC 2606's: no resolver will ever answer for it, so an address
 * here can never be delivered to anybody, whatever a future library version
 * decides to send. Better Auth checks the address it is given with `z.email()`,
 * which accepts it — spiked against the installed version before this was
 * written, and pinned by `src/server/auth/one-rescue.test.ts`, which signs in
 * through it.
 */
export const ACCOUNT_KEY_DOMAIN = 'account.invalid'

/**
 * The address Better Auth's `user` row is keyed by: the Volunteer's id at a
 * domain nobody can receive mail at (ADR 0030).
 *
 * **An Account belongs to one rescue, and this is what makes it so.**
 * `user.email` is unique across the whole database while `volunteers.email` is
 * unique only within one organisation, so an Account keyed by a real address is
 * a door between rescues: rescue B's Volunteer carrying rescue A's officer's
 * address would sign in as A's `user`. Keyed by a Volunteer id, a `user` can
 * only ever be the Account of the one Volunteer it was minted for, and
 * `actorForUser` at any other organisation finds no `volunteer_accounts` row
 * and answers nobody.
 *
 * The real address stays on `volunteers`, where it always lived: it is where a
 * code is **sent**. This is where it is **checked**.
 */
export function accountKey(volunteerId: string): string {
  return `${volunteerId}@${ACCOUNT_KEY_DOMAIN}`
}

/** Whether this address is an Account key rather than somebody's inbox. */
export function isAccountKey(email: string): boolean {
  return email.toLowerCase().endsWith(`@${ACCOUNT_KEY_DOMAIN}`)
}

/**
 * What Better Auth is asked about when this Volunteer signs in — never what was
 * typed, and never `volunteers.email` (ADR 0030).
 *
 * One rule for both sides of the rewrite that moves every `user.email` to its
 * key. A Volunteer who has claimed an Account is checked against **that `user`
 * row's current `email`**, read through `volunteer_accounts.user_id`: before
 * the rewrite it is the real address it was claimed under, after it is the
 * key, and either way it lands on the same row. A Volunteer with no Account yet
 * is checked against `accountKey`, so the `user` Better Auth creates for them is
 * keyed by them from the first sign-in.
 *
 * That is what closes the hole. Nothing a rescue can type resolves to a `user`
 * its own Volunteer did not claim: the lookup starts from this organisation's
 * Volunteer, and `volunteer_accounts` is scoped to it. A revoked link is still
 * followed, deliberately — the gate refuses before this is asked, and resolving
 * a revoked Volunteer to a fresh key would mint a second `user` that
 * `claimAccount` then refuses.
 */
export async function accountIdentifier(orgId: OrgId, volunteerId: string): Promise<string> {
  const [claimed] = await forOrg(orgId).run((db) =>
    db
      .select({ email: users.email })
      .from(volunteerAccounts)
      .innerJoin(users, eq(users.id, volunteerAccounts.userId))
      .where(eq(volunteerAccounts.volunteerId, volunteerId))
      .limit(1),
  )
  return claimed?.email ?? accountKey(volunteerId)
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
