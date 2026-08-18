/**
 * The Contacts screen's one read: the posted numbers and the standing rules,
 * both in name order (`CONTEXT.md`'s Contacts; ADR 0014, ADR 0018).
 *
 * Every Volunteer reads this (ADR 0010's floor) — five posted escalation
 * numbers are not the same artifact as sixty volunteers' mobile numbers, and
 * this table carries none of the latter.
 */
import type { OrgScopedDatabase } from '../../db/for-org'
import { contacts, standingRules } from '../../db/schema'

export interface Contact {
  readonly id: string
  readonly name: string
  readonly number: string
  readonly hours: string | null
  readonly purpose: string
}

export interface StandingRule {
  readonly id: string
  readonly text: string
}

export async function contactList(db: OrgScopedDatabase): Promise<readonly Contact[]> {
  return db
    .select({
      id: contacts.id,
      name: contacts.name,
      number: contacts.number,
      hours: contacts.hours,
      purpose: contacts.purpose,
    })
    .from(contacts)
    .orderBy(contacts.name)
}

export async function standingRuleList(db: OrgScopedDatabase): Promise<readonly StandingRule[]> {
  return db
    .select({ id: standingRules.id, text: standingRules.text })
    .from(standingRules)
    .orderBy(standingRules.createdAt)
}
