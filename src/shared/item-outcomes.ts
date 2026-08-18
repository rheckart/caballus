/**
 * The four outcomes an Item can end as, and the one arithmetic ADR 0013 puts
 * on top of them: Discretionary tolerance (#45).
 *
 * Pure, for the reason every other derivation in this domain is: the database
 * answers *what did this Item's own history say*, and everything past that is
 * arithmetic a table of inputs can exercise directly — which is what lets the
 * phone and the close screen describe the same Item the same way.
 */

/** Everything a claim can record. Blank — nobody has answered — is the fourth, and is never written down (ADR 0013). */
export const ITEM_OUTCOMES = ['done', 'dropped', 'not_done'] as const

export type ItemOutcome = (typeof ITEM_OUTCOMES)[number]

export function isItemOutcome(value: string): value is ItemOutcome {
  return (ITEM_OUTCOMES as readonly string[]).includes(value)
}

/**
 * A skip is any outcome that is not Done, blanks included (ADR 0013):
 * "counting only honest Drops would let a Lead dodge the counter by leaving
 * items unanswered, rewarding the worse behaviour with the cleaner record."
 */
export function isSkip(outcome: ItemOutcome | null): boolean {
  return outcome !== 'done'
}

/**
 * How many of the most recent prior occurrences of this (Task, Subject) pair
 * were skips, counting from the most recent backwards and stopping at the
 * first Done — "the item shows as overdue" reads this run, not the whole
 * history (ADR 0013).
 *
 * `history` is newest first, one entry per prior occurrence: `true` for a
 * skip (Dropped, Not done, or blank — the caller already resolved blank to a
 * skip before this runs, since a still-open Item has no outcome to be `null`
 * about here), `false` for Done.
 */
export function consecutiveSkips(history: readonly boolean[]): number {
  let count = 0
  for (const wasSkip of history) {
    if (!wasSkip) break
    count += 1
  }
  return count
}

/**
 * Whether this Item has reached its Task's tolerance — "the item shows as
 * overdue and the Drop action is withdrawn" (ADR 0013). `toleranceCount` null
 * means never overdue.
 *
 * `priorSkips` excludes today's own occurrence: if leaving *this* Item as
 * anything but Done would be the `toleranceCount`-th skip in a row, it is
 * already overdue before anybody answers it — the same way a Lead reading
 * "not mucked for 3 shifts" on the third morning, not the fourth, is the
 * sentence ADR 0013 asks for.
 */
export function isOverdue(priorSkips: number, toleranceCount: number | null): boolean {
  return toleranceCount !== null && priorSkips + 1 >= toleranceCount
}

/**
 * Whether Drop is still open to this Item. Discretionary only, and never past
 * tolerance — "it can still go undone, because the app never blocks the barn,
 * but it can no longer be filed as a clean drop" (ADR 0013).
 */
export function mayDrop(priority: 'essential' | 'discretionary', overdue: boolean): boolean {
  return priority === 'discretionary' && !overdue
}
