/**
 * Loading the facts the three rostering gates are derived from.
 *
 * The derivation itself is `src/shared/rostering.ts` and touches no I/O; this
 * is the half that reads rows. Keeping them apart is what lets the awkward
 * cases — a signature staled by a Version, a Consent spent by a birthday — be a
 * table of inputs in a unit test rather than a fixture in a database.
 *
 * The obsoleting Versions are loaded **once for the whole organisation** rather
 * than per Volunteer: there are a handful of them ever, and the alternative is
 * the people list issuing sixty copies of the same query.
 */
import { and, eq, isNull } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import { releaseSignatures, releaseVersions, volunteerConsents, volunteers } from '../../db/schema'
import type { ReleaseSignature, VolunteerGates } from '../../shared/rostering'
import { dayString, type DayString } from '../../shared/time'

/**
 * The valid-from day of every Release Version published with the
 * obsoletes-prior flag.
 *
 * Every one of them, not only the newest: a Version published today staling
 * everything before it does not un-stale what an earlier obsoleting Version
 * already staled, and taking the maximum would be right today and wrong the
 * first time somebody backdates a valid-from.
 */
export async function obsoletingVersions(db: OrgScopedDatabase): Promise<readonly DayString[]> {
  const rows = await db
    .select({ validFrom: releaseVersions.validFrom })
    .from(releaseVersions)
    .where(eq(releaseVersions.obsoletesPrior, true))
  return rows.map((row) => dayString(row.validFrom))
}

/**
 * The gate facts for one Volunteer, or `null` when there is no live one.
 *
 * Convenient rather than efficient: it reloads the obsoleting Versions each
 * time, which is right for a single write and wrong for a list. `gatesForAll`
 * is what the list uses.
 */
export async function gatesFor(
  db: OrgScopedDatabase,
  volunteerId: string,
): Promise<VolunteerGates | null> {
  const [volunteer] = await db
    .select({
      orientedOn: volunteers.orientedOn,
      dateOfBirth: volunteers.dateOfBirth,
    })
    .from(volunteers)
    .where(and(eq(volunteers.id, volunteerId), isNull(volunteers.removedAt)))
    .limit(1)
  if (volunteer === undefined) return null

  const [signatures, consent, obsoleting] = await Promise.all([
    signaturesFor(db, volunteerId),
    consentFor(db, volunteerId),
    obsoletingVersions(db),
  ])

  return {
    orientedOn: volunteer.orientedOn === null ? null : dayString(volunteer.orientedOn),
    dateOfBirth: volunteer.dateOfBirth === null ? null : dayString(volunteer.dateOfBirth),
    signatures,
    obsoletingVersionsFrom: obsoleting,
    consentedOn: consent,
  }
}

async function signaturesFor(
  db: OrgScopedDatabase,
  volunteerId: string,
): Promise<readonly ReleaseSignature[]> {
  const rows = await db
    .select({
      signedOn: releaseSignatures.signedOn,
      // Joined, because staleness is decided by which *text* was signed rather
      // than by when — see `versionValidFrom` in `src/shared/rostering.ts`.
      versionValidFrom: releaseVersions.validFrom,
      byParent: releaseSignatures.byParent,
      revokedAt: releaseSignatures.revokedAt,
    })
    .from(releaseSignatures)
    .innerJoin(releaseVersions, eq(releaseVersions.id, releaseSignatures.releaseVersionId))
    .where(eq(releaseSignatures.volunteerId, volunteerId))
  return rows.map((row) => ({
    signedOn: dayString(row.signedOn),
    versionValidFrom: dayString(row.versionValidFrom),
    byParent: row.byParent,
    revoked: row.revokedAt !== null,
  }))
}

async function consentFor(db: OrgScopedDatabase, volunteerId: string): Promise<DayString | null> {
  const [row] = await db
    .select({ consentedOn: volunteerConsents.consentedOn })
    .from(volunteerConsents)
    .where(eq(volunteerConsents.volunteerId, volunteerId))
    .limit(1)
  return row === undefined ? null : dayString(row.consentedOn)
}
