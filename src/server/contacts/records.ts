/**
 * The Contacts screen's writes: a posted number and a standing rule, both
 * current state plus an audit entry (ADR 0003), both maintained under
 * `roster` (`CONTEXT.md`'s Contacts; ADR 0014, ADR 0018).
 *
 * **Neither table carries a column that could let an Escalation resolve to
 * it.** ADR 0010 keeps this screen entirely outside the routing model — the
 * same discipline `src/server/products/records.ts` follows for a Supplier —
 * so there is nothing here for a future ticket to accidentally wire up.
 *
 * Everything here takes the scoped transaction `mutation` opened, so the
 * effect and its audit entry commit together (ADR 0020).
 */
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { contacts, standingRules } from '../../db/schema'
import { audit, type AuditEntry } from '../roster/audit'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

export interface NewContact {
  readonly name: string
  readonly number: string
  readonly hours?: string | null
  readonly purpose: string
}

/** Posts a Contact — a name, a number, what it is for, and optional hours. */
export async function createContact(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  details: NewContact,
): Promise<Recorded<{ id: string }>> {
  const id = uuidv7()
  const name = details.name.trim()
  await db.insert(contacts).values({
    id,
    orgId,
    name,
    number: details.number.trim(),
    hours: normalised(details.hours),
    purpose: details.purpose.trim(),
  })

  await audit(db, orgId, actorVolunteerId, [{ entity: 'contact', entityId: id, after: name }])

  return recorded({ id })
}

function normalised(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

interface ContactEdit {
  readonly contactId: string
  readonly name?: string
  readonly number?: string
  readonly hours?: string | null
  readonly purpose?: string
  readonly reason?: string | null
}

/** Edits a Contact in place, auditing only the fields sent and actually changed (ADR 0003). */
export async function editContact(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: ContactEdit,
): Promise<Recorded> {
  const [existing] = await db
    .select({
      name: contacts.name,
      number: contacts.number,
      hours: contacts.hours,
      purpose: contacts.purpose,
    })
    .from(contacts)
    .where(eq(contacts.id, about.contactId))
    .limit(1)
  if (existing === undefined) return refused('contact_not_found')

  const after = {
    name: about.name !== undefined ? about.name.trim() : existing.name,
    number: about.number !== undefined ? about.number.trim() : existing.number,
    hours: 'hours' in about ? normalised(about.hours) : existing.hours,
    purpose: about.purpose !== undefined ? about.purpose.trim() : existing.purpose,
  }

  const next: Record<string, string | null> = {}
  const entries: AuditEntry[] = []
  const fields = ['name', 'number', 'hours', 'purpose'] as const
  for (const field of fields) {
    if (after[field] === existing[field]) continue
    next[field] = after[field]
    entries.push({
      entity: 'contact',
      entityId: about.contactId,
      field,
      before: existing[field],
      after: after[field],
      reason: about.reason ?? null,
    })
  }

  if (Object.keys(next).length > 0) {
    await db.update(contacts).set(next).where(eq(contacts.id, about.contactId))
  }
  await audit(db, orgId, actorVolunteerId, entries)

  return recorded(null)
}

/** Adds a standing rule — the residue of the board's Reminders panel (ADR 0018). */
export async function createStandingRule(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  details: { readonly text: string },
): Promise<Recorded<{ id: string }>> {
  const id = uuidv7()
  const text = details.text.trim()
  await db.insert(standingRules).values({ id, orgId, text })

  await audit(db, orgId, actorVolunteerId, [{ entity: 'standing_rule', entityId: id, after: text }])

  return recorded({ id })
}

/** Edits a standing rule's text in place. */
export async function editStandingRule(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    readonly standingRuleId: string
    readonly text: string
    readonly reason?: string | null
  },
): Promise<Recorded> {
  const [existing] = await db
    .select({ text: standingRules.text })
    .from(standingRules)
    .where(eq(standingRules.id, about.standingRuleId))
    .limit(1)
  if (existing === undefined) return refused('standing_rule_not_found')

  const text = about.text.trim()
  if (text === existing.text) return recorded(null)

  await db.update(standingRules).set({ text }).where(eq(standingRules.id, about.standingRuleId))

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'standing_rule',
      entityId: about.standingRuleId,
      field: 'text',
      before: existing.text,
      after: text,
      reason: about.reason ?? null,
    },
  ])

  return recorded(null)
}
