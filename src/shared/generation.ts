/**
 * Which Shifts a horizon is missing (ADR 0001's rolling two-week generation).
 *
 * Pure, for the reason `src/shared/board.ts` and `src/shared/conditions.ts`
 * are: the database read answers *which Patterns exist and what is already
 * generated*, the calendar answers *which days the horizon covers and what
 * weekday each is*, and everything past those two points is set arithmetic a
 * table of inputs exercises directly.
 *
 * **Idempotency is decided here and enforced in the table.** This function
 * answers with only the occurrences that do not exist yet, which is what makes
 * a second run create nothing; the unique index on `(org_id, pattern_id, day)`
 * is what makes two runs *at the same moment* create nothing twice. Neither is
 * sufficient alone, and the pair is why generation is a deliberate act that can
 * safely be repeated (#39).
 */
import type { DayString } from './time'
import type { Weekday } from './shifts'

/** A Shift Pattern, as far as generation needs to see one. */
export interface PatternToGenerate {
  readonly id: string
  readonly weekday: Weekday
}

/**
 * One day of the horizon and what weekday it is **in the organisation's
 * timezone** — resolved by the caller, because a weekday derived in the
 * browser's zone is right for most of the year and wrong at the edges that
 * matter (ADR 0007).
 */
export interface HorizonDay {
  readonly day: DayString
  readonly weekday: Weekday
}

/**
 * A Shift that already exists. `patternId` is null for a Pop-up, which is a
 * Shift with no Pattern behind it and therefore never an occurrence of one
 * (ADR 0011).
 */
export interface ExistingShift {
  readonly patternId: string | null
  readonly day: DayString
}

/** One occurrence to create. */
export interface ShiftToGenerate {
  readonly patternId: string
  readonly day: DayString
}

/**
 * Every occurrence the horizon wants and does not have, in day order.
 *
 * Day order rather than Pattern order so that a run interrupted halfway leaves
 * the near days done and the far ones missing, which is the direction that
 * matters: tomorrow's Shift existing is worth more than the one a fortnight
 * out.
 */
export function shiftsToGenerate(
  patterns: readonly PatternToGenerate[],
  horizon: readonly HorizonDay[],
  existing: readonly ExistingShift[],
): readonly ShiftToGenerate[] {
  // Keyed by Pattern *and* day: two Patterns on one Tuesday are two Shifts, and
  // a day-keyed check would let AM stand in for PM.
  const already = new Set(
    existing
      .filter((shift): shift is ExistingShift & { patternId: string } => shift.patternId !== null)
      .map((shift) => occurrence(shift.patternId, shift.day)),
  )

  const wanted: ShiftToGenerate[] = []
  for (const day of [...horizon].sort((left, right) => compare(left.day, right.day))) {
    for (const pattern of patterns) {
      if (pattern.weekday !== day.weekday) continue
      if (already.has(occurrence(pattern.id, day.day))) continue
      wanted.push({ patternId: pattern.id, day: day.day })
    }
  }
  return wanted
}

function occurrence(patternId: string, day: DayString): string {
  return `${patternId}:${day}`
}

function compare(left: DayString, right: DayString): number {
  return left < right ? -1 : left > right ? 1 : 0
}
