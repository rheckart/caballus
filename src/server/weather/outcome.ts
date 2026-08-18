/**
 * What a weather write answers with: it worked, or the one reason it did not.
 *
 * Its own union rather than the horses-and-Spaces one, for the reason that one
 * gives for not sharing the roster's: a Threshold's refusals — a number the
 * stance requires, a per-horse row against a rescue-wide kind — mean nothing to
 * a horse write, and a shared union would be one vocabulary carrying entries
 * most of its callers can never answer with.
 */

export type Refusal =
  | 'horse_not_found'
  /** A `follows_default` row for the rescue's own default, which *is* the number. */
  | 'threshold_value_required'
  /** A per-horse row for a kind that is one answer for the barn (ADR 0015). */
  | 'threshold_not_per_horse'
  /** Nobody has told this deployment where the barn is. */
  | 'coordinates_not_set'
  /** No provider answered and there was no earlier Reading of this day to reuse. */
  | 'forecast_unavailable'

export type Recorded<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export function refused(because: Refusal): Recorded<never> {
  return { ok: false, because }
}

export function recorded<T>(value: T): Recorded<T> {
  return { ok: true, value }
}
