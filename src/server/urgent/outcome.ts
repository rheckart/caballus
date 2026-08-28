/**
 * What an Urgent Send answers with: it went, or the one reason it did not —
 * the named-outcome discipline every other domain here follows, in its own
 * small file because none of these is a refusal a Shift or an Announcement
 * write already names.
 */

export type Refusal =
  | 'shift_not_found'
  | 'announcement_not_found'
  /** Nothing to shout about: nobody has called this Shift short. */
  | 'not_short'
  /** Already put in front of people. Nobody is told twice (ADR 0028). */
  | 'already_sent'
  /** Expired, so the news it carried has already stopped being news. */
  | 'announcement_expired'
  /**
   * No transport. A distinct refusal rather than a send that reaches nobody,
   * because *nothing is configured* is a fact about the deployment and
   * `sent: 0` reads like everybody has left the rescue.
   */
  | 'sms_not_configured'

export type Recorded<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export function refused(because: Refusal): Recorded<never> {
  return { ok: false, because }
}

export function recorded<T>(value: T): Recorded<T> {
  return { ok: true, value }
}
