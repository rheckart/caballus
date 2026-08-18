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
  space_not_found: 'That Space is gone.',
  space_kind_mismatch: "That Space isn't the right kind for this assignment.",
  space_occupied: 'A horse still holds that Space. Clear it before changing kind.',
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
