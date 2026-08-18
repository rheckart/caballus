/**
 * Ticking an Item Done: the retry queue's write, and the one gate ADR 0013
 * puts on it that Shift Authority does not.
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
 * **Reversal appends and never deletes.** A second `done` claim against an
 * already-Done Item is a second fact, not an error: ADR 0013 gives no
 * authorship axis to police who may re-tick, and the current outcome is
 * whichever claim is latest.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { items, itemOutcomes, medicationAuthority, shiftRoster, shifts } from '../../db/schema'

export type Refusal =
  'shift_not_found' | 'item_not_found' | 'not_rostered' | 'medication_authority_required'

export type Recorded<T = null> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export function refused(because: Refusal): Recorded<never> {
  return { ok: false, because }
}

export function recorded<T>(value: T): Recorded<T> {
  return { ok: true, value }
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
  const [shift] = await db
    .select({ id: shifts.id, day: shifts.day })
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
    })
    .from(items)
    .where(eq(items.id, about.itemId))
    .limit(1)
  if (item === undefined) return refused('item_not_found')

  // This Shift's own Item, or a per-Day Item this Shift's day shares — never
  // an Item that belongs to some other Shift entirely (ADR 0013).
  const onThisShift =
    item.shiftId === about.shiftId || (item.shiftId === null && item.day === shift.day)
  if (!onThisShift) return refused('item_not_found')

  const [rostered] = await db
    .select({ id: shiftRoster.id })
    .from(shiftRoster)
    .where(
      and(
        eq(shiftRoster.shiftId, about.shiftId),
        eq(shiftRoster.volunteerId, actorVolunteerId),
        isNull(shiftRoster.endedAt),
      ),
    )
    .limit(1)
  if (rostered === undefined) return refused('not_rostered')

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

  const id = uuidv7()
  await db.insert(itemOutcomes).values({
    id,
    orgId,
    itemId: about.itemId,
    shiftId: about.shiftId,
    outcome: 'done',
    claimedBy: actorVolunteerId,
  })

  return recorded({ id })
}
