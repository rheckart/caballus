/**
 * Release Versions and the signatures against them (ADR 0017).
 *
 * The two halves of the same decision. A **Version** is one issue of the
 * release text on ADR 0003's versioned tier — immutable, with a valid-from
 * date, and the current one is the latest. A **signature** is the record that a
 * piece of paper exists: who signed, when, which Version. The signed paper
 * stays in the cabinet.
 *
 * **Publishing a Version that obsoletes prior signatures removes nothing.** It
 * writes one row, and every affected Volunteer's release gap appears on the
 * next read of the people list, derived. Auto-removal was rejected on ADR
 * 0011's own words — an assignment that silently evaporates a fortnight later
 * is the class of quiet wrongness the whole design is against — and a
 * re-papering would fire that failure across every roster in the system on a
 * single morning, which is the day the rescue is least able to absorb it.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { releaseSignatures, releaseVersions, volunteers } from '../../db/schema'
import { dayString, type DayString } from '../../shared/time'
import { audit } from './audit'
import { done, recorded, refused, type Recorded } from './outcome'

export interface PublishedVersion {
  readonly id: string
  readonly label: string
  readonly validFrom: DayString
  readonly obsoletesPrior: boolean
}

/**
 * Publishes a Release Version.
 *
 * **No audit entry, deliberately.** ADR 0003's tiers decide what the audit log
 * holds, and a versioned-tier change *is* a version — the row published here is
 * itself the record of the change, and a second copy of it in `audit_entries`
 * would be the two-places-disagreeing failure that ADR was written against.
 * The row carries `publishedBy` so the actor is not lost with the entry.
 *
 * There is no way to edit one afterwards, and that is the immutability: a
 * correction is a new Version, published without the obsoletes flag so it
 * invalidates nobody.
 */
export async function publishReleaseVersion(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string | null,
  details: {
    readonly label: string
    readonly validFrom: DayString
    readonly obsoletesPrior: boolean
  },
): Promise<PublishedVersion> {
  const id = uuidv7()
  await db
    .insert(releaseVersions)
    .values({
      id,
      orgId,
      label: details.label.trim(),
      validFrom: details.validFrom,
      obsoletesPrior: details.obsoletesPrior,
      publishedBy: actorVolunteerId,
    })
    .returning({ id: releaseVersions.id })

  return {
    id,
    label: details.label.trim(),
    validFrom: details.validFrom,
    obsoletesPrior: details.obsoletesPrior,
  }
}

/** Every Version, newest first. The current one is the first row. */
export async function releaseVersionList(
  db: OrgScopedDatabase,
): Promise<readonly PublishedVersion[]> {
  const rows = await db
    .select({
      id: releaseVersions.id,
      label: releaseVersions.label,
      validFrom: releaseVersions.validFrom,
      obsoletesPrior: releaseVersions.obsoletesPrior,
    })
    .from(releaseVersions)
    .orderBy(desc(releaseVersions.validFrom), desc(releaseVersions.publishedAt))

  return rows.map((row) => ({ ...row, validFrom: dayString(row.validFrom) }))
}

/**
 * Records a signature against one Version.
 *
 * **Never self-recorded.** Unlike Attendance, where self-report is the norm and
 * attribution is what makes it safe, this is a statement about a piece of paper
 * that only the person holding the paper can see — a volunteer asserting their
 * own release exists is evidence of nothing. The refusal is here rather than in
 * the handler because it is a property of the record and not of the endpoint.
 *
 * `byParent` is the Parent/Guardian block, which does real work in Maryland
 * under *BJ's Wholesale Club v. Rosen* and is what an eighteenth birthday
 * obsoletes.
 *
 * `actorVolunteerId` is null for exactly one caller: `npm run bootstrap`,
 * recording the founding President's own release with no actor behind it —
 * the same floor `grantRoleIn` already carves out of *nobody grants themselves
 * a role*. Every other caller has an actor, and the guard below still bites.
 */
export async function recordReleaseSignature(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string | null,
  about: {
    readonly volunteerId: string
    readonly releaseVersionId: string
    readonly signedOn: DayString
    readonly byParent: boolean
  },
): Promise<Recorded<{ id: string }>> {
  if (actorVolunteerId !== null && about.volunteerId === actorVolunteerId) {
    return refused('self_recorded')
  }

  const [volunteer] = await db
    .select({ id: volunteers.id })
    .from(volunteers)
    .where(and(eq(volunteers.id, about.volunteerId), isNull(volunteers.removedAt)))
    .limit(1)
  if (volunteer === undefined) return refused('volunteer_not_found')

  const [version] = await db
    .select({ id: releaseVersions.id, label: releaseVersions.label })
    .from(releaseVersions)
    .where(eq(releaseVersions.id, about.releaseVersionId))
    .limit(1)
  if (version === undefined) return refused('release_version_not_found')

  const id = uuidv7()
  await db
    .insert(releaseSignatures)
    .values({
      id,
      orgId,
      volunteerId: about.volunteerId,
      releaseVersionId: about.releaseVersionId,
      signedOn: about.signedOn,
      byParent: about.byParent,
      recordedBy: actorVolunteerId,
    })
    .returning({ id: releaseSignatures.id })

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'release_signature',
      entityId: id,
      after: `${version.label} on ${about.signedOn}`,
      reason: about.byParent ? 'signed by a parent or guardian' : null,
    },
  ])

  return recorded({ id })
}

/**
 * Revokes a signature — the one field, and the entire feature.
 *
 * A release stays effective until expressly revoked in writing, and nobody at
 * this rescue has ever done it. No status enum, no reason field on the row, no
 * workflow: setting the date fails the gate. The column is worth its weight
 * because when it does happen the alternative is somebody editing the signature
 * so that a true past fact disappears.
 */
export async function revokeReleaseSignature(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: { readonly signatureId: string; readonly reason?: string | null },
): Promise<Recorded> {
  const [signature] = await db
    .select({ id: releaseSignatures.id, revokedAt: releaseSignatures.revokedAt })
    .from(releaseSignatures)
    .where(eq(releaseSignatures.id, about.signatureId))
    .limit(1)
  if (signature === undefined) return refused('signature_not_found')
  if (signature.revokedAt !== null) return refused('already_revoked')

  await db
    .update(releaseSignatures)
    .set({ revokedAt: sql`now()`, revokedBy: actorVolunteerId })
    .where(eq(releaseSignatures.id, about.signatureId))

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'release_signature',
      entityId: about.signatureId,
      field: 'revoked_at',
      before: null,
      after: 'revoked',
      reason: about.reason ?? null,
    },
  ])

  return done()
}
