/**
 * What a Days-of-Supply reading or a Reorder write answers with: it worked,
 * or the one reason it did not (ADR 0019, #47).
 *
 * Its own small file rather than a shared one, the reason every other domain
 * here gives its own: *a closing note is required* and *this product is
 * gone* are sentences that mean nothing to each other's callers.
 */

export type Refusal =
  | 'product_not_found'
  /** Neither a `supplies` holder nor Shift Authority over the Shift named. */
  | 'not_authorized_to_record_reading'
  | 'reorder_not_found'
  | 'escalation_not_found'
  | 'already_closed'
  | 'note_required'
  | 'text_required'

export type Recorded<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export function refused(because: Refusal): Recorded<never> {
  return { ok: false, because }
}

export function recorded<T>(value: T): Recorded<T> {
  return { ok: true, value }
}
