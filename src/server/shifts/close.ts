/**
 * Closing a Shift — the record becoming true (ADR 0013, ADR 0014, #45).
 *
 * **Blocked by counts, not by a live scan the write invents on the spot.**
 * `src/shared/shift-close.ts`'s `closeBlockers` is the one place the sentence
 * is written, so the write's refusal and the close screen's button read the
 * same test — the write's own `unsentCount` is always `0`, because Unsent
 * work is a fact about a phone's own queue the server cannot see; the phone
 * folds its own count in before ever attempting this write.
 *
 * **An unmet Prep owed to this Shift Type becomes Not done, sent to
 * nobody** (ADR 0013): a Prep item still blank or otherwise unresolved when
 * the Shift it was owed to closes gets its reason prefilled and its actor
 * credited to whoever closed — a visible record in the vocabulary that
 * already exists, and no Observation, no Escalation, no email.
 */
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { attendance, itemOutcomes, items, observations, shifts } from '../../db/schema'
import { isItemOutcome } from '../../shared/item-outcomes'
import { closeBlockers } from '../../shared/shift-close'
import { dayString, now, type DayString } from '../../shared/time'
import { addDays, timestampOf } from '../time'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

/** The reason a Prep item unmet at close is filed under — a visible record, and nothing sent (ADR 0013). */
const UNMET_PREP_REASON = 'Not done: Prep was not completed before this Shift closed.'

/**
 * The concrete counts a close attempt is checked against — the same shape
 * `/shifts/:shiftId` hands the phone, computed fresh here rather than trusted
 * from a stale read.
 */
export async function closeCountsFor(
  db: OrgScopedDatabase,
  shiftId: string,
): Promise<{
  readonly openAttendanceCount: number
  readonly undispositionedObservationCount: number
}> {
  const [openAttendanceRows, undispositionedRows] = await Promise.all([
    db
      .select({ id: attendance.id })
      .from(attendance)
      .where(and(eq(attendance.shiftId, shiftId), isNull(attendance.departedAt))),
    db
      .select({ id: observations.id })
      .from(observations)
      .innerJoin(attendance, eq(attendance.id, observations.attendanceId))
      .where(and(eq(attendance.shiftId, shiftId), isNull(observations.dispositionedAt))),
  ])

  return {
    openAttendanceCount: openAttendanceRows.length,
    undispositionedObservationCount: undispositionedRows.length,
  }
}

export interface CloseShift {
  readonly shiftId: string
}

export async function closeShift(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: CloseShift,
  timeZone: string,
): Promise<Recorded<{ closedAt: number }>> {
  const [shift] = await db
    .select({
      id: shifts.id,
      day: shifts.day,
      shiftType: shifts.shiftType,
      closedAt: shifts.closedAt,
    })
    .from(shifts)
    .where(eq(shifts.id, about.shiftId))
    .limit(1)
  if (shift === undefined) return refused('shift_not_found')
  if (shift.closedAt !== null) return refused('already_closed')

  const counts = await closeCountsFor(db, about.shiftId)
  const blockers = closeBlockers({ unsentCount: 0, ...counts })
  if (blockers.length > 0) return refused('close_blocked')

  await recordUnmetPrep(
    db,
    orgId,
    { ...shift, day: dayString(shift.day) },
    actorVolunteerId,
    timeZone,
  )

  const at = now()
  await db
    .update(shifts)
    .set({ closedAt: timestampOf(at), closedBy: actorVolunteerId })
    .where(eq(shifts.id, about.shiftId))

  return recorded({ closedAt: at })
}

/**
 * Every Item Prep owed to this Shift's own Type, from today or yesterday,
 * still not Done — the same window `checklistForShift`'s `prepOwed` reads —
 * files as Not done, credited to whoever closed.
 */
async function recordUnmetPrep(
  db: OrgScopedDatabase,
  orgId: OrgId,
  shift: { readonly id: string; readonly day: DayString; readonly shiftType: string },
  actorVolunteerId: string,
  timeZone: string,
): Promise<void> {
  const yesterday = addDays(shift.day, -1, timeZone)

  const prepRows = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.prepForShiftType, shift.shiftType),
        gte(items.day, yesterday),
        lte(items.day, shift.day),
      ),
    )
  if (prepRows.length === 0) return

  const prepIds = prepRows.map((row) => row.id)
  const outcomeRows = await db
    .select({ itemId: itemOutcomes.itemId, outcome: itemOutcomes.outcome })
    .from(itemOutcomes)
    .where(inArray(itemOutcomes.itemId, prepIds))
    .orderBy(itemOutcomes.claimedAt)

  const latestByItem = new Map<string, string>()
  for (const row of outcomeRows) {
    if (isItemOutcome(row.outcome)) latestByItem.set(row.itemId, row.outcome)
  }

  const unmet = prepIds.filter((id) => latestByItem.get(id) !== 'done')
  if (unmet.length === 0) return

  await db.insert(itemOutcomes).values(
    unmet.map((itemId) => ({
      id: uuidv7(),
      orgId,
      itemId,
      shiftId: shift.id,
      outcome: 'not_done' as const,
      reason: UNMET_PREP_REASON,
      claimedBy: actorVolunteerId,
      late: false,
    })),
  )
}
