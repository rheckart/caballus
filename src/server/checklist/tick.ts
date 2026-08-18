/**
 * Recording an outcome against one Item: Done, Dropped, Not done, and setting
 * or clearing the assignment hint (ADR 0013, #42, #45).
 *
 * **Every Item is completable by any Volunteer rostered on the Shift that
 * opened it** — never a Shift Authority check, which #34's floor already
 * refused as a third authorization axis smuggled in past ADR 0010's two. The
 * roster join happens here, against `about.shiftId`, because it is a fact
 * about this Shift's rows and not about the caller (the same shape
 * `claimActingLead` already gives its own "not rostered" refusal).
 *
 * **`shiftId` is the Shift open on the phone, not necessarily the Item's
 * own.** A per-Day Item's `items.shiftId` is null and belongs to the day
 * rather than to one Shift, so either Shift that day may satisfy it (ADR
 * 0013) — the check below is *this Shift owns this Item*, which is true for
 * the Item's own Shift and for any Shift sharing its day.
 *
 * **Medicate needs Medication Authority besides**, checked only where the
 * Item requires it — Feed is never gated (ADR 0013).
 *
 * **Dropping needs Shift Authority and is refused once the Item is
 * overdue** (ADR 0013, #45): `priorConsecutiveSkips` reads the most recent
 * prior occurrences of this (Task, Subject) pair, newest first, and
 * `isOverdue` is the same pure test the checklist read shows on the card, so
 * the write and the screen cannot disagree about when Drop stops being
 * offered.
 *
 * **Reversal appends and never deletes.** A second claim against an
 * already-claimed Item is a second fact, not an error: ADR 0013 gives no
 * authorship axis to police who may re-tick, and the current outcome is
 * whichever claim is latest.
 *
 * **A claim against a closed Shift is accepted and marked late** (ADR 0013):
 * rejecting it would throw away work that actually happened, and the close
 * record itself stays the truthful snapshot it was at the moment of close.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import {
  itemOutcomes,
  items,
  medicationAuthority,
  shiftRoster,
  shifts,
  tasks,
} from '../../db/schema'
import {
  consecutiveSkips,
  isOverdue,
  isSkip,
  mayDrop,
  type ItemOutcome,
} from '../../shared/item-outcomes'
import type { TaskPriority } from '../../shared/materialization'
import { now } from '../../shared/time'
import { timestampOf } from '../time'

export type Refusal =
  | 'shift_not_found'
  | 'item_not_found'
  | 'not_rostered'
  | 'medication_authority_required'
  | 'not_discretionary'
  | 'overdue_drop_withdrawn'
  | 'reason_required'
  | 'volunteer_not_rostered'
  /** Naming somebody other than yourself needs Shift Authority (ADR 0013, #45). */
  | 'not_shift_authority'

export type Recorded<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export function refused(because: Refusal): Recorded<never> {
  return { ok: false, because }
}

export function recorded<T>(value: T): Recorded<T> {
  return { ok: true, value }
}

interface ResolvedItem {
  readonly id: string
  readonly requiresMedicationAuthority: boolean
  readonly priority: TaskPriority
  readonly taskId: string | null
  readonly horseId: string | null
  readonly spaceId: string | null
  readonly toleranceCount: number | null
  /** Whether this Item's own Shift has already closed — a late claim, not a refusal (ADR 0013). */
  readonly late: boolean
}

/**
 * The Item this Shift may claim against, and whether it belongs here at all —
 * *this Shift's own Item, or a per-Day Item this Shift's day shares* — never
 * an Item that belongs to some other Shift entirely (ADR 0013).
 */
async function resolveItem(
  db: OrgScopedDatabase,
  about: { readonly shiftId: string; readonly itemId: string },
): Promise<Recorded<ResolvedItem>> {
  const [shift] = await db
    .select({ id: shifts.id, day: shifts.day, closedAt: shifts.closedAt })
    .from(shifts)
    .where(eq(shifts.id, about.shiftId))
    .limit(1)
  if (shift === undefined) return refused('shift_not_found')

  const [item] = await db
    .select({
      id: items.id,
      shiftId: items.shiftId,
      day: items.day,
      requiresMedicationAuthority: items.requiresMedicationAuthority,
      priority: items.priority,
      taskId: items.taskId,
      horseId: items.horseId,
      spaceId: items.spaceId,
      toleranceCount: tasks.toleranceCount,
    })
    .from(items)
    .leftJoin(tasks, eq(tasks.id, items.taskId))
    .where(eq(items.id, about.itemId))
    .limit(1)
  if (item === undefined) return refused('item_not_found')

  const onThisShift =
    item.shiftId === about.shiftId || (item.shiftId === null && item.day === shift.day)
  if (!onThisShift) return refused('item_not_found')

  return recorded({
    id: item.id,
    requiresMedicationAuthority: item.requiresMedicationAuthority,
    priority: item.priority === 'discretionary' ? 'discretionary' : 'essential',
    taskId: item.taskId,
    horseId: item.horseId,
    spaceId: item.spaceId,
    toleranceCount: item.toleranceCount,
    late: shift.closedAt !== null,
  })
}

async function isRostered(
  db: OrgScopedDatabase,
  shiftId: string,
  volunteerId: string,
): Promise<boolean> {
  const [rostered] = await db
    .select({ id: shiftRoster.id })
    .from(shiftRoster)
    .where(
      and(
        eq(shiftRoster.shiftId, shiftId),
        eq(shiftRoster.volunteerId, volunteerId),
        isNull(shiftRoster.endedAt),
      ),
    )
    .limit(1)
  return rostered !== undefined
}

/** The shape `priorConsecutiveSkips` needs of an Item — `ResolvedItem` satisfies it without adaptation. */
export interface TolerancedItem {
  readonly id: string
  readonly taskId: string | null
  readonly horseId: string | null
  readonly spaceId: string | null
  readonly toleranceCount: number | null
}

/**
 * How many of this (Task, Subject) pair's most recent prior occurrences —
 * excluding this Item itself — were skips, newest first. Bounded to
 * `toleranceCount` rows, because `consecutiveSkips` stops at the first Done
 * and nothing past the tolerance count could still change the answer.
 *
 * Exported for `src/server/checklist/materialize.ts`'s own read: the write
 * above and the checklist screen must agree about when an Item reads overdue,
 * so both call this rather than keeping two implementations in step by hand.
 */
export async function priorConsecutiveSkips(
  db: OrgScopedDatabase,
  item: TolerancedItem,
): Promise<number> {
  if (item.taskId === null || item.toleranceCount === null || item.toleranceCount <= 0) return 0

  const subjectMatch =
    item.horseId !== null
      ? eq(items.horseId, item.horseId)
      : item.spaceId !== null
        ? eq(items.spaceId, item.spaceId)
        : and(isNull(items.horseId), isNull(items.spaceId))

  const priorRows = await db
    .select({ id: items.id, materializedAt: items.materializedAt })
    .from(items)
    .where(and(eq(items.taskId, item.taskId), subjectMatch))
    .orderBy(desc(items.materializedAt))
    .limit(item.toleranceCount + 1)

  const priorIds = priorRows.map((row) => row.id).filter((id) => id !== item.id)
  if (priorIds.length === 0) return 0

  const outcomeRows = await db
    .select({
      itemId: itemOutcomes.itemId,
      outcome: itemOutcomes.outcome,
      claimedAt: itemOutcomes.claimedAt,
    })
    .from(itemOutcomes)
    .where(inArray(itemOutcomes.itemId, priorIds))
    .orderBy(itemOutcomes.claimedAt)

  const latestByItem = new Map<string, ItemOutcome | null>()
  for (const row of outcomeRows) {
    latestByItem.set(row.itemId, (row.outcome as ItemOutcome) ?? null)
  }

  // Newest first, matching `materializedAt desc` above — a prior Item nobody
  // claimed is blank, which counts as a skip like any other (ADR 0013).
  const history = priorIds.map((id) => isSkip(latestByItem.get(id) ?? null))
  return consecutiveSkips(history)
}

export interface TickItemDone {
  readonly shiftId: string
  readonly itemId: string
}

export async function tickItemDone(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: TickItemDone,
): Promise<Recorded<{ id: string }>> {
  const resolved = await resolveItem(db, about)
  if (!resolved.ok) return resolved
  const item = resolved.value

  if (!(await isRostered(db, about.shiftId, actorVolunteerId))) return refused('not_rostered')

  if (item.requiresMedicationAuthority) {
    const [held] = await db
      .select({ volunteerId: medicationAuthority.volunteerId })
      .from(medicationAuthority)
      .where(
        and(
          eq(medicationAuthority.volunteerId, actorVolunteerId),
          isNull(medicationAuthority.revokedAt),
        ),
      )
      .limit(1)
    if (held === undefined) return refused('medication_authority_required')
  }

  return recorded(
    await insertOutcome(db, orgId, item, about.shiftId, 'done', null, actorVolunteerId),
  )
}

export interface DropItem {
  readonly shiftId: string
  readonly itemId: string
  readonly reason?: string | null
}

/**
 * Drops a Discretionary Item — recorded, never silent (ADR 0013, #45). The
 * caller's Shift Authority is checked by `mutation`'s own join before this
 * runs; what is checked here is the Item itself, which Shift Authority alone
 * cannot answer: is it Discretionary at all, and has it already gone overdue.
 */
export async function dropItem(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: DropItem,
): Promise<Recorded<{ id: string }>> {
  const resolved = await resolveItem(db, about)
  if (!resolved.ok) return resolved
  const item = resolved.value

  if (item.priority !== 'discretionary') return refused('not_discretionary')

  const overdue = isOverdue(await priorConsecutiveSkips(db, item), item.toleranceCount)
  if (!mayDrop(item.priority, overdue)) return refused('overdue_drop_withdrawn')

  const reason = (about.reason ?? '').trim()
  return recorded(
    await insertOutcome(
      db,
      orgId,
      item,
      about.shiftId,
      'dropped',
      reason === '' ? null : reason,
      actorVolunteerId,
    ),
  )
}

export interface NotDoneItem {
  readonly shiftId: string
  readonly itemId: string
  readonly reason: string
}

/**
 * Records an Item Not done — available on anything, and the reason is
 * required (ADR 0013, #45). No Shift-Authority gate: this is also how a
 * deviation from the materialized plan is recorded by whoever is standing on
 * the Shift, the plan itself never changing mid-Shift.
 */
export async function notDoneItem(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: NotDoneItem,
): Promise<Recorded<{ id: string }>> {
  const resolved = await resolveItem(db, about)
  if (!resolved.ok) return resolved
  const item = resolved.value

  if (!(await isRostered(db, about.shiftId, actorVolunteerId))) return refused('not_rostered')

  const reason = about.reason.trim()
  if (reason === '') return refused('reason_required')

  return recorded(
    await insertOutcome(db, orgId, item, about.shiftId, 'not_done', reason, actorVolunteerId),
  )
}

/**
 * Writes one claim. `shiftId` is the Shift open on the phone that made it —
 * not always the Item's own, since a per-Day Item's is null (ADR 0013) — and
 * `late` is set from what `resolveItem` already read off that Shift.
 */
async function insertOutcome(
  db: OrgScopedDatabase,
  orgId: OrgId,
  item: ResolvedItem,
  shiftId: string,
  outcome: ItemOutcome,
  reason: string | null,
  actorVolunteerId: string,
): Promise<{ id: string }> {
  const id = uuidv7()
  await db.insert(itemOutcomes).values({
    id,
    orgId,
    itemId: item.id,
    shiftId,
    outcome,
    reason,
    claimedBy: actorVolunteerId,
    late: item.late,
  })
  return { id }
}

export interface AssignItem {
  readonly shiftId: string
  readonly itemId: string
  /** Null clears the assignment. */
  readonly volunteerId: string | null
}

/**
 * Sets or clears who is expected to do an Item — a hint, never a gate (ADR
 * 0013, #45). Self-claim needs only to be rostered on the Shift; naming
 * somebody else needs Shift Authority over it, checked here because half of
 * it — *is the named Volunteer actually on this roster* — is a fact about the
 * Shift's rows rather than about the caller.
 */
export async function assignItem(
  db: OrgScopedDatabase,
  actor: { readonly volunteerId: string; readonly holdsShiftAuthority: boolean },
  about: AssignItem,
): Promise<Recorded<null>> {
  const resolved = await resolveItem(db, about)
  if (!resolved.ok) return resolved

  const [current] = await db
    .select({ assignedToVolunteerId: items.assignedToVolunteerId })
    .from(items)
    .where(eq(items.id, about.itemId))
    .limit(1)
  const currentlyAssignedToActor = current?.assignedToVolunteerId === actor.volunteerId

  const selfClaiming = about.volunteerId === actor.volunteerId
  const selfClearing = about.volunteerId === null && currentlyAssignedToActor

  if (selfClaiming || selfClearing) {
    if (!(await isRostered(db, about.shiftId, actor.volunteerId))) return refused('not_rostered')
  } else {
    if (!actor.holdsShiftAuthority) return refused('not_shift_authority')
    if (about.volunteerId !== null && !(await isRostered(db, about.shiftId, about.volunteerId))) {
      return refused('volunteer_not_rostered')
    }
  }

  await db
    .update(items)
    .set({
      assignedToVolunteerId: about.volunteerId,
      assignedAt: about.volunteerId === null ? null : timestampOf(now()),
      assignedBy: about.volunteerId === null ? null : actor.volunteerId,
    })
    .where(eq(items.id, about.itemId))

  return recorded(null)
}
