/**
 * Conferring and revoking what somebody holds: **Roles**, which carry Domain
 * Scopes, and **Medication Authority**, which is not a Domain Scope at all.
 *
 * Roles are stored rows carrying the barn's own words; the mapping from a Role
 * to the scopes it confers is a constant in `src/shared/roles.ts` and never a
 * table (ADR 0010). Officers hold every scope by **enumeration**
 * rather than by a wildcard, so nothing here short-circuits: a President is
 * allowed because `ROLE_SCOPES.president` lists the scope, on the same code
 * path as everybody else.
 *
 * Two guards, both from ADR 0010 and both here rather than in a handler,
 * because they are properties of the grant and not of the endpoint.
 *
 * **Nobody grants themselves a role.** The bootstrap command is the floor —
 * shell access to the box, which already implies everything this could do — and
 * it should stay a floor rather than becoming a routine.
 *
 * **The last holder of `grants` cannot be removed.** An organisation with
 * nobody able to confer a role is an organisation whose only way back is the
 * bootstrap command, and that is a state a form should not be able to reach.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { medicationAuthority, volunteerRoles, volunteers } from '../../db/schema'
import { ROLE_SCOPES, type Role } from '../api/authorization'
import { audit } from './audit'
import { done, refused, type Recorded } from './outcome'

/** The Roles whose scope bundle includes `grants` — the officers, today. */
const GRANTS_ROLES: readonly Role[] = (Object.keys(ROLE_SCOPES) as Role[]).filter((role) =>
  (ROLE_SCOPES[role] as readonly string[]).includes('grants'),
)

/**
 * Confers a Role.
 *
 * Idempotent, because the primary key already says a person holds a Role once,
 * and a Coordinator clicking twice should not be an error. A re-grant refreshes
 * who conferred it and writes a second audit entry, which is honest: somebody
 * did the act twice.
 */
export async function grantRoleIn(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string | null,
  about: { readonly volunteerId: string; readonly role: Role; readonly reason?: string | null },
): Promise<Recorded> {
  // The bootstrap has no actor, and it is the one act that legitimately grants
  // to somebody without being anybody. Every other path has one, and the guard
  // bites there.
  if (actorVolunteerId !== null && actorVolunteerId === about.volunteerId) {
    return refused('self_granted')
  }

  const [volunteer] = await db
    .select({ id: volunteers.id })
    .from(volunteers)
    .where(and(eq(volunteers.id, about.volunteerId), isNull(volunteers.removedAt)))
    .limit(1)
  if (volunteer === undefined) return refused('volunteer_not_found')

  await db
    .insert(volunteerRoles)
    .values({
      orgId,
      volunteerId: about.volunteerId,
      role: about.role,
      grantedBy: actorVolunteerId,
    })
    .onConflictDoUpdate({
      target: [volunteerRoles.orgId, volunteerRoles.volunteerId, volunteerRoles.role],
      set: { grantedBy: actorVolunteerId, grantedAt: sql`now()` },
    })

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'volunteer_role',
      entityId: about.volunteerId,
      before: null,
      after: about.role,
      reason: about.reason ?? null,
    },
  ])

  return done()
}

/**
 * Revokes a Role.
 *
 * A delete rather than a date, unlike almost everything else here, because a
 * Role is a claim about the present rather than a fact about the past — and the
 * audit entry is what keeps the past. That is ADR 0010's reason for putting
 * grants and revocations in the audit log in the first place: a `pg_dump` up to
 * fifteen minutes old can resurrect a revoked session, and a revoked Role has
 * the identical property, so it joins the same line in the restore runbook.
 */
export async function revokeRoleIn(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: { readonly volunteerId: string; readonly role: Role; readonly reason?: string | null },
): Promise<Recorded> {
  const [held] = await db
    .select({ role: volunteerRoles.role })
    .from(volunteerRoles)
    .where(
      and(eq(volunteerRoles.volunteerId, about.volunteerId), eq(volunteerRoles.role, about.role)),
    )
    .limit(1)
  if (held === undefined) return refused('not_held')

  // Excluding this one *grant*, not this one person: somebody holding both
  // President and Board Member still holds `grants` after one of them goes, and
  // refusing there would be the guard firing on a state it was not built for.
  if (
    GRANTS_ROLES.includes(about.role) &&
    !(await someoneStillHoldsGrants(db, [{ volunteerId: about.volunteerId, role: about.role }]))
  ) {
    return refused('last_grants_holder')
  }

  await db
    .delete(volunteerRoles)
    .where(
      and(eq(volunteerRoles.volunteerId, about.volunteerId), eq(volunteerRoles.role, about.role)),
    )

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'volunteer_role',
      entityId: about.volunteerId,
      before: about.role,
      after: null,
      reason: about.reason ?? null,
    },
  ])

  return done()
}

/**
 * Whether anybody would still hold a Role carrying `grants` once `going` is
 * taken away — ADR 0010's *the last holder of `grants` cannot be removed*.
 *
 * It takes the **grants that are about to disappear** rather than a person,
 * because there are two doors to the same state and they remove different
 * things: revoking one Role takes one row, and removing a Volunteer from the
 * rescue takes every row they hold. One predicate, asked by both.
 *
 * Asked of live Volunteers only: somebody who has left the rescue holds nothing
 * — removal revokes their grants — so counting them would let the last officer
 * go on the strength of one who is already gone.
 */
export async function someoneStillHoldsGrants(
  db: OrgScopedDatabase,
  going: readonly { readonly volunteerId: string; readonly role: string }[],
): Promise<boolean> {
  const held = await db
    .select({ volunteerId: volunteerRoles.volunteerId, role: volunteerRoles.role })
    .from(volunteerRoles)
    .innerJoin(volunteers, eq(volunteers.id, volunteerRoles.volunteerId))
    .where(and(inArray(volunteerRoles.role, [...GRANTS_ROLES]), isNull(volunteers.removedAt)))

  // A colon separates the pair, as #29 settled for the fingerprint's map keys:
  // a uuid contains no colon and a Role name is `[a-z_]+`, so the two halves
  // cannot run together into a key that means something else.
  const losing = new Set(going.map((grant) => `${grant.volunteerId}:${grant.role}`))
  return held.some((row) => !losing.has(`${row.volunteerId}:${row.role}`))
}

/** Whether a Role carries `grants` — the officers', today. */
export function carriesGrants(role: string): boolean {
  return (GRANTS_ROLES as readonly string[]).includes(role)
}

/**
 * Confers Medication Authority — **a qualification on the Volunteer, granted
 * under `horse_care`, and not a Domain Scope** (ADR 0010).
 *
 * The check it feeds is *rostered on this Shift, and holds this*, which the
 * Shift model will make when it arrives. Two things make it a grant on a person
 * rather than something a position confers: being permitted to handle Bute is a
 * training fact that does not stop being true between Shifts and is revocable
 * for cause, and a Coordinator building a roster a fortnight out has to be able
 * to ask *will this Shift have Medication Authority present*, which is a
 * question about people.
 *
 * It does **not** require an Orientation. `horse_care` granting this to an
 * un-oriented person is a mistake a human made, and not one the app should be
 * in the business of catching (ADR 0011).
 */
export async function grantMedicationAuthority(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: { readonly volunteerId: string; readonly reason?: string | null },
): Promise<Recorded> {
  const [volunteer] = await db
    .select({ id: volunteers.id })
    .from(volunteers)
    .where(and(eq(volunteers.id, about.volunteerId), isNull(volunteers.removedAt)))
    .limit(1)
  if (volunteer === undefined) return refused('volunteer_not_found')

  await db
    .insert(medicationAuthority)
    .values({ orgId, volunteerId: about.volunteerId, grantedBy: actorVolunteerId })
    .onConflictDoUpdate({
      target: [medicationAuthority.orgId, medicationAuthority.volunteerId],
      set: {
        grantedBy: actorVolunteerId,
        grantedAt: sql`now()`,
        // A re-grant after a revocation is the point of the upsert: the row is
        // kept so that the revocation stays readable, and clearing these two is
        // what makes the qualification current again.
        revokedAt: null,
        revokedBy: null,
      },
    })

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'medication_authority',
      entityId: about.volunteerId,
      before: null,
      after: 'granted',
      reason: about.reason ?? null,
    },
  ])

  return done()
}

/** Revokes it, keeping the row so the revocation is a fact somebody can read. */
export async function revokeMedicationAuthority(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: { readonly volunteerId: string; readonly reason?: string | null },
): Promise<Recorded> {
  const [held] = await db
    .select({ revokedAt: medicationAuthority.revokedAt })
    .from(medicationAuthority)
    .where(eq(medicationAuthority.volunteerId, about.volunteerId))
    .limit(1)
  if (held === undefined || held.revokedAt !== null) return refused('not_held')

  await db
    .update(medicationAuthority)
    .set({ revokedAt: sql`now()`, revokedBy: actorVolunteerId })
    .where(eq(medicationAuthority.volunteerId, about.volunteerId))

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'medication_authority',
      entityId: about.volunteerId,
      before: 'granted',
      after: null,
      reason: about.reason ?? null,
    },
  ])

  return done()
}
