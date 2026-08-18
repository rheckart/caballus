/**
 * The audit log, written by the same transaction as the edit it records.
 *
 * That is the whole of the guarantee and it is why this takes a scoped handle
 * rather than opening its own: `mutation` already opened the transaction that
 * carries the idempotency key and the effect together (ADR 0020), and an audit
 * entry written outside it would be a record of a change that might have rolled
 * back — or a change with no record, which is worse.
 *
 * **What lands here is decided by ADR 0003's tiers, not by taste.**
 * Current-state edits get an entry. Versioned-tier changes are versions and get
 * none: publishing a Release Version writes nothing here, because the Version
 * *is* the record of the change and a second copy of it in this table would be
 * the halter-colour-in-two-places failure that ADR wrote itself against.
 * Measurement appends get neither, being their own record.
 *
 * ADR 0010 adds two rules on top. **Grants and revocations are audit entries**
 * carrying actor, subject and reason, so a revoked role joins a revoked session
 * on the same line of the restore runbook. **Denials are not** — they are the
 * structured log `route.ts` already writes, because a table of things that did
 * not happen is a table nobody reads.
 */
import { v7 as uuidv7 } from 'uuid'

import type { OrgScopedDatabase } from '../../db/for-org'
import type { OrgId } from '../../db/for-org'
import { auditEntries } from '../../db/schema'

/**
 * The kinds of thing this application audits, enumerated so that a typo is a
 * type error rather than a row nobody will ever find again.
 */
export const AUDIT_ENTITIES = [
  'volunteer',
  'volunteer_role',
  'medication_authority',
  'release_signature',
  'volunteer_consent',
  'space',
  'horse',
  'horse_space_assignment',
] as const

export type AuditEntity = (typeof AUDIT_ENTITIES)[number]

export interface AuditEntry {
  readonly entity: AuditEntity
  readonly entityId: string
  /**
   * The field that changed, or omitted for the record as a whole — a creation,
   * a removal, a grant. A grant has no field to name, and inventing one would
   * make the column lie in exactly the rows that get read.
   */
  readonly field?: string
  readonly before?: string | null
  readonly after?: string | null
  readonly reason?: string | null
}

/**
 * Writes entries for one act.
 *
 * `actorVolunteerId` is a Volunteer and never an Account (ADR 0010), and it is
 * null for the one act inside this application that has no actor: `npm run
 * bootstrap` making the first President, before anybody can sign in to be one.
 */
export async function audit(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string | null,
  entries: readonly AuditEntry[],
): Promise<void> {
  if (entries.length === 0) return

  await db.insert(auditEntries).values(
    entries.map((entry) => ({
      id: uuidv7(),
      orgId,
      actorVolunteerId,
      entity: entry.entity,
      entityId: entry.entityId,
      field: entry.field ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason ?? null,
    })),
  )
}
