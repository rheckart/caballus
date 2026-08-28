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
 * Where a text points, and **it is an argument rather than configuration**
 * (#83).
 *
 * Every message this application sent said *open the app* and gave no way to
 * open it — a link the volunteer has to be the router for, on a phone, in a
 * barn, from a message that has just told them something is urgent. It is also
 * the weaker answer at the campaign form: 10DLC vetting asks whether the
 * traffic carries embedded links, and samples that carry one against traffic
 * that does not is the mismatch carriers flag for (#76, ADR 0028).
 *
 * The origin is passed in because this module is pure and table-tested, and a
 * composer that reaches for `process.env` is a composer no table test can
 * drive. `src/server/urgent/send.ts` is the caller that knows the environment,
 * the same seam that already resolves the transport. `APP_URL` is what it
 * passes — already the real origin on the box and `http://localhost:3000` on a
 * development one, which is exactly right: a development send must not name
 * production.
 *
 * **Never a shortener.** bit.ly and its kind are the most reliable way to have
 * a campaign blocked, because a carrier cannot see where the link goes. The
 * brand's own domain is the whole point.
 *
 * Unset is a real case and not an error: a box with no `APP_URL` composes the
 * sentence it composed before this ticket rather than one naming `undefined`.
 * The argument is **required and nullable** rather than defaulted, on
 * `applyToScheduled`'s own discipline (ADR 0001): a default is a decision the
 * next caller does not have to make, and the one it would make silently is the
 * linkless message this ticket exists to stop sending.
 */
function linkTo(origin: string | null, path: string): string | null {
  const trimmed = (origin ?? '').trim().replace(/\/+$/, '')
  return trimmed === '' ? null : `${trimmed}${path}`
}

/**
 * *We are short tonight.* The reply is the receipt (ADR 0028): somebody taps
 * Cover, which is already a record with a name on it, so the text asks for the
 * app and never for a reply.
 */
export function shortText(
  shift: {
    readonly shiftType: string
    readonly day: string
    readonly startTime: string
  },
  origin: string | null,
): string {
  // `/shifts` and never `/shifts/:shiftId`: Cover lives on the schedule, the
  // id is a uuid that would half again the message, and the Work Surface is
  // not the screen with the Cover button on it.
  const link = linkTo(origin, '/shifts')
  const asking = link === null ? 'Open the app to cover.' : `Cover it: ${link}`
  return `Caballus: ${shift.shiftType} on ${shift.day} at ${shift.startTime} is short. ${asking} ${STOP}`
}

/**
 * An Announcement whose news will not keep.
 *
 * The Announcement's own words, unedited. Nothing is ever said in a text that
 * is not already written somewhere it will still be true tomorrow — which is
 * the property the group chat never had.
 */
export function announcementText(text: string, origin: string | null): string {
  // Home, because that is where the unexpired Announcements are (#67): the
  // wall is the landing.
  const link = linkTo(origin, '')
  const more = link === null ? '' : `More: ${link} `
  return `Caballus: ${text.trim()} ${more}${STOP}`
}
