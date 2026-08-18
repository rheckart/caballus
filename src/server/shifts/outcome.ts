/**
 * What a Shift write answers with: it worked, or the one reason it did not.
 *
 * Its own union rather than the roster's, for the reason the horses one gives:
 * *this Volunteer is not rosterable* and *somebody already holds Lead here* are
 * sentences a volunteer write can never answer with, and a shared union would
 * be one vocabulary carrying entries most of its callers cannot mean.
 */

export type Refusal =
  | 'pattern_not_found'
  | 'shift_not_found'
  | 'volunteer_not_found'
  /**
   * The #34 gates, which are a **hard block with no override** at both doors —
   * a Standing Roster and a single dated Shift (ADR 0011).
   */
  | 'not_rosterable'
  /**
   * The one gate on a Cover. Nothing else refuses one: a Shift needing
   * medication still takes somebody who cannot give it, and says what it still
   * needs (ADR 0011).
   */
  | 'no_orientation'
  /** At most one `lead` on a Shift or a Pattern (ADR 0010). */
  | 'lead_already_held'
  /** Already on this roster, and standing — a second row would be a second person. */
  | 'already_rostered'
  /** Not on this roster at all, which is a different fact from having dropped. */
  | 'not_rostered'
  /**
   * A Shift on a day that is over. Sign-up stays open until a Shift *closes*
   * rather than until it starts (ADR 0011), and until Close exists this is the
   * coarsest honest reading of that.
   */
  | 'shift_is_over'

export type Recorded<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export function refused(because: Refusal): Recorded<never> {
  return { ok: false, because }
}

export function recorded<T>(value: T): Recorded<T> {
  return { ok: true, value }
}
