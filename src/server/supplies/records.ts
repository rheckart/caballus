/**
 * Recording a Days-of-Supply reading, and the Reorder's own three acts:
 * opening against one Product, threading a comment, and closing with a note
 * (`CONTEXT.md`'s Days of Supply and Reorder; ADR 0019, #47).
 *
 * **A reading's authorization is a data-dependent OR that
 * `src/server/api/route.ts` has no static shape for** — a holder of
 * `supplies`, or Shift Authority over the Shift the recorder is presently
 * on — the same shape `escalateObservation` in
 * `src/server/observations/escalations.ts` established, and for the same
 * reason: `shiftId` here is optional (nobody but a Lead actually standing on
 * a Shift has one to name), so `MutationAuthorization`'s automatic join has
 * no static shape to check it against, and the real rule is checked here
 * instead.
 *
 * Everything here takes the scoped transaction `mutation` opened, so the
 * effect and its audit entry — where one exists — commit together (ADR
 * 0020). A reading carries no audit entry: it is ADR 0003's measurement-series
 * tier, appended and never edited, the same discipline `recordMeasurement`
 * follows for a horse's weight.
 */
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import {
  daysOfSupplyReadings,
  escalations,
  products,
  reorderComments,
  reorders,
} from '../../db/schema'
import { now, type DayString } from '../../shared/time'
import type { Actor } from '../request-context'
import { holdsShiftAuthority } from '../shifts/authority'
import { timestampOf } from '../time'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

export interface NewReading {
  readonly productId: string
  readonly daysRemaining: number
  readonly countedOn: DayString
  /** The Shift the recorder is presently on, if any — Shift Authority's own path in. */
  readonly shiftId?: string | null
}

/**
 * Appends a Days-of-Supply reading. `supplies` holders write from anywhere;
 * anybody else needs Shift Authority over the Shift named — the person
 * standing in the feed room, twice a day, is a smaller claim than either
 * (ADR 0019).
 */
export async function recordSuppliesReading(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actor: Actor,
  about: NewReading,
): Promise<Recorded<{ id: string }>> {
  const holdsScope = actor.domainScopes.includes('supplies')
  const overTheShift =
    !holdsScope && about.shiftId != null && (await holdsShiftAuthority(orgId, actor, about.shiftId))
  if (!holdsScope && !overTheShift) return refused('not_authorized_to_record_reading')

  const [product] = await db
    .select({ id: products.id, retiredOn: products.retiredOn })
    .from(products)
    .where(eq(products.id, about.productId))
    .limit(1)
  if (product === undefined) return refused('product_not_found')
  // Nobody counts sacks of a thing the rescue has stopped buying (#64). The
  // series already written stays whole and readable — only the next one stops.
  if (product.retiredOn !== null) return refused('product_retired')

  const id = uuidv7()
  await db.insert(daysOfSupplyReadings).values({
    id,
    orgId,
    productId: about.productId,
    daysRemaining: about.daysRemaining,
    countedOn: about.countedOn,
    recordedBy: actor.volunteerId,
  })

  return recorded({ id })
}

export interface NewReorder {
  readonly productId: string
  readonly escalationId?: string | null
}

/**
 * Opens a Reorder: one cycle of getting more of one Product, borrowing the
 * Escalation's Open/Closed shape and its thread rather than inventing a
 * fourth hand-rolled append-only table (ADR 0010's event-store tripwire; ADR
 * 0019). May be created from an Escalation, which it links back to and
 * shares no state with — the Escalation closes when answered, this Reorder
 * when the feed arrives.
 */
export async function openReorder(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: NewReorder,
): Promise<Recorded<{ id: string }>> {
  const [product] = await db
    .select({ id: products.id, retiredOn: products.retiredOn })
    .from(products)
    .where(eq(products.id, about.productId))
    .limit(1)
  if (product === undefined) return refused('product_not_found')
  // No new cycle of getting more of a Retired Product (#64) — though one
  // already Open finishes normally, because the sack is still on its way.
  if (product.retiredOn !== null) return refused('product_retired')

  if (about.escalationId != null) {
    const [escalation] = await db
      .select({ id: escalations.id })
      .from(escalations)
      .where(eq(escalations.id, about.escalationId))
      .limit(1)
    if (escalation === undefined) return refused('escalation_not_found')
  }

  const id = uuidv7()
  await db.insert(reorders).values({
    id,
    orgId,
    productId: about.productId,
    escalationId: about.escalationId ?? null,
    openedBy: actorVolunteerId,
  })

  return recorded({ id })
}

export interface NewReorderComment {
  readonly reorderId: string
  readonly text: string
}

/**
 * Appends to a Reorder's thread — where the dates go, ordered, chased,
 * arrived (ADR 0019). Writable by `supplies` holders alone: a Reorder has no
 * reporter with standing the way an Observation does, and the linked
 * Escalation's own thread — still floor-writable — is where the floor keeps
 * its voice.
 */
export async function addReorderComment(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: NewReorderComment,
): Promise<Recorded<{ id: string }>> {
  const text = about.text.trim()
  if (text === '') return refused('text_required')

  const [reorder] = await db
    .select({ id: reorders.id })
    .from(reorders)
    .where(eq(reorders.id, about.reorderId))
    .limit(1)
  if (reorder === undefined) return refused('reorder_not_found')

  const id = uuidv7()
  await db.insert(reorderComments).values({
    id,
    orgId,
    reorderId: about.reorderId,
    text,
    authoredBy: actorVolunteerId,
  })

  return recorded({ id })
}

export interface CloseReorder {
  readonly reorderId: string
  readonly note: string
}

/**
 * Closes a Reorder with a note — a `supplies` holder's own act, and there is
 * no reopen (ADR 0019).
 */
export async function closeReorder(
  db: OrgScopedDatabase,
  actorVolunteerId: string,
  about: CloseReorder,
): Promise<Recorded> {
  const note = about.note.trim()
  if (note === '') return refused('note_required')

  const [row] = await db
    .select({ id: reorders.id, closedAt: reorders.closedAt })
    .from(reorders)
    .where(eq(reorders.id, about.reorderId))
    .limit(1)
  if (row === undefined) return refused('reorder_not_found')
  if (row.closedAt !== null) return refused('reorder_already_closed')

  await db
    .update(reorders)
    .set({ closedAt: timestampOf(now()), closedBy: actorVolunteerId, closingNote: note })
    .where(eq(reorders.id, about.reorderId))

  return recorded(null)
}
