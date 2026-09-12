/**
 * *Change just Thursday* (ADR 0001, #70).
 *
 * A Shift copies its start time and headcount from its Pattern when it is
 * generated, and that copy is what lets one Thursday differ from the rest: a
 * farrier coming at seven moves Thursday and leaves every other Thursday on
 * the Pattern's time. **This never touches the Pattern**, under any input —
 * moving the recurring commitment is `editPattern`'s act, behind `roster` and
 * its own apply-to-upcoming prompt.
 *
 * Current state plus an audit entry (ADR 0003), the same two fields
 * `editPattern` audits and nothing when neither moved.
 */
import { eq } from 'drizzle-orm'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { shifts } from '../../db/schema'
import { asTimeOfDay } from '../../shared/shifts'
import { audit } from '../roster/audit'
import { recorded, refused, type Recorded } from './outcome'

export interface ShiftEdit {
  readonly shiftId: string
  /** `HH:MM` on the barn's own clock. */
  readonly startTime?: string
  readonly targetHeadcount?: number
  readonly reason?: string | null
}

/**
 * Moves one dated Shift's start time or headcount.
 *
 * **A closed Shift is refused**: closing is where the record becomes
 * immutable domain fact (#45), and what was planned for a Shift that already
 * happened is not something to change afterwards.
 */
export async function editShift(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: ShiftEdit,
): Promise<Recorded<null>> {
  const [shift] = await db
    .select({
      startTime: shifts.startTime,
      targetHeadcount: shifts.targetHeadcount,
      closedAt: shifts.closedAt,
    })
    .from(shifts)
    .where(eq(shifts.id, about.shiftId))
    .limit(1)
  if (shift === undefined) return refused('shift_not_found')
  if (shift.closedAt !== null) return refused('shift_has_closed')

  // Normalised on both sides, for the reason `editPattern` gives: Postgres
  // answers `HH:MM:SS`, the barn writes `HH:MM`, and comparing the spellings
  // would audit 06:30:00 becoming 06:30 on every headcount change.
  const held = asTimeOfDay(shift.startTime)
  const startTime = about.startTime ?? held
  const targetHeadcount = about.targetHeadcount ?? shift.targetHeadcount

  const entries = []
  if (startTime !== held) {
    entries.push({
      entity: 'shift' as const,
      entityId: about.shiftId,
      field: 'start_time',
      before: held,
      after: startTime,
      reason: about.reason ?? null,
    })
  }
  if (targetHeadcount !== shift.targetHeadcount) {
    entries.push({
      entity: 'shift' as const,
      entityId: about.shiftId,
      field: 'target_headcount',
      before: String(shift.targetHeadcount),
      after: String(targetHeadcount),
      reason: about.reason ?? null,
    })
  }
  if (entries.length === 0) return recorded(null)

  await db.update(shifts).set({ startTime, targetHeadcount }).where(eq(shifts.id, about.shiftId))
  await audit(db, orgId, actorVolunteerId, entries)

  return recorded(null)
}
