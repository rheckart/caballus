/**
 * What a horses-and-Spaces write answers with: it worked, or the one reason it
 * did not.
 *
 * A named outcome rather than a thrown error, and its own small file rather
 * than a shared one with the roster's — the same shape, for the same reason
 * `src/server/roster/outcome.ts` gives, but a horse or a Space is never the
 * refusal a volunteer write names, so a shared union would be the roster's
 * vocabulary carrying entries that mean nothing to it.
 */

export type Refusal =
  | 'horse_not_found'
  | 'space_not_found'
  | 'space_kind_mismatch'
  | 'space_occupied'
  | 'product_not_found'
  | 'supplier_not_found'
  | 'alert_not_found'
  | 'alert_already_ended'

export type Recorded<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export function refused(because: Refusal): Recorded<never> {
  return { ok: false, because }
}

export function recorded<T>(value: T): Recorded<T> {
  return { ok: true, value }
}
