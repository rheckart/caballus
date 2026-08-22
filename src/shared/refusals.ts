/**
 * What a refusal from the API says out loud.
 *
 * One table rather than one per screen. Every one of these sentences is a thing
 * a Coordinator will repeat on the phone, and three copies of *we could not
 * reach the app* is three chances for one of them to be the vague one — which
 * is the failure the login screen already wrote itself against: the message
 * names what to do about it, and never only what went wrong.
 *
 * The **fallback is the interesting case**. An `ApiError` the server named is a
 * refusal; anything else is the request not arriving at all, which in this
 * application is usually the connection rather than the app, and saying so is
 * the difference between a volunteer retrying and a volunteer concluding the
 * thing is broken.
 */
import { ApiError } from './api-client'

const REFUSALS: Record<string, string> = {
  not_authorized: 'You do not hold the scope that act needs.',
  email_taken: 'Somebody at the rescue already has that address.',
  date_of_birth_not_established:
    'Record a date of birth first — the ID is sighted at the same desk.',
  already_oriented: 'An orientation is already recorded, and it never lapses.',
  not_a_minor: 'That volunteer is 18 or over, so a consent would gate nothing.',
  self_recorded: 'A release is never self-recorded — somebody else has to hold the paper.',
  already_revoked: 'That signature is already revoked.',
  self_granted: 'Nobody grants themselves a role.',
  last_grants_holder:
    'That is the last person who can confer a role. Give somebody else an officer role first.',
  not_held: 'They do not hold that.',
  volunteer_not_found: 'That volunteer is not here any more.',
  release_version_not_found: 'That release version is gone.',
  signature_not_found: 'That signature is gone.',
  horse_not_found: 'That horse is not here any more.',
  alert_not_found: 'That alert is gone.',
  alert_already_ended: 'That alert has already been ended. Raise a new one if it is true again.',
  space_not_found: 'That Space is gone.',
  space_kind_mismatch: "That Space isn't the right kind for this assignment.",
  space_occupied: 'A horse still holds that Space. Clear it first.',
  threshold_value_required: 'Give the number, or put the horse on the rescue’s number instead.',
  threshold_not_per_horse: 'That number is one answer for the whole barn, not a per-horse one.',
  coordinates_not_set:
    'Nobody has told this deployment where the barn is. Set BARN_LATITUDE and BARN_LONGITUDE.',
  forecast_unavailable:
    'No weather service answered and there is no earlier forecast for today to fall back on. Try again shortly.',
  pattern_not_found: 'That shift pattern is gone.',
  shift_not_found: 'That shift is gone.',
  not_rosterable:
    'They cannot be put on a roster yet — the orientation, release or consent is missing.',
  no_orientation: 'An orientation is recorded before anyone takes a shift. Ask the coordinator.',
  lead_already_held: 'Somebody already holds Lead here. Take them off first, or use Co-Lead.',
  already_led: 'Somebody is already leading this shift.',
  already_rostered: 'They are already on this shift.',
  not_rostered: 'They are not on this shift.',
  shift_is_over: 'That shift is over.',
  already_short:
    'Somebody has already called this shift short. Clear it first if that has changed.',
  not_short: 'Nobody has called this shift short.',
  description_required: 'Say what the work was — a Visit needs a job in your own words.',
  category_invalid: 'Pick a category for the visit.',
  already_signed_in: 'Already signed in and not yet signed out.',
  not_signed_in: 'Nothing open to sign out of.',
  announcement_not_found: 'That announcement is gone.',
  contact_not_found: 'That contact is gone.',
  standing_rule_not_found: 'That rule is gone.',
  text_required: 'Say what you saw.',
  framing_required: 'Say it in your own words before sending it on.',
  note_required: 'A closing note is required.',
  subject_kind_invalid: 'Pick a subject from the list.',
  subject_id_required: 'Pick which one.',
  subject_label_required: 'Say what record you mean.',
  subject_not_found: 'That is gone.',
  attendance_not_found: 'Sign in first — there is nothing open to attach this to.',
  on_behalf_requires_shift: 'Naming somebody else only works on a Shift, never a Visit.',
  not_shift_authority: 'You need to be leading this Shift to record on somebody else’s behalf.',
  observer_not_rostered: 'They are not on this Shift.',
  observation_not_found: 'That observation is gone.',
  already_dispositioned: 'That is already dispositioned.',
  not_the_recorder: 'Only the person who recorded it may note it with no action.',
  not_authorized_to_escalate:
    'You need Shift Authority here, or to hold the Scope you are escalating to.',
  escalation_not_found: 'That escalation is gone.',
  whiteboard_reader_not_set:
    'Nobody has told this deployment how to read a whiteboard. Set OPENROUTER_API_KEY.',
  whiteboard_unreadable:
    'The photograph could not be read. Nothing was created. Try a straighter, brighter shot of the panel.',
  not_authorized_for_panel:
    'You do not hold every scope that panel writes into. The horse grid needs horse care; the phone numbers need roster.',
  already_closed: 'That escalation is already closed.',
  not_the_addressed_scope: 'Only a holder of the Scope this was sent to may close it.',
  observations_undispositioned:
    'Every Observation on this Visit needs a decision — Escalate, or note with no action — before signing out.',
  not_discretionary: 'Essential work cannot be Dropped — record it Not done, with a reason.',
  overdue_drop_withdrawn: 'This has gone too long undone to Drop. Record Not done, with a reason.',
  reason_required: 'Say why, in a few words.',
  volunteer_not_rostered: 'They are not on this Shift.',
  close_blocked: 'This Shift still has Unsent work, an Open Attendance, or an undecided report.',
  shift_closed: 'This Shift has closed — only an officer holding horse_care may still add a note.',
  note_text_required: 'Say what to put in the note.',
  not_on_this_shift: 'That report was not recorded on this Shift.',
  relative_may_not_attest: 'A parent, guardian or relative may not attest for this volunteer.',
  attestation_relationship_required: 'Say whether the Supervising Adult is a relative.',
}

/** What a failed call says when the server never answered at all. */
export const UNREACHABLE = 'We could not reach the app. Check the connection and try again.'

export function refusalText(error: unknown): string {
  if (!(error instanceof ApiError)) return UNREACHABLE

  const named = (error.body as { error?: unknown } | null)?.error
  if (typeof named !== 'string') return UNREACHABLE
  // A refusal this build has no sentence for is still a refusal, and showing
  // its name beats showing the connection message for something the server
  // plainly answered.
  return REFUSALS[named] ?? named
}
