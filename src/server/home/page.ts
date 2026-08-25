/**
 * Home, composed (#67, ADR 0011, ADR 0014, ADR 0018).
 *
 * Four questions a volunteer standing in a field actually has — *when am I
 * next on*, *what has been posted*, *is anything short that I could cover*,
 * *what did I report that is still open* — answered in one read, on the
 * Board's own precedent (#36, #60): four requests is four ways to be
 * half-loaded, and this is the first screen opened, cold, on barn signal.
 *
 * **Nothing here is a new derivation.** Every section is an existing one,
 * filtered to the person asking: `shiftList` for the schedule, the
 * `staffingGaps` already on it, `currentAnnouncements` for the wall,
 * `escalationList` for the reports, and `mayCover` for the one gate ADR 0011
 * puts on a Cover. A second answer to *does Thursday have a Lead* is exactly
 * what `src/shared/staffing.ts` exists to prevent, so nothing in this module
 * counts a roster or writes a sentence.
 *
 * **Empty is empty and not a placeholder.** Each list comes back empty when
 * there is nothing in it, and the screen drops the whole section — ADR 0018's
 * existing rule about Announcements, applied to all four, because a heading
 * that is usually blank teaches people to stop reading under it.
 */
import { and, gte, isNotNull } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import { shifts } from '../../db/schema'
import { currentAnnouncements, type Announcement } from '../announcements/list'
import { escalationList } from '../observations/list'
import { gatesOf, mayCover } from '../shifts/gates'
import { shiftList, type ShiftRecord } from '../shifts/list'
import { PROMINENT_DAYS, standing, type StaffingGap } from '../../shared/staffing'
import { daysBetween, type DayString, type Instant } from '../../shared/time'
import type { AnyShiftType } from '../../shared/shifts'
import type { DomainScope } from '../../shared/domain-scopes'
import type { ShiftState } from '../../shared/shifts'

/** The Shift you are next standing on, and how many of your own follow it. */
export interface NextShift {
  readonly id: string
  readonly day: DayString
  readonly shiftType: AnyShiftType
  readonly startTime: string
  readonly purpose: string | null
  readonly state: ShiftState
  readonly more: number
}

/** One Shift short of people that this reader could Cover. */
export interface CoverableShift {
  readonly id: string
  readonly day: DayString
  readonly shiftType: AnyShiftType
  readonly startTime: string
  readonly targetHeadcount: number
  readonly standing: number
  readonly gaps: readonly StaffingGap[]
}

/** One open Escalation addressed to a Scope this reader holds. */
export interface OpenEscalation {
  readonly id: string
  readonly scope: DomainScope
  readonly framing: string
  readonly observationText: string
  readonly observationSubjectLabel: string | null
  readonly escalatedAt: Instant
  readonly comments: number
}

export interface HomePage {
  readonly nextShift: NextShift | null
  readonly announcements: readonly Announcement[]
  readonly cover: readonly CoverableShift[]
  readonly escalations: readonly OpenEscalation[]
}

/** Who is asking, as far as this module needs to know. */
export interface Reader {
  readonly volunteerId: string
  readonly domainScopes: readonly DomainScope[]
}

export async function homePage(
  db: OrgScopedDatabase,
  reader: Reader,
  today: DayString,
  timeZone: string,
): Promise<HomePage> {
  const held = new Set(reader.domainScopes)

  const [schedule, closed, announcements, escalations, people] = await Promise.all([
    shiftList(db, today, timeZone),
    closedShiftIds(db, today),
    currentAnnouncements(db, today),
    // Skipped entirely for a Volunteer holding no Scope, which is most of the
    // sixty: *yours* means addressed to a Scope you hold, so their answer is
    // provably empty — and `escalationList` is every Escalation ever recorded
    // with every comment on it and a name lookup per author. Paying for that
    // on the first screen opened cold in a barn, to filter it to nothing, is
    // the cost this composed read exists to avoid.
    held.size === 0 ? [] : escalationList(db),
    gatesOf(db, today),
  ])

  // A closed Shift is over. `shiftList` carries no closed state — `/shifts`
  // has never needed one — so it is asked for here rather than threaded
  // through a read three other screens already depend on the shape of.
  const open = schedule.filter((shift) => !closed.has(shift.id))
  const mine = open.filter((shift) => isStandingOn(shift, reader.volunteerId))

  return {
    nextShift: nextOf(mine),
    announcements,
    cover: coverable(open, mine, reader, people, today, held.has('roster')),
    escalations: escalations
      .filter((escalation) => escalation.closedAt === null && held.has(escalation.scope))
      .map((escalation) => ({
        id: escalation.id,
        scope: escalation.scope,
        framing: escalation.framing,
        observationText: escalation.observationText,
        observationSubjectLabel: escalation.observationSubjectLabel,
        escalatedAt: escalation.escalatedAt,
        comments: escalation.comments.length,
      })),
  }
}

/**
 * A roster row naming this person that has not ended.
 *
 * The same test `/shifts` renders *mine* from, so the dashboard and the Shifts
 * screen cannot disagree about whether Thursday is theirs. A Drop marks the row
 * rather than removing it (ADR 0011), and a dropped row is not a commitment.
 */
function isStandingOn(shift: ShiftRecord, volunteerId: string): boolean {
  return standing(shift.roster).some((member) => member.volunteerId === volunteerId)
}

/** The first of your own, with the rest counted behind it. */
function nextOf(mine: readonly ShiftRecord[]): NextShift | null {
  // `shiftList` already answers in `day, startTime` order from today forward,
  // so the first row is the next one and nothing here re-sorts it.
  const next = mine[0]
  if (next === undefined) return null

  return {
    id: next.id,
    day: next.day,
    shiftType: next.shiftType,
    startTime: next.startTime,
    purpose: next.purpose,
    state: next.state,
    more: mine.length - 1,
  }
}

/**
 * Shifts short of people that this reader could actually Cover.
 *
 * Three filters and no fourth.
 *
 * **You are not on it already.** Covering a Shift you stand on is what
 * `coverShift` refuses as `already_rostered`, and offering it here would be
 * offering a refusal.
 *
 * **It is missing something**, in the four-gap vocabulary ADR 0011 fixes. The
 * gaps travel; the sentences are `staffingFact`'s alone.
 *
 * **A Cover from you would not be refused**, which is `mayCover` and therefore
 * an Orientation and nothing else. Deliberately **not** `rosterable`: a
 * volunteer whose Release lapsed may still Cover — "a Shift needing medication
 * still takes somebody who cannot give it" — and filtering on the assignment
 * gate here would hide work from exactly the person ADR 0017 refuses to remove.
 *
 * `staffingMode` is **not** a fourth filter. `coverShift` never consults it, so
 * a Cover on a standing-roster Shift is accepted; hiding those here would mean
 * this section is quieter than the server is generous, which is the wrong
 * direction for a screen whose whole job is to find somebody to come.
 *
 * The window is ADR 0011's: the whole horizon for a holder of `roster`, and
 * roughly the next 48 hours for everybody else, because a fortnight of *no
 * Lead* on a phone is a screen people stop reading.
 */
function coverable(
  open: readonly ShiftRecord[],
  mine: readonly ShiftRecord[],
  reader: Reader,
  people: Awaited<ReturnType<typeof gatesOf>>,
  today: DayString,
  seesWholeHorizon: boolean,
): readonly CoverableShift[] {
  if (!mayCover(people, reader.volunteerId).ok) return []

  const standingOn = new Set(mine.map((shift) => shift.id))
  return open
    .filter((shift) => !standingOn.has(shift.id))
    .filter((shift) => shift.staffing.gaps.length > 0)
    .filter((shift) => seesWholeHorizon || daysBetween(today, shift.day) <= PROMINENT_DAYS)
    .map((shift) => ({
      id: shift.id,
      day: shift.day,
      shiftType: shift.shiftType,
      startTime: shift.startTime,
      targetHeadcount: shift.targetHeadcount,
      standing: standing(shift.roster).length,
      gaps: shift.staffing.gaps,
    }))
}

/** The Shifts from today forward that somebody has already closed (#45). */
async function closedShiftIds(
  db: OrgScopedDatabase,
  today: DayString,
): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(gte(shifts.day, today), isNotNull(shifts.closedAt)))
  return new Set(rows.map((row) => row.id))
}
