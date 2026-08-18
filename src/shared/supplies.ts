/**
 * The days-of-supply arithmetic: a reading that decrements, and floors at
 * zero (`CONTEXT.md`'s Days of Supply; ADR 0019, #47).
 *
 * Pure, for the reason `src/shared/rostering.ts` and `src/shared/staffing.ts`
 * are: the database answers *what was the last count, and when*, and
 * everything past that point is day arithmetic a table of inputs exercises
 * directly. `daysBetween` already carries the timezone discipline ADR 0007
 * asks for — day arithmetic has no meaning without one — so this module adds
 * nothing but the subtraction and the floor.
 *
 * **Nothing here derives a reading from a Feed Schedule.** A Feed Schedule
 * line's `amount` is free text — `"2 wells"` — and does not divide a sack; a
 * days-of-supply figure exists only because somebody stood in the feed room
 * and counted, the same reason there is no stock-level field anywhere in this
 * model.
 */
import { daysBetween, type DayString } from './time'

/** The last count against one Product: a date, and a number of days. */
export interface SuppliesReading {
  readonly daysRemaining: number
  readonly countedOn: DayString
}

/**
 * Today's figure: the last reading minus the days elapsed since it was
 * taken, floored at zero — never a negative number, which would be the app
 * asserting knowledge it does not have (ADR 0019). `null` when nothing has
 * ever been counted, which is a different fact from *zero* and stays one.
 */
export function projectedDaysRemaining(
  latest: SuppliesReading | null,
  today: DayString,
): number | null {
  if (latest === null) return null
  const elapsed = daysBetween(latest.countedOn, today)
  return Math.max(0, latest.daysRemaining - elapsed)
}

/**
 * Whether a Product's projected figure has reached its reorder point — the
 * one fact this ticket surfaces to `supplies` holders, never as an email
 * (ADR 0019). `false` for a Product that never opted in (no reorder point)
 * and for one nobody has counted yet (nothing to compare) — an unanswered
 * question reads as *not crossed* rather than as a false alarm.
 */
export function isAtOrBelowReorderPoint(
  projected: number | null,
  reorderPointDays: number | null,
): boolean {
  if (projected === null || reorderPointDays === null) return false
  return projected <= reorderPointDays
}
