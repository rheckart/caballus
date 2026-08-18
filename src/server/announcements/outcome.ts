/**
 * What an Announcement write answers with: it worked, or the one reason it
 * did not — the same named-outcome discipline `src/server/horses/outcome.ts`
 * follows, and its own small file for the same reason that one is: an
 * Announcement is never the refusal a roster or a horse write names.
 */

export type Refusal = 'announcement_not_found'

export type Recorded<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export function refused(because: Refusal): Recorded<never> {
  return { ok: false, because }
}

export function recorded<T>(value: T): Recorded<T> {
  return { ok: true, value }
}
