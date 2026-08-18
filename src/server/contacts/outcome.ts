/**
 * What a Contacts-screen write answers with: it worked, or the one reason it
 * did not — the same named-outcome discipline `src/server/horses/outcome.ts`
 * follows, and its own small file because neither a Contact nor a standing
 * rule is a refusal any other domain names.
 */

export type Refusal = 'contact_not_found' | 'standing_rule_not_found'

export type Recorded<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export function refused(because: Refusal): Recorded<never> {
  return { ok: false, because }
}

export function recorded<T>(value: T): Recorded<T> {
  return { ok: true, value }
}
