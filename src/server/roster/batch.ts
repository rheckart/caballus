/**
 * A class is one act (#100): Orientation, a Release, a Role, Medication
 * Authority and SMS-off, each applied to many volunteers at once.
 *
 * **Bulk means one change applied to many people, never a spreadsheet.** Every
 * batch here is the single write in `records.ts`, `releases.ts` or `grants.ts`,
 * called once per person inside the one transaction `mutation` opened under one
 * key (ADR 0020) — so each person gets exactly the effect and the audit entry
 * the single write gives them, and nothing new to remember (ADR 0003, ADR
 * 0017). No import log and no batch table (ADR 0019).
 *
 * **Partial, and the skipped are named.** A person the single write would
 * refuse, or one already in the state the batch asks for, is skipped with the
 * reason; nothing refuses a class of eight because one is already oriented.
 * What is the same for everyone — the Release Version — refuses the whole
 * batch instead, because it is wrong for all of them at once.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import {
  medicationAuthority,
  releaseSignatures,
  releaseVersions,
  volunteerRoles,
  volunteers,
} from '../../db/schema'
import {
  VOLUNTEER_BATCH_SKIPS,
  type VolunteerBatchAct,
  type VolunteerBatchSkip,
} from '../../shared/batch'
import type { Role } from '../../shared/roles'
import { eighteenthBirthday } from '../../shared/rostering'
import { dayString, type DayString } from '../../shared/time'
import { grantMedicationAuthority, grantRoleIn, revokeMedicationAuthority } from './grants'
import { recorded, refused, type Recorded } from './outcome'
import { recordOrientation, recordSmsConsent } from './records'
import { recordReleaseSignature } from './releases'

export interface BatchOutcome<A extends VolunteerBatchAct> {
  readonly done: string[]
  readonly skipped: { volunteerId: string; because: VolunteerBatchSkip<A> }[]
}

/**
 * Runs one person's write, or skips them — the loop every batch shares.
 *
 * `decide` answers a skip before the write, for a state the single write would
 * not refuse (a Role already held is an idempotent re-grant there, and the
 * batch names it instead). The write's own refusals are skips when the act
 * names them, and otherwise **thrown**: an answered refusal would commit the
 * people already done under a refusal, and a thrown one rolls the batch back.
 */
async function eachVolunteer<A extends VolunteerBatchAct>(
  act: A,
  volunteerIds: readonly string[],
  decide: (volunteerId: string) => VolunteerBatchSkip<A> | null,
  write: (volunteerId: string) => Promise<Recorded<unknown>>,
): Promise<BatchOutcome<A>> {
  const done: string[] = []
  const skipped: { volunteerId: string; because: VolunteerBatchSkip<A> }[] = []
  for (const volunteerId of new Set(volunteerIds)) {
    const decided = decide(volunteerId)
    if (decided !== null) {
      skipped.push({ volunteerId, because: decided })
      continue
    }
    const outcome = await write(volunteerId)
    if (outcome.ok) {
      done.push(volunteerId)
      continue
    }
    const skips: readonly VolunteerBatchSkip<A>[] = VOLUNTEER_BATCH_SKIPS[act]
    const because = skips.find((skip) => skip === outcome.because)
    if (because === undefined) throw new Error(`a batch write refused ${outcome.because}`)
    skipped.push({ volunteerId, because })
  }
  return { done, skipped }
}

/** The live volunteers among `volunteerIds` — a removed one is `volunteer_not_found`, as the single write has it. */
async function liveAmong(
  db: OrgScopedDatabase,
  volunteerIds: readonly string[],
): Promise<Map<string, { dateOfBirth: DayString | null }>> {
  const rows = await db
    .select({ id: volunteers.id, dateOfBirth: volunteers.dateOfBirth })
    .from(volunteers)
    .where(and(inArray(volunteers.id, [...volunteerIds]), isNull(volunteers.removedAt)))
  return new Map(
    rows.map((row) => [
      row.id,
      { dateOfBirth: row.dateOfBirth === null ? null : dayString(row.dateOfBirth) },
    ]),
  )
}

/** An Orientation class: one date, each person the single tick (#100). */
export async function recordOrientations(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: { readonly volunteerIds: readonly string[]; readonly orientedOn: DayString },
): Promise<Recorded<BatchOutcome<'orientation'>>> {
  return recorded(
    await eachVolunteer(
      'orientation',
      about.volunteerIds,
      () => null,
      (volunteerId) =>
        recordOrientation(db, orgId, actorVolunteerId, {
          volunteerId,
          orientedOn: about.orientedOn,
        }),
    ),
  )
}

/**
 * A room signing one Release Version on one day (#100).
 *
 * **`byParent` is decided per person** from their age on `signedOn` — a parent
 * signs for anybody not yet eighteen that day — because a list mixes minors and
 * adults and one box for all of them is wrong for somebody. With no date of
 * birth there is no answer to decide it from, so that person is skipped rather
 * than guessed. Never self-recorded, which the single write already refuses.
 */
export async function recordReleaseSignatures(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    readonly volunteerIds: readonly string[]
    readonly releaseVersionId: string
    readonly signedOn: DayString
  },
): Promise<Recorded<BatchOutcome<'release'>>> {
  const [version] = await db
    .select({ id: releaseVersions.id })
    .from(releaseVersions)
    .where(eq(releaseVersions.id, about.releaseVersionId))
    .limit(1)
  if (version === undefined) return refused('release_version_not_found')

  const live = await liveAmong(db, about.volunteerIds)
  // The single write is not idempotent — a second signature is a second row —
  // so a room recorded twice would sign everybody twice. A standing signature
  // on this Version is the state the batch asks for, and is named back.
  const standing = await db
    .select({ volunteerId: releaseSignatures.volunteerId })
    .from(releaseSignatures)
    .where(
      and(
        inArray(releaseSignatures.volunteerId, [...about.volunteerIds]),
        eq(releaseSignatures.releaseVersionId, about.releaseVersionId),
        isNull(releaseSignatures.revokedAt),
      ),
    )
  const signed = new Set(standing.map((row) => row.volunteerId))

  return recorded(
    await eachVolunteer(
      'release',
      about.volunteerIds,
      (volunteerId) => {
        if (volunteerId === actorVolunteerId) return 'self_recorded'
        const volunteer = live.get(volunteerId)
        if (volunteer === undefined) return 'volunteer_not_found'
        if (volunteer.dateOfBirth === null) return 'date_of_birth_not_established'
        if (signed.has(volunteerId)) return 'already_signed'
        return null
      },
      (volunteerId) => {
        const dateOfBirth = live.get(volunteerId)?.dateOfBirth
        if (dateOfBirth === null || dateOfBirth === undefined) {
          throw new Error('recordReleaseSignatures reached a volunteer with no date of birth')
        }
        return recordReleaseSignature(db, orgId, actorVolunteerId, {
          volunteerId,
          releaseVersionId: about.releaseVersionId,
          signedOn: about.signedOn,
          byParent: about.signedOn < eighteenthBirthday(dateOfBirth),
        })
      },
    ),
  )
}

/**
 * One Role to many people, one reason on every entry (#100). **Grant only**: a
 * bulk mistake that grants twelve people Lead is annoying, and one that takes
 * it from twelve locks them out mid-week.
 */
export async function grantRoles(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    readonly volunteerIds: readonly string[]
    readonly role: Role
    readonly reason: string | null
  },
): Promise<Recorded<BatchOutcome<'roles'>>> {
  // Joined to live volunteers: a removed one's rows may outlive them, and they
  // are `volunteer_not_found`, never *already holds it*.
  const holding = await db
    .select({ volunteerId: volunteerRoles.volunteerId })
    .from(volunteerRoles)
    .innerJoin(volunteers, eq(volunteers.id, volunteerRoles.volunteerId))
    .where(
      and(
        inArray(volunteerRoles.volunteerId, [...about.volunteerIds]),
        eq(volunteerRoles.role, about.role),
        isNull(volunteers.removedAt),
      ),
    )
  const holders = new Set(holding.map((row) => row.volunteerId))

  return recorded(
    await eachVolunteer(
      'roles',
      about.volunteerIds,
      // Self first: a grants holder ticking themselves is refused whether or
      // not they already hold it, which is the answer the single write gives.
      (volunteerId) =>
        volunteerId !== actorVolunteerId && holders.has(volunteerId) ? 'already_held' : null,
      (volunteerId) =>
        grantRoleIn(db, orgId, actorVolunteerId, {
          volunteerId,
          role: about.role,
          reason: about.reason,
        }),
    ),
  )
}

/** Medication Authority for a list, either way, one reason on every entry (#100). */
export async function setMedicationAuthorities(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    readonly volunteerIds: readonly string[]
    readonly granted: boolean
    readonly reason: string | null
  },
): Promise<Recorded<BatchOutcome<'medicationAuthority'>>> {
  const current = await db
    .select({ volunteerId: medicationAuthority.volunteerId })
    .from(medicationAuthority)
    .innerJoin(volunteers, eq(volunteers.id, medicationAuthority.volunteerId))
    .where(
      and(
        inArray(medicationAuthority.volunteerId, [...about.volunteerIds]),
        isNull(medicationAuthority.revokedAt),
        isNull(volunteers.removedAt),
      ),
    )
  const holders = new Set(current.map((row) => row.volunteerId))

  return recorded(
    await eachVolunteer(
      'medicationAuthority',
      about.volunteerIds,
      (volunteerId) => (about.granted && holders.has(volunteerId) ? 'already_held' : null),
      (volunteerId) => {
        const one = { volunteerId, reason: about.reason }
        return about.granted
          ? grantMedicationAuthority(db, orgId, actorVolunteerId, one)
          : revokeMedicationAuthority(db, orgId, actorVolunteerId, one)
      },
    ),
  )
}

/**
 * SMS Consent withdrawn for a list (#100). **Off only** — the contract refuses
 * `true`, because consent is collected from the person at invitation (ADR
 * 0028). Somebody already off is skipped, since the single write would record
 * nothing for them and the desk should say so.
 */
export async function withdrawSmsConsents(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: { readonly volunteerIds: readonly string[] },
): Promise<Recorded<BatchOutcome<'smsConsent'>>> {
  const consenting = await db
    .select({ id: volunteers.id, smsConsentAt: volunteers.smsConsentAt })
    .from(volunteers)
    .where(and(inArray(volunteers.id, [...about.volunteerIds]), isNull(volunteers.removedAt)))
  const on = new Map(consenting.map((row) => [row.id, row.smsConsentAt !== null]))

  return recorded(
    await eachVolunteer(
      'smsConsent',
      about.volunteerIds,
      (volunteerId) => (on.get(volunteerId) === false ? 'already_off' : null),
      (volunteerId) =>
        recordSmsConsent(db, orgId, actorVolunteerId, { volunteerId, consented: false }),
    ),
  )
}
