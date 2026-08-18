/**
 * The two facts `src/shared/staffing.ts` needs that are not on a roster row:
 * whether a Shift Type's feeding includes medication, and how long each
 * Volunteer has been here.
 *
 * Read once for the whole schedule rather than once per Shift. A fortnight is
 * about thirty Shifts, and thirty round trips for a fact that is the same on
 * every Tuesday is the shape of slowness that arrives quietly — the same
 * argument `src/server/roster/people.ts` makes for its five queries and a group
 * in memory.
 *
 * **The tenure read is deliberately not `peopleList`.** The Orientation date
 * sits behind `roster` with contact details and the year of a birth (ADR 0010,
 * ADR 0017), so the redacting read will not hand it over — correctly. It is
 * resolved here, on the server, used to order a suggestion, and **never
 * travels**: what crosses the wire is one volunteer id, which is on the floor
 * already because that person's name is on the roster the whole rescue reads.
 */
import { isNull } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import { volunteers } from '../../db/schema'
import { SHIFT_TYPES, type ShiftType } from '../../shared/feed-schedule'
import { shiftTypeIncludesMedication } from '../../shared/feed-schedule'
import type { AnyShiftType } from '../../shared/shifts'
import { dayString, type DayString } from '../../shared/time'
import { currentLinesForShiftType } from '../horses/feed-schedules'

export interface StaffingInputs {
  /**
   * The Shift Types whose current feeding includes a Product of medication kind.
   * A Pop-up is never in here: it has no Feed Schedule at all, so there is
   * nothing on it anybody has to be qualified to give.
   */
  readonly medicationShiftTypes: ReadonlySet<AnyShiftType>
  /**
   * When each Volunteer joined — the Orientation date, which is the barn's own
   * answer to *how long has she been here*. Absent for somebody not yet
   * oriented, who cannot be on a roster anyway (ADR 0011's hard block).
   */
  readonly tenure: ReadonlyMap<string, DayString | null>
}

export async function staffingInputs(db: OrgScopedDatabase): Promise<StaffingInputs> {
  const [lines, people] = await Promise.all([
    Promise.all(
      SHIFT_TYPES.map(async (shiftType): Promise<[ShiftType, boolean]> => [
        shiftType,
        shiftTypeIncludesMedication(await currentLinesForShiftType(db, shiftType)),
      ]),
    ),
    db
      .select({ id: volunteers.id, orientedOn: volunteers.orientedOn })
      .from(volunteers)
      .where(isNull(volunteers.removedAt)),
  ])

  return {
    medicationShiftTypes: new Set(
      lines.filter(([, includes]) => includes).map(([shiftType]) => shiftType),
    ),
    tenure: new Map(
      people.map((row) => [row.id, row.orientedOn === null ? null : dayString(row.orientedOn)]),
    ),
  }
}
