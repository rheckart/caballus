/**
 * The Urgent Send: putting a record that already exists in front of people by
 * text (#77, ADR 0028).
 *
 * **It is a send, not a noun.** There is no Message, no Broadcast and no
 * Notification table — the two cases are records the app already holds, and
 * what is stored is who sent it and when, in two columns on that record. That
 * is what keeps the model from growing a fifth way to say something, and it is
 * why this module writes `shifts.urgent_sent_at` and
 * `announcements.urgent_sent_at` rather than inserting anywhere.
 *
 * **Two cases and nothing else, ever.** A Shift declared Short, and an
 * Announcement whose news will not keep. The evening digest, Escalations,
 * Drops and sign-in codes all stay on email, on ADR 0004's rule that a fact
 * never travels by both channels — a channel that carries everything means
 * nothing, which is exactly how the Facebook group failed. A colicking horse is
 * deliberately not on the list either: ADR 0010 says a real emergency is a
 * phone call, and the failure mode is a volunteer typing into the app, feeling
 * finished, and not dialling.
 *
 * **A gap is visible before the send and not after it.** `reachFor` answers the
 * same count the fan-out will actually walk, derived by the same
 * `isReachable` — a sender who believes they told everyone and did not is the
 * failure this ticket exists to fix, and reproducing it inside the app would be
 * the ticket failing at its own purpose.
 *
 * **The fan-out runs inside `mutation`'s transaction, and that is a known
 * cost rather than an oversight.** Every write in this application goes through
 * `mutation`, which opens the transaction and hands the handler the scoped
 * handle — there is no seam for a side effect after the commit, and inventing
 * one for this would be a change to the write layer rather than to this module.
 * `sendStaffingDigest` already sends up to sixty emails the same way. What it
 * costs is a pooled connection held for the length of the fan-out, and a
 * window in which the texts have gone and a failing commit rolls the record
 * back. Both writes are `neverQueued`, so nothing retries on its own; a person
 * pressing again after an error is the case that could tell somebody twice, and
 * they would have seen the error. The stamp is written **before** the fan-out
 * so that everything after it is a read-free tail, which is the most this shape
 * allows.
 *
 * **A STOP is written down when the carrier reports it.** Twilio is the system
 * of record for an opt-out and legally has to be; it refuses the message itself
 * and answers 21610. Catching that here and stamping `sms_stopped_at` is what
 * makes the *next* count right, without this application owning an inbound
 * webhook for a stranger's POST.
 */
import { and, eq, isNull } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import { announcements, shifts, volunteers } from '../../db/schema'
import { announcementText, isReachable, shortText } from '../../shared/urgent'
import { SHIFT_TYPE_LABEL, isAnyShiftType } from '../../shared/shifts'
import type { DayString } from '../../shared/time'
import { log } from '../observability'
import { peopleList, type Person } from '../roster/people'
import { mayCover } from '../shifts/gates'
import { shiftList } from '../shifts/list'
import { sendText, smsIsConfigured, wasUnsubscribed, TextNotSentError } from '../sms'
import { now } from '../../shared/time'
import { timestampOf } from '../time'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

/** How many of how many, for one prospective send. */
export interface Reach {
  readonly reachable: number
  readonly total: number
}

/**
 * What a sender is shown before confirming, for both cases in one read.
 *
 * One read rather than two, and the per-Shift half carried whole rather than
 * asked for a Shift at a time: the Shifts screen shows a row per Shift and
 * would otherwise fire a request per row.
 */
export interface ReachReport {
  /** Everybody, which is the Announcement's audience. */
  readonly everyone: Reach
  /** Per Shift, which is *who could cover it* rather than everybody. */
  readonly shifts: readonly { readonly shiftId: string; readonly reach: Reach }[]
}

export async function reachFor(
  db: OrgScopedDatabase,
  today: DayString,
  timeZone: string,
): Promise<ReachReport> {
  const [people, schedule] = await Promise.all([
    // `true`, like `notify.ts` and `digest.ts`: this read is *addressing*
    // people, and nothing from it reaches a screen but a count.
    peopleList(db, today, true),
    shiftList(db, today, timeZone),
  ])

  const byId = new Map(people.map((person) => [person.id, person]))
  return {
    everyone: countOf(people),
    shifts: schedule.map((shift) => ({
      shiftId: shift.id,
      reach: countOf(coverersOf(people, byId, shift)),
    })),
  }
}

/**
 * *We are short tonight*, to the people who could actually turn up (#77).
 *
 * **Not to the Shift's own roster.** Texting the people already coming is noise
 * to them and reaches nobody who could help; the point of the send is a Cover,
 * so the audience is whoever `mayCover` would let on — an Orientation and
 * nothing else, deliberately not `rosterable`, because a lapsed Release must
 * not hide work from somebody offering to come (ADR 0011, #67).
 */
export async function sendShortText(
  db: OrgScopedDatabase,
  actorVolunteerId: string,
  about: { readonly shiftId: string; readonly today: DayString; readonly timeZone: string },
): Promise<Recorded<Sent>> {
  if (!smsIsConfigured()) return refused('sms_not_configured')

  const [shift] = await db
    .select({
      id: shifts.id,
      day: shifts.day,
      shiftType: shifts.shiftType,
      startTime: shifts.startTime,
      declaredAt: shifts.shortDeclaredAt,
      clearedAt: shifts.shortClearedAt,
      sentAt: shifts.urgentSentAt,
    })
    .from(shifts)
    .where(eq(shifts.id, about.shiftId))
    .limit(1)
  if (shift === undefined) return refused('shift_not_found')

  const declaredAt = shift.clearedAt === null ? shift.declaredAt : null
  if (declaredAt === null) return refused('not_short')
  // A send already made **against this declaration**. Declaring Short again
  // after a clear writes a later `short_declared_at`, which re-opens the send
  // without any column having to be reset — a second genuine shortage on the
  // same Shift is a second thing worth saying.
  if (shift.sentAt !== null && shift.sentAt >= declaredAt) return refused('already_sent')

  const [people, schedule] = await Promise.all([
    peopleList(db, about.today, true),
    shiftList(db, about.today, about.timeZone),
  ])
  const byId = new Map(people.map((person) => [person.id, person]))
  const listed = schedule.find((one) => one.id === about.shiftId)
  const audience = listed === undefined ? [] : coverersOf(people, byId, listed)

  // Stamped before the fan-out: everything after this is HTTP and a log line,
  // so the transaction has nothing left that can fail on its own account.
  await db
    .update(shifts)
    .set({ urgentSentAt: timestampOf(now()), urgentSentBy: actorVolunteerId })
    .where(eq(shifts.id, about.shiftId))

  const message = shortText(
    {
      shiftType: isAnyShiftType(shift.shiftType)
        ? SHIFT_TYPE_LABEL[shift.shiftType]
        : shift.shiftType,
      day: shift.day,
      // `HH:MM` — the column carries seconds and nobody says them out loud.
      startTime: shift.startTime.slice(0, 5),
    },
    appOrigin(),
  )
  const outcome = await deliver(db, audience, message, { kind: 'shift_short', shiftId: shift.id })

  return recorded(outcome)
}

/**
 * An Announcement whose news will not keep (#77, amending ADR 0018).
 *
 * Posting still sends nothing — the wall is still a wall. This is the second
 * deliberate act, and it can only happen once: an Announcement is posted once,
 * an edit does not re-open it, and *nobody is told twice* is what the absence
 * of a clearing path keeps.
 */
export async function sendAnnouncementText(
  db: OrgScopedDatabase,
  actorVolunteerId: string,
  about: { readonly announcementId: string; readonly today: DayString },
): Promise<Recorded<Sent>> {
  if (!smsIsConfigured()) return refused('sms_not_configured')

  const [posted] = await db
    .select({
      id: announcements.id,
      text: announcements.text,
      expiresOn: announcements.expiresOn,
      sentAt: announcements.urgentSentAt,
    })
    .from(announcements)
    .where(eq(announcements.id, about.announcementId))
    .limit(1)
  if (posted === undefined) return refused('announcement_not_found')
  if (posted.sentAt !== null) return refused('already_sent')
  // An expired Announcement is off the wall already; texting sixty people
  // something the app itself has stopped showing is the opposite of *news that
  // will not keep*.
  if (posted.expiresOn < about.today) return refused('announcement_expired')

  const people = await peopleList(db, about.today, true)

  // Stamped before the fan-out, for the reason `sendShortText` gives.
  await db
    .update(announcements)
    .set({ urgentSentAt: timestampOf(now()), urgentSentBy: actorVolunteerId })
    .where(eq(announcements.id, about.announcementId))

  const outcome = await deliver(db, people, announcementText(posted.text, appOrigin()), {
    kind: 'announcement',
    announcementId: posted.id,
  })

  return recorded(outcome)
}

/**
 * Where the link in a text points (#83).
 *
 * **This module reads the environment and `src/shared/urgent.ts` does not.**
 * The composers are pure and table-tested; a composer that reaches for
 * configuration is one no table test can drive, so the origin travels in as an
 * argument from the one layer that already knows which box it is running on —
 * the same seam that resolves the transport.
 *
 * `APP_URL` is the variable, and it is the one Better Auth already reads for
 * its `baseURL` rather than a second one meaning the same thing. Unset answers
 * `null`, and the composers then say what they said before this ticket: a
 * development send must not name production, and a message naming `undefined`
 * would be worse than one naming nothing.
 */
function appOrigin(): string | null {
  return process.env.APP_URL ?? null
}

/** How many were meant to get it, and how many did. */
export interface Sent {
  readonly recipients: number
  readonly sent: number
  /** Everybody who could not be reached at all — no number, no consent, a STOP. */
  readonly unreachable: number
}

/**
 * The fan-out, and the one place a failure is handled.
 *
 * Per recipient, so one bad number does not stop the other fifty-nine, and
 * **reported rather than assumed**: `sent` against `recipients` is what makes a
 * half-delivered send visible instead of looking like a success. The shape
 * `sendStaffingDigest` already answers with, for the same reason.
 */
async function deliver(
  db: OrgScopedDatabase,
  audience: readonly Person[],
  message: string,
  about: Record<string, unknown>,
): Promise<Sent> {
  const reachable = audience.filter(canBeReached)
  let sent = 0

  for (const person of reachable) {
    const to = person.behindRoster?.mobile
    if (to === undefined || to === null) continue
    try {
      await sendText({ to, text: message })
      sent += 1
    } catch (cause) {
      log('warn', 'urgent_send_not_sent', {
        ...about,
        volunteerId: person.id,
        because: cause instanceof TextNotSentError ? cause.because : String(cause),
      })
      if (wasUnsubscribed(cause)) await recordStop(db, person.id)
    }
  }

  return { recipients: reachable.length, sent, unreachable: audience.length - reachable.length }
}

/**
 * Writes down a STOP the carrier just reported.
 *
 * Only where one is not already recorded, so the timestamp stays *when they
 * told us* rather than *the last time we tried*.
 */
async function recordStop(db: OrgScopedDatabase, volunteerId: string): Promise<void> {
  await db
    .update(volunteers)
    .set({ smsStoppedAt: timestampOf(now()) })
    .where(and(eq(volunteers.id, volunteerId), isNull(volunteers.smsStoppedAt)))
  log('info', 'sms_stop_recorded', { volunteerId })
}

/** The three reachability facts, or `null` for a reader who cannot see them. */
function reachabilityOf(person: Person) {
  const behind = person.behindRoster
  if (behind === null) return null
  return {
    mobile: behind.mobile,
    smsConsentAt: behind.smsConsentAt,
    smsStoppedAt: behind.smsStoppedAt,
  }
}

/** Whether this person can be reached, with the reader's own blindness folded in. */
function canBeReached(person: Person): boolean {
  const facts = reachabilityOf(person)
  return facts !== null && isReachable(facts)
}

function countOf(audience: readonly Person[]): Reach {
  return { reachable: audience.filter(canBeReached).length, total: audience.length }
}

/**
 * Who could cover this Shift: everybody `mayCover` would let on, minus the
 * people already standing on it.
 */
function coverersOf(
  people: readonly Person[],
  byId: ReadonlyMap<string, Person>,
  shift: {
    readonly roster: readonly {
      readonly volunteerId: string
      readonly endedAs: string | null
    }[]
  },
): readonly Person[] {
  const standing = new Set(
    shift.roster.filter((row) => row.endedAs === null).map((row) => row.volunteerId),
  )
  return people.filter((person) => !standing.has(person.id) && mayCover(byId, person.id).ok)
}
