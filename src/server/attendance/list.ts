/**
 * The two reads Attendance answers: the full ledger behind `roster`, and the
 * minimal per-Shift summary that rides on the floor-readable schedule
 * (ADR 0012).
 *
 * **Split deliberately, on ADR 0012's own tension.** The ADR argues Attendance
 * belongs on the read-everything floor and then declines to add it as a third
 * carve-out from ADR 0010's two — but this ticket's own acceptance puts the
 * hours *report* behind `roster`. Rather than serve the whole ledger twice at
 * two different gates, the sensitive half — descriptions, categories, who
 * recorded what, the Supervising Adult's phone number — stays behind `roster`
 * here, in `attendanceLedger`. What every Volunteer needs on the floor is
 * narrower: whether a rostered name has arrived, which is the fourth roster
 * fact (`src/shared/attendance.ts`'s `rosteredAbsent`) and nothing about why
 * they came or who else was told. `shiftAttendanceSummaries` answers only
 * that, and `src/server/shifts/list.ts` reads it into `/shifts` alongside the
 * roster it already carries.
 */
import { desc, eq, inArray, isNotNull } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import { attendance, volunteers } from '../../db/schema'
import { isAttendanceCategory, type AttendanceCategory } from '../../shared/attendance'
import type { DayString, Instant } from '../../shared/time'
import { dayOf, instantOfTimestamp } from '../time'

export interface AttendanceEntry {
  readonly id: string
  readonly volunteerId: string
  readonly volunteerName: string
  readonly shiftId: string | null
  readonly day: DayString
  readonly category: AttendanceCategory
  readonly description: string | null
  readonly arrivedAt: Instant
  readonly arrivedBy: string
  readonly arrivedByName: string
  readonly departedAt: Instant | null
  readonly departedBy: string | null
  readonly departedByName: string | null
  readonly supervisingAdultId: string | null
  readonly supervisingAdultName: string | null
  readonly supervisingAdultPhone: string | null
}

/**
 * The whole ledger, newest first — every Visit and every Shift sign-in, with
 * every name resolved so a report never has to make a second round trip.
 *
 * "Attendance is kept indefinitely" (ADR 0012), so this is unbounded like the
 * schedule and the horse list, on the same reasoning: a few thousand rows a
 * year is the cheapest data in the system, and a cap here would be the thing
 * that tells a student two years out that their hours are gone.
 */
export async function attendanceLedger(
  db: OrgScopedDatabase,
  timeZone: string,
): Promise<readonly AttendanceEntry[]> {
  const subject = volunteers
  const rows = await db
    .select({
      id: attendance.id,
      volunteerId: attendance.volunteerId,
      volunteerName: subject.name,
      shiftId: attendance.shiftId,
      category: attendance.category,
      description: attendance.description,
      arrivedAt: attendance.arrivedAt,
      arrivedBy: attendance.arrivedRecordedBy,
      departedAt: attendance.departedAt,
      departedBy: attendance.departedRecordedBy,
      supervisingAdultId: attendance.supervisingAdultId,
      supervisingAdultPhone: attendance.supervisingAdultPhone,
    })
    .from(attendance)
    .innerJoin(subject, eq(subject.id, attendance.volunteerId))
    .orderBy(desc(attendance.arrivedAt))

  const namesOf = new Set<string>()
  for (const row of rows) {
    namesOf.add(row.arrivedBy)
    if (row.departedBy !== null) namesOf.add(row.departedBy)
    if (row.supervisingAdultId !== null) namesOf.add(row.supervisingAdultId)
  }
  const names =
    namesOf.size === 0
      ? new Map<string, string>()
      : new Map(
          (
            await db
              .select({ id: volunteers.id, name: volunteers.name })
              .from(volunteers)
              .where(inArray(volunteers.id, [...namesOf]))
          ).map((row) => [row.id, row.name]),
        )

  return rows.map((row) => ({
    id: row.id,
    volunteerId: row.volunteerId,
    volunteerName: row.volunteerName,
    shiftId: row.shiftId,
    day: dayOf(instantOfTimestamp(row.arrivedAt), timeZone),
    category: isAttendanceCategory(row.category) ? row.category : 'other',
    description: row.description,
    arrivedAt: instantOfTimestamp(row.arrivedAt),
    arrivedBy: row.arrivedBy,
    arrivedByName: names.get(row.arrivedBy) ?? row.arrivedBy,
    departedAt: row.departedAt === null ? null : instantOfTimestamp(row.departedAt),
    departedBy: row.departedBy,
    departedByName: row.departedBy === null ? null : (names.get(row.departedBy) ?? row.departedBy),
    supervisingAdultId: row.supervisingAdultId,
    supervisingAdultName:
      row.supervisingAdultId === null ? null : (names.get(row.supervisingAdultId) ?? row.supervisingAdultId),
    supervisingAdultPhone: row.supervisingAdultPhone,
  }))
}

/** One Shift's sign-ins, as far as the fourth roster fact needs to see them. */
export interface ShiftAttendanceEntry {
  readonly shiftId: string
  readonly volunteerId: string
  readonly arrivedAt: Instant
  readonly departedAt: Instant | null
}

/**
 * Arrival and departure only, for every Shift with at least one sign-in — the
 * floor-readable slice that `/shifts` carries so a Lead can see who has
 * arrived without a `roster` grant, the same way `staffing` and `short`
 * already ride along on that read.
 */
export async function shiftAttendanceSummaries(
  db: OrgScopedDatabase,
): Promise<readonly ShiftAttendanceEntry[]> {
  const rows = await db
    .select({
      shiftId: attendance.shiftId,
      volunteerId: attendance.volunteerId,
      arrivedAt: attendance.arrivedAt,
      departedAt: attendance.departedAt,
    })
    .from(attendance)
    .where(isNotNull(attendance.shiftId))

  return rows
    .filter((row): row is typeof row & { shiftId: string } => row.shiftId !== null)
    .map((row) => ({
      shiftId: row.shiftId,
      volunteerId: row.volunteerId,
      arrivedAt: instantOfTimestamp(row.arrivedAt),
      departedAt: row.departedAt === null ? null : instantOfTimestamp(row.departedAt),
    }))
}
