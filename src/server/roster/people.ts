/**
 * The people list — the Coordinator's one surface, and the only screen this
 * ticket adds a queue to.
 *
 * ADR 0017 is explicit that three gates share **one list**: "no new queue and
 * no new surface — ADR 0012 predicted the second queue when Consent arrived,
 * and predicting a queue is not a licence to build a third screen." So every
 * gate, every Role, the qualification and the Account all come back from here,
 * and the screen shows which one a person fails.
 *
 * **Who sees what is the whole of the care in this module.** ADR 0010's floor
 * is that every Volunteer reads everything, with exactly two carve-outs behind
 * `roster`: contact details and the audit log. ADR 0017 made that carve-out
 * gain a field rather than adding a third — the **year** of a date of birth and
 * the age derived from it sit behind `roster`, while **day and month sit on the
 * floor**, because that is what a birthday is and the rescue has a party.
 * Under-18 is on the floor too, and **as a state rather than as a number**: a
 * Lead needs to know a minor is a minor, not that she is fifteen.
 *
 * Redaction happens here, once, on the way out — not on the screen, and not by
 * the caller remembering. A second place that decides what a non-`roster`
 * holder may see is a second place that can get it wrong.
 *
 * Five queries and a group in memory rather than one per person: sixty
 * volunteers times five round trips is the shape of slowness that arrives
 * quietly.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import {
  auditEntries,
  medicationAuthority,
  releaseSignatures,
  releaseVersions,
  volunteerAccounts,
  volunteerConsents,
  volunteerRoles,
  volunteers,
} from '../../db/schema'
import { DOMAIN_SCOPES, type DomainScope } from '../../shared/domain-scopes'
import {
  ageOn,
  birthdayOf,
  rosterability,
  type Birthday,
  type ReleaseSignature,
  type RosterGap,
} from '../../shared/rostering'
import { dayString, type DayString } from '../../shared/time'
import { isRole, scopesOf, type Role } from '../api/authorization'
import { obsoletingVersions } from './gates'

/** What everyone in the organisation may read about a Volunteer. */
export interface PersonOnTheFloor {
  readonly id: string
  readonly name: string
  /**
   * `candidate` until the Orientation, then `volunteer`. It is a state and not
   * a separate kind of person — a Candidate holds a Volunteer record, may hold
   * an Account and Roles, and reads everything. **The word stops at
   * Orientation**: a volunteer of ten years whose Release has been obsoleted is
   * not a Candidate, they are a Volunteer with a gap.
   */
  readonly state: 'candidate' | 'volunteer'
  readonly rosterable: boolean
  /** Which gate is open. This is the flag that a failing gate raises instead of removing anybody. */
  readonly gaps: readonly RosterGap[]
  /** A state, never a number. */
  readonly isMinor: boolean
  /** Day and month, with no year in it. */
  readonly birthday: Birthday | null
  readonly roles: readonly Role[]
  readonly domainScopes: readonly DomainScope[]
  readonly medicationAuthority: boolean
  readonly hasAccount: boolean
  /** A Consent that is kept and no longer gates, which an eighteenth birthday does. */
  readonly consentIsHistorical: boolean
}

/** Behind `roster`, with the audit log: contact details, the year, the paper. */
export interface PersonBehindRoster {
  readonly email: string
  readonly mobile: string | null
  readonly dateOfBirth: DayString | null
  readonly dateOfBirthProvenance: string | null
  readonly age: number | null
  readonly turnsEighteenOn: DayString | null
  readonly orientedOn: DayString | null
  readonly consentedOn: DayString | null
  readonly parentName: string | null
  readonly signatures: readonly RecordedSignature[]
}

export interface RecordedSignature {
  readonly id: string
  readonly versionLabel: string
  readonly signedOn: DayString
  readonly byParent: boolean
  readonly revoked: boolean
}

export interface Person extends PersonOnTheFloor {
  /** `null` for a reader who does not hold `roster`. Absent, not empty. */
  readonly behindRoster: PersonBehindRoster | null
}

/**
 * Everybody still at the rescue, with every gate derived against `today`.
 *
 * Removed Volunteers are left out: the record outlives their leaving so that
 * the work they did still has a subject, but a roster is a list of people who
 * can be put on a Shift and somebody who has left is not one.
 */
export async function peopleList(
  db: OrgScopedDatabase,
  today: DayString,
  seesRoster: boolean,
): Promise<readonly Person[]> {
  const [rows, roleRows, authorityRows, accountRows, consentRows, signatureRows, obsoleting] =
    await Promise.all([
      db
        .select({
          id: volunteers.id,
          name: volunteers.name,
          email: volunteers.email,
          mobile: volunteers.mobile,
          dateOfBirth: volunteers.dateOfBirth,
          dateOfBirthProvenance: volunteers.dateOfBirthProvenance,
          orientedOn: volunteers.orientedOn,
        })
        .from(volunteers)
        .where(isNull(volunteers.removedAt))
        .orderBy(volunteers.name),
      db
        .select({ volunteerId: volunteerRoles.volunteerId, role: volunteerRoles.role })
        .from(volunteerRoles),
      db
        .select({ volunteerId: medicationAuthority.volunteerId })
        .from(medicationAuthority)
        .where(isNull(medicationAuthority.revokedAt)),
      db
        .select({ volunteerId: volunteerAccounts.volunteerId })
        .from(volunteerAccounts)
        .where(isNull(volunteerAccounts.revokedAt)),
      db
        .select({
          volunteerId: volunteerConsents.volunteerId,
          consentedOn: volunteerConsents.consentedOn,
          parentName: volunteerConsents.parentName,
        })
        .from(volunteerConsents),
      db
        .select({
          id: releaseSignatures.id,
          volunteerId: releaseSignatures.volunteerId,
          signedOn: releaseSignatures.signedOn,
          byParent: releaseSignatures.byParent,
          revokedAt: releaseSignatures.revokedAt,
          versionLabel: releaseVersions.label,
          // Staleness is decided by which text was signed rather than by when.
          versionValidFrom: releaseVersions.validFrom,
        })
        .from(releaseSignatures)
        .innerJoin(releaseVersions, eq(releaseVersions.id, releaseSignatures.releaseVersionId))
        .orderBy(desc(releaseSignatures.signedOn)),
      obsoletingVersions(db),
    ])

  const rolesBy = groupBy(roleRows, (row) => row.volunteerId)
  const signaturesBy = groupBy(signatureRows, (row) => row.volunteerId)
  const consentBy = new Map(consentRows.map((row) => [row.volunteerId, row]))
  const hasAuthority = new Set(authorityRows.map((row) => row.volunteerId))
  const hasAccount = new Set(accountRows.map((row) => row.volunteerId))

  return rows.map((row): Person => {
    const held = (rolesBy.get(row.id) ?? []).map((entry) => entry.role).filter(isRole)
    const signatures = signaturesBy.get(row.id) ?? []
    const consent = consentBy.get(row.id)
    const dateOfBirth = row.dateOfBirth === null ? null : dayString(row.dateOfBirth)
    const orientedOn = row.orientedOn === null ? null : dayString(row.orientedOn)
    const consentedOn = consent === undefined ? null : dayString(consent.consentedOn)

    const derived = rosterability(
      {
        orientedOn,
        dateOfBirth,
        signatures: signatures.map((signature): ReleaseSignature => ({
          signedOn: dayString(signature.signedOn),
          versionValidFrom: dayString(signature.versionValidFrom),
          byParent: signature.byParent,
          revoked: signature.revokedAt !== null,
        })),
        obsoletingVersionsFrom: obsoleting,
        consentedOn,
      },
      today,
    )

    return {
      id: row.id,
      name: row.name,
      state: orientedOn === null ? 'candidate' : 'volunteer',
      rosterable: derived.rosterable,
      gaps: derived.gaps,
      isMinor: derived.isMinor,
      birthday: dateOfBirth === null ? null : birthdayOf(dateOfBirth),
      roles: held,
      domainScopes: scopesOf(held),
      medicationAuthority: hasAuthority.has(row.id),
      hasAccount: hasAccount.has(row.id),
      consentIsHistorical: derived.consentIsHistorical,
      behindRoster: !seesRoster
        ? null
        : {
            email: row.email,
            mobile: row.mobile,
            dateOfBirth,
            dateOfBirthProvenance: row.dateOfBirthProvenance,
            age: dateOfBirth === null ? null : ageOn(dateOfBirth, today),
            turnsEighteenOn: derived.turnsEighteenOn,
            orientedOn,
            consentedOn,
            parentName: consent?.parentName ?? null,
            signatures: signatures.map((signature): RecordedSignature => ({
              id: signature.id,
              versionLabel: signature.versionLabel,
              signedOn: dayString(signature.signedOn),
              byParent: signature.byParent,
              revoked: signature.revokedAt !== null,
            })),
          },
    }
  })
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>()
  for (const row of rows) {
    const at = key(row)
    const held = grouped.get(at)
    if (held === undefined) grouped.set(at, [row])
    else held.push(row)
  }
  return grouped
}

/**
 * The staffing question ADR 0010 says admin should surface: **no non-officer
 * holds this scope**.
 *
 * That is a staffing problem to show, not an authorization state to model —
 * because officers hold every scope, no scope is ever literally vacant and
 * routing never has nowhere to go. `supplies` is the standing example: it has
 * no dedicated Role and is the President's until the rescue names the position,
 * and the screen showing it is the app asking a question the rescue has not
 * answered.
 */
export function unstaffedScopes(people: readonly Person[]): readonly DomainScope[] {
  // An officer is somebody holding `grants`, which ADR 0010's table confers on
  // the President and Board Member and on nobody else. Read off the constant
  // rather than by naming those two Roles here, so that a third officer Role
  // arriving is one line in `ROLE_SCOPES` and nothing in this file.
  const held = new Set<DomainScope>()
  for (const person of people) {
    if (person.domainScopes.includes('grants')) continue
    for (const scope of person.domainScopes) held.add(scope)
  }
  return DOMAIN_SCOPES.filter((scope) => !held.has(scope))
}

/** The audit log, newest first. Behind `roster` with contact details (ADR 0010). */
export async function auditLog(
  db: OrgScopedDatabase,
  limit: number,
): Promise<readonly AuditLine[]> {
  const rows = await db
    .select({
      id: auditEntries.id,
      recordedAt: auditEntries.recordedAt,
      actorVolunteerId: auditEntries.actorVolunteerId,
      entity: auditEntries.entity,
      entityId: auditEntries.entityId,
      field: auditEntries.field,
      before: auditEntries.before,
      after: auditEntries.after,
      reason: auditEntries.reason,
    })
    .from(auditEntries)
    .orderBy(desc(auditEntries.recordedAt))
    .limit(limit)

  return rows.map((row) => ({ ...row, recordedAt: row.recordedAt.getTime() }))
}

export interface AuditLine {
  readonly id: string
  /** Epoch milliseconds; the phone formats it, and the day it fell on is the organisation's. */
  readonly recordedAt: number
  readonly actorVolunteerId: string | null
  readonly entity: string
  readonly entityId: string
  readonly field: string | null
  readonly before: string | null
  readonly after: string | null
  readonly reason: string | null
}

/** The live Volunteer at an id, or `null`. For the writes that need a name. */
export async function liveVolunteer(
  db: OrgScopedDatabase,
  volunteerId: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: volunteers.id, name: volunteers.name })
    .from(volunteers)
    .where(and(eq(volunteers.id, volunteerId), isNull(volunteers.removedAt)))
    .limit(1)
  return row ?? null
}
