/**
 * What an Observation or Escalation write answers with: it worked, or the one
 * reason it did not.
 *
 * Its own small file rather than a shared one, the reason every other domain
 * here gives its own: *not the addressed Scope* and *description required*
 * are sentences that mean nothing to each other's callers.
 */

export type Refusal =
  | 'text_required'
  | 'framing_required'
  | 'note_required'
  | 'subject_kind_invalid'
  | 'subject_id_required'
  | 'subject_label_required'
  | 'subject_not_found'
  /** No open Attendance for the recorder against this Shift-or-Visit — nothing to attach to. */
  | 'attendance_not_found'
  /** Naming somebody else as the observer only makes sense on a Shift — a Visit has no Lead. */
  | 'on_behalf_requires_shift'
  /** Naming somebody else without holding Shift Authority over that Shift. */
  | 'not_shift_authority'
  /** The named observer is not on this Shift's roster. */
  | 'observer_not_rostered'
  | 'observation_not_found'
  | 'already_dispositioned'
  /** `noted_no_action` belongs to the Observation's own recorder alone. */
  | 'not_the_recorder'
  /** Neither Shift Authority over the Observation's Shift, nor a holder of the named Scope. */
  | 'not_authorized_to_escalate'
  | 'escalation_not_found'
  | 'already_closed'
  /** Closing belongs to a holder of the Escalation's own addressed Scope. */
  | 'not_the_addressed_scope'

export type Recorded<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export function refused(because: Refusal): Recorded<never> {
  return { ok: false, because }
}

export function recorded<T>(value: T): Recorded<T> {
  return { ok: true, value }
}
