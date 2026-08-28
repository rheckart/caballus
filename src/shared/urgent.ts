/**
 * The Urgent Send's two derivations and its two sentences (#77, ADR 0028).
 *
 * **Reachable is a derivation, not a column.** A mobile number on the record,
 * SMS Consent held, and no STOP against it — three facts that already exist,
 * combined here so the count shown before a send and the list the fan-out
 * actually walks cannot disagree. *This reaches 47 of 60* is the whole reason
 * it is shown at all: a sender who believes they told everyone and did not is
 * the failure the Facebook group already has, and reproducing it inside the app
 * would be the ticket failing at its own purpose.
 *
 * **The words are here and nowhere else**, for `src/shared/staffing.ts`'s own
 * reason: the phone previewing a send and the server writing it must not
 * describe Thursday differently.
 *
 * The sender name is **Caballus** rather than the rescue's own, and that is a
 * decision rather than laziness: it is the name on the public page a carrier's
 * vetting reviewer reads (#75), and a text a volunteer cannot match to
 * something they have seen is a text they treat as spam.
 */

/** The three facts reachability is derived from. Structural, like `Alertish`. */
export interface Reachability {
  readonly mobile: string | null
  readonly smsConsentAt: number | null
  readonly smsStoppedAt: number | null
}

/**
 * Whether this person can actually receive an Urgent Send.
 *
 * All three, and the third is the one people forget: a volunteer who replied
 * STOP has told the carrier, the carrier will refuse the message anyway, and
 * counting them as reachable turns *this reaches 47 of 60* into a number that
 * is quietly wrong in the direction that matters.
 */
export function isReachable(person: Reachability): boolean {
  return person.mobile !== null && person.smsConsentAt !== null && person.smsStoppedAt === null
}

/**
 * What a sender is shown before they confirm.
 *
 * The shortfall is named rather than left to arithmetic, because the number
 * that changes somebody's mind is *13 will not get this* and not *47*.
 */
export function reachSentence(reachable: number, total: number): string {
  if (total === 0) return 'There is nobody to text.'
  if (reachable === 0)
    return `This reaches nobody. All ${String(total)} are without a number, without consent, or have replied STOP.`
  if (reachable === total) return `This reaches all ${String(total)}.`
  return `This reaches ${String(reachable)} of ${String(total)} — ${String(
    total - reachable,
  )} will not get it.`
}

/** The tail every message carries, because a carrier expects it on every one. */
const STOP = 'Reply STOP to stop.'

/**
 * *We are short tonight.* The reply is the receipt (ADR 0028): somebody taps
 * Cover, which is already a record with a name on it, so the text asks for the
 * app and never for a reply.
 */
export function shortText(shift: {
  readonly shiftType: string
  readonly day: string
  readonly startTime: string
}): string {
  return `Caballus: ${shift.shiftType} on ${shift.day} at ${shift.startTime} is short. Open the app to cover. ${STOP}`
}

/**
 * An Announcement whose news will not keep.
 *
 * The Announcement's own words, unedited. Nothing is ever said in a text that
 * is not already written somewhere it will still be true tomorrow — which is
 * the property the group chat never had.
 */
export function announcementText(text: string): string {
  return `Caballus: ${text.trim()} ${STOP}`
}
