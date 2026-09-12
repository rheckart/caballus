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
  /**
   * Somebody already carries Shift Authority here, so there is no Acting Lead
   * to claim.
   *
   * Its own refusal rather than `lead_already_held` because the two reach
   * different people: that one answers a Coordinator, whose fix is to take the
   * Lead off, and this one answers a volunteer standing in a barn, who has no
   * such option and needs a sentence they can act on. On a ticket whose premise
   * is that the copy is the design, one refusal serving both would be the
   * vaguer of the two.
   */
  | 'already_led'
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
  /**
   * Somebody already declared this Shift Short. Saying it twice is not a second
   * declaration, and answering *done* would quietly overwrite whose judgement
   * it was and when — which is the whole of what Short records (ADR 0011).
   */
  | 'already_short'
  /** Clearing a Shift nobody declared Short. Nothing to take back. */
  | 'not_short'
  /** A Shift already closed — immutable domain fact, and there is no reopen (ADR 0013, ADR 0014, #45). */
  | 'shift_already_closed'
  /** An empty Shift Note — there is nothing to append (#45). */
  | 'text_required'
  /**
   * Curating a Shift Note against a Shift whose Lead's window has already
   * closed, by somebody who holds only Shift Authority and not `horse_care`
   * (ADR 0010's amendment, #45): "the Lead's curation window closes with the
   * Shift," and only an officer's own scope reaches past it.
   */
  | 'shift_closed'
  /**
   * Moving the start time or the headcount of a Shift that has already
   * closed (#70). What was planned for it is a fact recorded at the time, and
   * changing it afterwards is the retroactive edit ADR 0001 rejected live
   * resolution to avoid. Its own refusal rather than `already_closed`, whose
   * sentence answers a second press of Close.
   */
  | 'shift_has_closed'
  /**
   * Unsent-and-visible-here work, an Open Attendance, or an undispositioned
   * Observation still stands (ADR 0013, ADR 0014, #45) — the single refusal a
   * retry cannot fix by itself; `closeBlockers` in `src/shared/shift-close.ts`
   * is what names them concretely, on the read the close screen already made.
   */
  | 'close_blocked'

export type Recorded<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export function refused(because: Refusal): Recorded<never> {
  return { ok: false, because }
}

export function recorded<T>(value: T): Recorded<T> {
  return { ok: true, value }
}
