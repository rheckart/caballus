/**
 * What a roster write answers with: it worked, or the one reason it did not.
 *
 * **A named outcome rather than a thrown error.** Every refusal below is one a
 * person can cause from a form — an Orientation ticked twice, a release
 * somebody tried to record about themselves, the last officer being taken away
 * — and a 500 would tell the Coordinator nothing about which. The handler turns
 * the name into a status; `src/server/api/app.ts` is the one place that mapping
 * lives.
 *
 * One union rather than one per module. `records.ts`, `grants.ts` and
 * `releases.ts` all refuse `volunteer_not_found`, and both doors to the roster
 * refuse `last_grants_holder` — so a second copy of the vocabulary would be two
 * lists to keep in step and a handler that has to union them back together.
 */

export type Refusal =
  | 'volunteer_not_found'
  | 'email_taken'
  | 'date_of_birth_not_established'
  | 'already_oriented'
  | 'not_a_minor'
  | 'self_recorded'
  | 'release_version_not_found'
  | 'signature_not_found'
  | 'already_revoked'
  | 'self_granted'
  | 'not_held'
  | 'last_grants_holder'

export type Recorded<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export function refused(because: Refusal): Recorded<never> {
  return { ok: false, because }
}

export function recorded<T>(value: T): Recorded<T> {
  return { ok: true, value }
}

/** The shape for a write with nothing to hand back. */
export function done(): Recorded {
  return { ok: true, value: null }
}
