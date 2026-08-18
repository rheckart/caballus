/**
 * What an Attendance write answers with: it worked, or the one reason it did
 * not.
 *
 * Its own small file rather than a shared one, the reason every other domain
 * here gives its own: *no description on a Visit* and *lead already held* are
 * sentences that mean nothing to each other's callers.
 */

export type Refusal =
  | 'volunteer_not_found'
  | 'shift_not_found'
  /** A Visit with no job in the volunteer's own words — the bottom section always has one (ADR 0012). */
  | 'description_required'
  /** A Visit's category, sent as `shift` or as something outside `VISIT_CATEGORIES`. */
  | 'category_invalid'
  /** Already arrived and not yet departed, for this Volunteer and this Shift-or-Visit. */
  | 'already_signed_in'
  /** Nothing open to close — never departed *and* never arrived read the same here. */
  | 'not_signed_in'

export type Recorded<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export function refused(because: Refusal): Recorded<never> {
  return { ok: false, because }
}

export function recorded<T>(value: T): Recorded<T> {
  return { ok: true, value }
}
