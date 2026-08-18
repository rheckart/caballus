/**
 * The Coordinator's acts on a Volunteer's record: creating one, establishing a
 * date of birth, ticking an Orientation, recording a Consent, and removing
 * somebody from the rescue.
 *
 * Everything here takes the scoped transaction `mutation` opened rather than
 * opening one, so the effect, its idempotency key and its audit entry commit
 * together or not at all (ADR 0020).
 *
 * **Every refusal is a named outcome rather than a thrown error.** These are
 * refusals a person can cause from a form — an Orientation ticked twice, a
 * release somebody tried to record about themselves — and a 500 would tell the
 * Coordinator nothing about which. The handler turns the name into a status.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import {
  shiftPatternRoster,
  shiftRoster,
  volunteerConsents,
  volunteerRoles,
  volunteers,
} from '../../db/schema'
import { rosterability } from '../../shared/rostering'
import { type DayString } from '../../shared/time'
import { audit, type AuditEntry } from './audit'
import { gatesFor } from './gates'
import { carriesGrants, someoneStillHoldsGrants } from './grants'
import { recorded, refused, type Recorded } from './outcome'

/** Re-exported so a handler has one import for a write and its outcome. */
export { type Recorded, type Refusal } from './outcome'

/**
 * How a date of birth was established (ADR 0017). The rescue requires photo ID
 * from every volunteer and candidate; for a minor without one, the parent
 * provides the date.
 *
 * **The app never holds the identity document** — no image, no number, no
 * issuing state. The provenance is the whole of what the sighting leaves
 * behind, and that is deliberate rather than an omission: sixty licence scans
 * would be the highest-value target in the system and would assert nothing this
 * does not.
 */
export const DATE_OF_BIRTH_PROVENANCE = ['photo_id', 'parent_provided'] as const

export type DateOfBirthProvenance = (typeof DATE_OF_BIRTH_PROVENANCE)[number]

/**
 * An address as this application stores and compares it.
 *
 * Case-folded and trimmed once, here, rather than at each call site: the
 * uniqueness of an email within a rescue is a plain unique index, and an index
 * only holds if everything that writes to it agrees on the spelling. Local
 * parts are case-sensitive in the RFC and case-insensitive at every mail
 * provider a volunteer will actually use, and the failure the RFC-correct
 * reading buys is two Volunteers for one person.
 *
 * It lives beside the insert rather than beside the sign-in that also reads it,
 * because this is the module that writes the column the index is on — and
 * `src/server/auth/volunteers.ts` re-exports it so the sign-in path keeps its
 * one import.
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
 * Creates a Volunteer — the Coordinator's act, and **it needs no Account, no
 * code and no login**. A name and an email address is the whole of it (ADR
 * 0008), because ADR 0001 has Shifts copying their roster and somebody must be
 * able to roster a person who has not onboarded and may never.
 *
 * The state that results is a **Candidate**: a Volunteer without an
 * Orientation, which is the Coordinator's to-do list and not a separate kind of
 * person.
 */
export async function createVolunteerIn(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string | null,
  details: NewVolunteer,
): Promise<Recorded<{ id: string; name: string; email: string }>> {
  const email = normaliseEmail(details.email)
  const name = details.name.trim()

  // Checked rather than caught, so that the Coordinator gets *that address is
  // already somebody's* instead of a raw unique violation for an action the app
  // would then have no way to explain. The index is still the thing that holds:
  // this is the message, not the guarantee.
  const [taken] = await db
    .select({ id: volunteers.id })
    .from(volunteers)
    .where(and(eq(volunteers.email, email), isNull(volunteers.removedAt)))
    .limit(1)
  if (taken !== undefined) return refused('email_taken')

  const id = uuidv7()
  await db
    .insert(volunteers)
    .values({ id, orgId, name, email, mobile: details.mobile ?? null })
    .returning({ id: volunteers.id })

  await audit(db, orgId, actorVolunteerId, [
    // No field: the record as a whole came into being, and naming one field of
    // it would be arbitrary.
    { entity: 'volunteer', entityId: id, after: name },
  ])

  return recorded({ id, name, email })
}

/**
 * Records the date of birth and how it was established.
 *
 * A precondition of the Orientation tick rather than a fourth gate: the person
 * who sights the ID is the person who ticks the Orientation, at the same desk,
 * in the same minute (ADR 0017). A fourth gate would ask the Coordinator to
 * record two facts about one moment and then chase herself for the second.
 *
 * Re-recordable, because a transposed year is a thing that happens at a desk
 * and the audit entry is what makes the correction honest.
 */
export async function recordDateOfBirth(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    readonly volunteerId: string
    readonly dateOfBirth: DayString
    readonly provenance: DateOfBirthProvenance
    readonly reason?: string | null
  },
): Promise<Recorded> {
  const [existing] = await db
    .select({ dateOfBirth: volunteers.dateOfBirth })
    .from(volunteers)
    .where(and(eq(volunteers.id, about.volunteerId), isNull(volunteers.removedAt)))
    .limit(1)
  if (existing === undefined) return refused('volunteer_not_found')

  await db
    .update(volunteers)
    .set({
      dateOfBirth: about.dateOfBirth,
      dateOfBirthProvenance: about.provenance,
      dateOfBirthRecordedBy: actorVolunteerId,
      dateOfBirthRecordedAt: sql`now()`,
    })
    .where(eq(volunteers.id, about.volunteerId))

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'volunteer',
      entityId: about.volunteerId,
      field: 'date_of_birth',
      before: existing.dateOfBirth,
      after: about.dateOfBirth,
      reason: about.reason ?? null,
    },
    {
      entity: 'volunteer',
      entityId: about.volunteerId,
      field: 'date_of_birth_provenance',
      after: about.provenance,
      reason: about.reason ?? null,
    },
  ])

  return recorded(null)
}

/**
 * Ticks the Orientation — the first gate, and the moment the barn treats as
 * somebody joining.
 *
 * **It never lapses and is never revoked** (ADR 0011), so this refuses a second
 * tick rather than overwriting the first: leaving the rescue is the act that
 * exists for undoing it, and an Orientation whose date can be edited is a date
 * nobody can rely on.
 *
 * It refuses without a date of birth, for the reason above.
 */
export async function recordOrientation(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: { readonly volunteerId: string; readonly orientedOn: DayString },
): Promise<Recorded> {
  const [existing] = await db
    .select({ orientedOn: volunteers.orientedOn, dateOfBirth: volunteers.dateOfBirth })
    .from(volunteers)
    .where(and(eq(volunteers.id, about.volunteerId), isNull(volunteers.removedAt)))
    .limit(1)
  if (existing === undefined) return refused('volunteer_not_found')
  if (existing.dateOfBirth === null) return refused('date_of_birth_not_established')
  if (existing.orientedOn !== null) return refused('already_oriented')

  await db
    .update(volunteers)
    .set({
      orientedOn: about.orientedOn,
      orientationRecordedBy: actorVolunteerId,
      orientationRecordedAt: sql`now()`,
    })
    .where(eq(volunteers.id, about.volunteerId))

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'volunteer',
      entityId: about.volunteerId,
      field: 'oriented_on',
      after: about.orientedOn,
    },
  ])

  return recorded(null)
}

/**
 * Records a parent's Consent for a Volunteer under 18.
 *
 * Refused for somebody who is not a minor: a Consent satisfies a statutory
 * condition on Maryland's child-labour exemption and is meaningless for an
 * adult, so recording one would be a row that looks like a gate and gates
 * nothing. Refused too when no date of birth has been established, because
 * *minor* is derived from it and nothing else.
 *
 * It becomes historical on the eighteenth birthday and is **kept**, because it
 * was true. That retirement is derived at read time in `src/shared/rostering.ts`
 * and never written here by a job.
 */
export async function recordConsent(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    readonly volunteerId: string
    readonly consentedOn: DayString
    readonly parentName: string
    readonly today: DayString
  },
): Promise<Recorded> {
  const gates = await gatesFor(db, about.volunteerId)
  if (gates === null) return refused('volunteer_not_found')
  if (gates.dateOfBirth === null) return refused('date_of_birth_not_established')
  if (!rosterability(gates, about.today).isMinor) return refused('not_a_minor')

  await db
    .insert(volunteerConsents)
    .values({
      orgId,
      volunteerId: about.volunteerId,
      consentedOn: about.consentedOn,
      parentName: about.parentName.trim(),
      recordedBy: actorVolunteerId,
    })
    .onConflictDoUpdate({
      target: [volunteerConsents.orgId, volunteerConsents.volunteerId],
      set: {
        consentedOn: about.consentedOn,
        parentName: about.parentName.trim(),
        recordedBy: actorVolunteerId,
        recordedAt: sql`now()`,
      },
    })

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'volunteer_consent',
      entityId: about.volunteerId,
      after: about.consentedOn,
      reason: about.parentName.trim(),
    },
  ])

  return recorded(null)
}

/**
 * Removes a Volunteer from the rescue, and revokes their grants with them.
 *
 * A date rather than a delete: the work they did still happened, and it still
 * has to have a subject. This is the one path where `roster` reaches a grant
 * (ADR 0010), which is why it is stated rather than assumed — and every revoked
 * role gets its own audit entry, because a revocation is exactly the fact a
 * restore up to fifteen minutes stale could resurrect.
 *
 * **It obeys the last-`grants`-holder guard, because it is the second door to
 * the same state.** Revoking the President's role refuses; removing the
 * President from the rescue would otherwise take the role with them and leave
 * an organisation whose only way back is the bootstrap command — which ADR 0010
 * wants kept a floor rather than made a routine. Note that this door is `roster`
 * and the other is `grants`, so the guard is doing more work here, not less.
 */
export async function removeVolunteerIn(
  db: OrgScopedDatabase,
  orgId: OrgId,
  /** Null only outside a request — the bootstrap command, and test fixtures. */
  actorVolunteerId: string | null,
  about: { readonly volunteerId: string; readonly reason?: string | null },
): Promise<Recorded> {
  const [existing] = await db
    .select({ name: volunteers.name })
    .from(volunteers)
    .where(and(eq(volunteers.id, about.volunteerId), isNull(volunteers.removedAt)))
    .limit(1)
  if (existing === undefined) return refused('volunteer_not_found')

  const held = await db
    .select({ role: volunteerRoles.role })
    .from(volunteerRoles)
    .where(eq(volunteerRoles.volunteerId, about.volunteerId))

  // Every grant they hold is about to disappear, so the question is asked about
  // all of them at once rather than one at a time.
  if (
    held.some((row) => carriesGrants(row.role)) &&
    !(await someoneStillHoldsGrants(
      db,
      held.map((row) => ({ volunteerId: about.volunteerId, role: row.role })),
    ))
  ) {
    return refused('last_grants_holder')
  }

  await db
    .update(volunteers)
    .set({ removedAt: sql`now()` })
    .where(eq(volunteers.id, about.volunteerId))
  await db.delete(volunteerRoles).where(eq(volunteerRoles.volunteerId, about.volunteerId))

  // And off every roster. A Standing Roster row is a commitment somebody who
  // has left cannot keep, and leaving it would put them on every Shift
  // generated from that Pattern for as long as it exists — a name on a
  // fortnight's worth of rosters, flagged with a gap list nobody can read
  // because the gates are only derived for people still here.
  await db.delete(shiftPatternRoster).where(eq(shiftPatternRoster.volunteerId, about.volunteerId))
  // On the dated Shifts the row is **marked**, never deleted, like every other
  // way a roster row stops standing: *she was rostered and left* is a fact the
  // record keeps (ADR 0011).
  await db
    .update(shiftRoster)
    .set({
      endedAt: sql`now()`,
      endedKind: 'removed',
      endedReason: about.reason ?? null,
      endedBy: actorVolunteerId,
    })
    .where(and(eq(shiftRoster.volunteerId, about.volunteerId), isNull(shiftRoster.endedAt)))

  const entries: AuditEntry[] = [
    {
      entity: 'volunteer',
      entityId: about.volunteerId,
      field: 'removed_at',
      before: null,
      after: 'removed',
      reason: about.reason ?? null,
    },
    ...held.map((row): AuditEntry => ({
      entity: 'volunteer_role',
      entityId: about.volunteerId,
      before: row.role,
      after: null,
      reason: 'removed from the rescue',
    })),
  ]
  await audit(db, orgId, actorVolunteerId, entries)

  return recorded(null)
}
