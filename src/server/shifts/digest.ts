/**
 * The evening digest — **the one thing Caballus sends about staffing**
 * (ADR 0011).
 *
 * ADR 0009 took SMS away before this problem was designed, so the Facebook
 * group keeps the urgent broadcast and the app takes the half the group has
 * always been bad at: knowing who actually committed. What is left to send is
 * one predictable message at a known hour to **a fixed handful whose actual job
 * is the roster** — holders of `roster`, which is officers too because they
 * hold every scope. It never mails the roster of sixty, and there is nothing
 * else it sends.
 *
 * That is not a hole in ADR 0009's argument, it is that argument applied
 * correctly: the dilution failure is sixty people learning that mail from the
 * app means nothing, and without this, ADR 0001's promise that an Unstaffed
 * Shift "stays visible and escalates" has no mechanism behind it at all.
 *
 * **Evening rather than morning**, because a Coordinator can still do something
 * about tomorrow and a 6am digest arrives after the moment to act on the
 * morning shift has passed. **Tomorrow and the day after**, Unstaffed and
 * no-Lead first.
 *
 * **It goes out even when nothing is missing**, and that is deliberate. A
 * message that stops arriving is indistinguishable from a message that broke,
 * and the whole value of this one is that a handful of people learn to expect
 * it — the same property ADR 0009 spends its argument protecting, pointed at
 * the channel rather than at the volume.
 *
 * **Its trigger is deliberate.** Like `/weather/readings` and generation, the
 * hand that runs it is a person's until there is a scheduler, because an
 * in-process interval pretending to be durable is a job that stops the next
 * time the container restarts and nobody notices for a fortnight (ADR 0007).
 */
import type { OrgScopedDatabase } from '../../db/for-org'
import { isUrgentGap, staffingFacts } from '../../shared/staffing'
import type { DayString } from '../../shared/time'
import { sendEmail, EmailNotSentError } from '../email'
import { log } from '../observability'
import { peopleList } from '../roster/people'
import { addDays } from '../time'
import { shiftList, type ShiftRecord } from './list'

/** How far ahead the digest looks: tomorrow, and the day after (ADR 0011). */
export const DIGEST_DAYS = 2

export interface DigestSent {
  /** How many holders of `roster` it was addressed to. */
  readonly recipients: number
  /** How many actually left. Reported rather than assumed — see below. */
  readonly sent: number
  /** How many Shifts it had something to say about. */
  readonly shifts: number
}

/**
 * Composes the digest and sends it.
 *
 * The count that comes back is the honest one: a send that fails takes a line
 * in the log and lowers `sent`, and nothing here swallows it. `src/server/email.ts`
 * is emphatic about that for the sign-in code — a volunteer standing in a barn
 * waiting for a message that never left — and a Coordinator who thinks the
 * digest went out is the same failure a day slower.
 */
export async function sendStaffingDigest(
  db: OrgScopedDatabase,
  clock: { readonly today: DayString; readonly timeZone: string; readonly organisation: string },
): Promise<DigestSent> {
  const { today, timeZone } = clock
  const [schedule, people] = await Promise.all([
    shiftList(db, today, timeZone),
    // `seesRoster: true`: this read is *addressing* the holders of `roster`, so
    // it needs the email addresses that read is behind. Nothing from it reaches
    // a screen.
    peopleList(db, today, true),
  ])

  const from = addDays(today, 1, timeZone)
  const until = addDays(today, DIGEST_DAYS, timeZone)
  const covered = schedule.filter((shift) => shift.day >= from && shift.day <= until)
  const reportable = [...covered.filter(worthReporting)].sort(byUrgencyThenDay)

  const recipients = people
    .filter((person) => person.domainScopes.includes('roster'))
    .map((person) => person.behindRoster?.email)
    .filter((email): email is string => email !== undefined)

  const message = {
    subject: `${clock.organisation}: shifts for ${from} and ${until}`,
    text: digestText(reportable, { from, until }),
  }

  let sent = 0
  for (const to of recipients) {
    try {
      await sendEmail({ to, ...message })
      sent += 1
    } catch (cause) {
      // One address failing must not stop the other four arriving — and the
      // failure is a line rather than a swallow, because "did we mail Priya at
      // all" is the question this log exists to answer (ADR 0007).
      log('warn', 'digest_not_sent', {
        to,
        because: cause instanceof EmailNotSentError ? cause.because : String(cause),
      })
    }
  }

  return { recipients: recipients.length, sent, shifts: reportable.length }
}

/**
 * Whether a Shift belongs in the digest: something is missing, or somebody
 * declared it Short.
 *
 * Both, because they are different facts and the digest is the surface where
 * that difference is worth the most. Arithmetic found the first; a person's
 * judgement is the second, and a Shift at two of three that the Lead says can
 * still be worked is not in here on the arithmetic's account alone.
 */
function worthReporting(shift: ShiftRecord): boolean {
  return shift.staffing.gaps.length > 0 || shift.short !== null
}

function byUrgencyThenDay(left: ShiftRecord, right: ShiftRecord): number {
  const urgency = Number(urgent(right)) - Number(urgent(left))
  if (urgency !== 0) return urgency
  if (left.day !== right.day) return left.day < right.day ? -1 : 1
  return left.startTime < right.startTime ? -1 : left.startTime > right.startTime ? 1 : 0
}

function urgent(shift: ShiftRecord): boolean {
  return shift.staffing.gaps.some(isUrgentGap)
}

/**
 * The message, in plain text.
 *
 * Days as they are written — `2026-08-19` — rather than *Wednesday the 19th*,
 * because a friendly date is a day boundary derived somewhere, and ADR 0007
 * puts that in one module for one reason. The Shift's own day is unambiguous
 * and the recipient is looking at a calendar.
 *
 * It carries the concrete facts and nothing else. No volunteer's name, in the
 * spirit of ADR 0011's rule for the Facebook text: *Debbie dropped, we need
 * somebody* reads as pressure, and the digest is not the place a Coordinator
 * learns who let them down — the Shift screen is, where the row says so beside
 * the person's own reason.
 */
export function digestText(
  shifts: readonly ShiftRecord[],
  window: { readonly from: DayString; readonly until: DayString },
): string {
  const lines = [`Staffing for ${window.from} and ${window.until}.`, '']

  if (shifts.length === 0) {
    lines.push('Nothing is missing on either day, and nobody has declared a shift short.')
  } else {
    for (const shift of shifts) {
      lines.push(`${shift.day} ${shift.startTime} ${shift.shiftType}: ${facts(shift)}`)
    }
  }

  lines.push('', 'Nothing else is sent about staffing. Urgent calls still go to the group.')
  return lines.join('\n')
}

function facts(shift: ShiftRecord): string {
  const said = [...staffingFacts(shift)]
  // Named last and named plainly, so that the one fact a person is accountable
  // for is not read as another thing the app worked out.
  if (shift.short !== null) said.push('declared short by a person')
  return said.join('; ')
}
