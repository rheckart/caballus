/**
 * What a Task, Task Assignment or materialization write answers with: it
 * worked, or the one reason it did not.
 *
 * Its own union rather than a shared one, for the reason the horses' and the
 * Shifts' own each give: *this Task requires a Shift Type it was not given*
 * is a sentence a horse or a Shift write can never answer with.
 */

export type Refusal =
  | 'task_not_found'
  | 'horse_not_found'
  | 'space_not_found'
  /** A Task Assignment names a Subject that does not match its Task's `subjectKind`. */
  | 'subject_kind_mismatch'
  /** `assigned` names no Shift Type, or `deliberately_none` named one it does not use. */
  | 'shift_type_required'

export type Recorded<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export function refused(because: Refusal): Recorded<never> {
  return { ok: false, because }
}

export function recorded<T>(value: T): Recorded<T> {
  return { ok: true, value }
}
