/**
 * The two reads: the Patterns with their Standing Rosters, and the schedule
 * itself (`CONTEXT.md`'s Shift Pattern and Shift).
 *
 * One schedule read serves both surfaces — the Coordinator's desktop and a
 * volunteer's phone — because *my Thursday* and *the fortnight* are the same
 * rows read at two distances, and two reads would be two chances for the phone
 * to disagree with the desk about who is on Thursday.
 *
 * **Rosterability rides along on every roster row.** A volunteer who went stale
 * after being assigned is still on the Shift (ADR 0011 rejected gating at
 * generation) and the screen has to be able to say so — the flag ADR 0017 asks
 * for, in the one place somebody is looking at the roster.
 */
import { and, eq, gte } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import { shiftPatternRoster, shiftPatterns, shiftRoster, shifts, volunteers } from '../../db/schema'
import type { RosterGap } from '../../shared/rostering'
import {
  staffingGaps,
  suggestedActingLead,
  type StaffingGap,
  type StaffingMember,
} from '../../shared/staffing'
import {
  asTimeOfDay,
  isAnyShiftType,
  isRosterEndKind,
  isRosterOrigin,
  isShiftPosition,
  isStaffingMode,
  isWeekday,
  WEEKDAYS,
  type AnyShiftType,
  type RosterEndKind,
  type RosterOrigin,
  type ShiftPosition,
  type ShiftState,
  type StaffingMode,
  type Weekday,
} from '../../shared/shifts'
import { dayString, now, type DayString, type Instant } from '../../shared/time'
import { gatesOf } from './gates'
import { staffingInputs } from './staffing'
import { instantOfTimestamp, startOfShift } from '../time'

export interface StandingRosterMember {
  readonly volunteerId: string
  readonly name: string
  readonly position: ShiftPosition
  /** Derived against today, so a Coordinator building a roster sees the gate. */
  readonly rosterable: boolean
  readonly gaps: readonly RosterGap[]
}

export interface ShiftPatternRecord {
  readonly id: string
  readonly weekday: Weekday
  readonly shiftType: AnyShiftType
  readonly startTime: string
  readonly targetHeadcount: number
  readonly retired: boolean
  readonly roster: readonly StandingRosterMember[]
}

/** Every Pattern, live and retired, with its Standing Roster. */
export async function patternList(
  db: OrgScopedDatabase,
  today: DayString,
): Promise<readonly ShiftPatternRecord[]> {
  const [patternRows, rosterRows, people] = await Promise.all([
    db
      .select({
        id: shiftPatterns.id,
        weekday: shiftPatterns.weekday,
        shiftType: shiftPatterns.shiftType,
        startTime: shiftPatterns.startTime,
        targetHeadcount: shiftPatterns.targetHeadcount,
        retiredAt: shiftPatterns.retiredAt,
      })
      .from(shiftPatterns),
    db
      .select({
        patternId: shiftPatternRoster.patternId,
        volunteerId: shiftPatternRoster.volunteerId,
        position: shiftPatternRoster.position,
        name: volunteers.name,
      })
      .from(shiftPatternRoster)
      .innerJoin(volunteers, eq(volunteers.id, shiftPatternRoster.volunteerId))
      .orderBy(volunteers.name),
    gatesOf(db, today),
  ])

  const rosterBy = new Map<string, StandingRosterMember[]>()
  for (const row of rosterRows) {
    if (!isShiftPosition(row.position)) continue
    const person = people.get(row.volunteerId)
    const held = rosterBy.get(row.patternId) ?? []
    held.push({
      volunteerId: row.volunteerId,
      name: row.name,
      position: row.position,
      rosterable: person?.rosterable ?? false,
      gaps: person === undefined ? [] : [...person.gaps],
    })
    rosterBy.set(row.patternId, held)
  }

  return patternRows
    .filter((row) => isWeekday(row.weekday) && isAnyShiftType(row.shiftType))
    .map((row) => ({
      id: row.id,
      weekday: isWeekday(row.weekday) ? row.weekday : 'monday',
      shiftType: isAnyShiftType(row.shiftType) ? row.shiftType : 'pop_up',
      startTime: asTimeOfDay(row.startTime),
      targetHeadcount: row.targetHeadcount,
      retired: row.retiredAt !== null,
      roster: rosterBy.get(row.id) ?? [],
    }))
    .sort(byWeekdayThenTime)
}

export interface ShiftRosterMember extends StandingRosterMember {
  readonly origin: RosterOrigin
  /** Null while the commitment stands; otherwise how it ended (ADR 0011). */
  readonly endedAs: RosterEndKind | null
  readonly endedReason: string | null
  /**
   * The qualification, which is a grant on the Volunteer and not a position
   * here (ADR 0010) — beside the name because *nobody who can give medication*
   * is a sentence a screen has to be able to make concrete.
   */
  readonly medicationAuthority: boolean
}

/**
 * Short, as a person declared it (ADR 0011). Absent rather than false when
 * nobody has: *nobody has said this Shift is short* and *somebody said it and
 * then cleared it* are different facts, and the actor and time are the whole
 * point of recording it.
 */
export interface DeclaredShort {
  readonly declaredAt: Instant
  readonly declaredBy: string | null
}

/** What the app derives about a Shift's staffing — displayed, never announced. */
export interface ShiftStaffing {
  readonly gaps: readonly StaffingGap[]
  /**
   * Whom to offer the Acting Lead claim to first, or null where there is
   * nothing to claim. A suggestion and never a restriction (ADR 0010).
   */
  readonly suggestedActingLead: string | null
}

export interface ShiftRecord {
  readonly id: string
  readonly patternId: string | null
  readonly day: DayString
  readonly shiftType: AnyShiftType
  readonly startTime: string
  readonly targetHeadcount: number
  readonly staffingMode: StaffingMode
  readonly purpose: string | null
  /** Derived from the clock, not stored — Close is a later ticket (ADR 0001). */
  readonly state: ShiftState
  readonly roster: readonly ShiftRosterMember[]
  /** Computed. Four facts, never the internal phrase (ADR 0011). */
  readonly staffing: ShiftStaffing
  /** Declared. Null until a person says so, and null again once one clears it. */
  readonly short: DeclaredShort | null
}

/**
 * The schedule from `today` forward: every Shift, its roster, and who is on it
 * how.
 *
 * Dropped rows come back too, marked. *Beth was rostered and dropped* is the
 * fact the Coordinator most needs from this screen, and a read that filtered
 * them would answer the question *who is coming* while destroying the question
 * *what changed*.
 */
export async function shiftList(
  db: OrgScopedDatabase,
  today: DayString,
  timeZone: string,
): Promise<readonly ShiftRecord[]> {
  const [shiftRows, rosterRows, people, inputs] = await Promise.all([
    db
      .select({
        id: shifts.id,
        patternId: shifts.patternId,
        day: shifts.day,
        shiftType: shifts.shiftType,
        startTime: shifts.startTime,
        targetHeadcount: shifts.targetHeadcount,
        staffingMode: shifts.staffingMode,
        purpose: shifts.purpose,
        shortDeclaredAt: shifts.shortDeclaredAt,
        shortDeclaredBy: shifts.shortDeclaredBy,
        shortClearedAt: shifts.shortClearedAt,
      })
      .from(shifts)
      .where(gte(shifts.day, today))
      .orderBy(shifts.day, shifts.startTime),
    db
      .select({
        shiftId: shiftRoster.shiftId,
        volunteerId: shiftRoster.volunteerId,
        name: volunteers.name,
        position: shiftRoster.position,
        origin: shiftRoster.origin,
        endedKind: shiftRoster.endedKind,
        endedReason: shiftRoster.endedReason,
      })
      .from(shiftRoster)
      .innerJoin(shifts, eq(shifts.id, shiftRoster.shiftId))
      .innerJoin(volunteers, eq(volunteers.id, shiftRoster.volunteerId))
      .where(gte(shifts.day, today))
      .orderBy(volunteers.name),
    gatesOf(db, today),
    staffingInputs(db),
  ])

  const rosterBy = new Map<string, ShiftRosterMember[]>()
  for (const row of rosterRows) {
    if (!isShiftPosition(row.position) || !isRosterOrigin(row.origin)) continue
    const person = people.get(row.volunteerId)
    const held = rosterBy.get(row.shiftId) ?? []
    held.push({
      volunteerId: row.volunteerId,
      name: row.name,
      position: row.position,
      rosterable: person?.rosterable ?? false,
      gaps: person === undefined ? [] : [...person.gaps],
      origin: row.origin,
      endedAs: row.endedKind !== null && isRosterEndKind(row.endedKind) ? row.endedKind : null,
      endedReason: row.endedReason,
      medicationAuthority: person?.medicationAuthority ?? false,
    })
    rosterBy.set(row.shiftId, held)
  }

  const at = now()

  return shiftRows
    .filter((row) => isAnyShiftType(row.shiftType) && isStaffingMode(row.staffingMode))
    .map((row) => {
      const day = dayString(row.day)
      const shiftType = isAnyShiftType(row.shiftType) ? row.shiftType : 'pop_up'
      const roster = rosterBy.get(row.id) ?? []
      const subject = {
        targetHeadcount: row.targetHeadcount,
        needsMedication: inputs.medicationShiftTypes.has(shiftType),
        roster: roster.map((member): StaffingMember => ({
          volunteerId: member.volunteerId,
          position: member.position,
          endedAs: member.endedAs,
          medicationAuthority: member.medicationAuthority,
          since: inputs.tenure.get(member.volunteerId) ?? null,
        })),
      }
      return {
        id: row.id,
        patternId: row.patternId,
        day,
        shiftType,
        startTime: asTimeOfDay(row.startTime),
        targetHeadcount: row.targetHeadcount,
        staffingMode: isStaffingMode(row.staffingMode) ? row.staffingMode : 'standing_roster',
        purpose: row.purpose,
        // Derived rather than stored: nothing can honestly write the transition
        // until Attendance exists, and a column nothing sets would be a
        // lifecycle the app only pretends to have. A Shift whose start has
        // passed is under way; Close is what will end it (ADR 0001).
        state: startOfShift(day, row.startTime, timeZone) <= at ? 'in_progress' : 'scheduled',
        roster,
        // The pure derivation, handed exactly what it needs and nothing else:
        // *does this Shift's feeding need medication* is a question about Feed
        // Schedule versions, and *how long has she been here* is a question
        // behind `roster` — both answered before this point, so the arithmetic
        // itself stays a table of inputs (`src/shared/staffing.ts`).
        staffing: {
          gaps: staffingGaps(subject),
          suggestedActingLead: suggestedActingLead(subject),
        },
        // Declared and cleared by people. `clearedAt` after `declaredAt` is a
        // Shift that is no longer Short — read here rather than sent, because
        // *who cleared it* is not a fact any screen in this ticket shows.
        short:
          row.shortDeclaredAt === null || row.shortClearedAt !== null
            ? null
            : {
                declaredAt: instantOfTimestamp(row.shortDeclaredAt),
                declaredBy: row.shortDeclaredBy,
              },
      }
    })
}

/** One Shift, for a write that needs to know it exists. */
export async function shiftById(
  db: OrgScopedDatabase,
  shiftId: string,
): Promise<{ id: string; day: DayString } | null> {
  const [row] = await db
    .select({ id: shifts.id, day: shifts.day })
    .from(shifts)
    .where(and(eq(shifts.id, shiftId)))
    .limit(1)
  return row === undefined ? null : { id: row.id, day: dayString(row.day) }
}

/** The week in order, read off the vocabulary rather than spelled a second time. */
function byWeekdayThenTime(left: ShiftPatternRecord, right: ShiftPatternRecord): number {
  const days = WEEKDAYS.indexOf(left.weekday) - WEEKDAYS.indexOf(right.weekday)
  if (days !== 0) return days
  return left.startTime < right.startTime ? -1 : left.startTime > right.startTime ? 1 : 0
}
