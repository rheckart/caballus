/**
 * The two reads this ticket answers: every Product's days-of-supply
 * forecast, and every Reorder with its thread whole (ADR 0019, #47). Both on
 * ADR 0010's floor — "everyone reads everything" — the same as
 * `src/server/observations/list.ts`'s two.
 *
 * Names are resolved with a second, batched query rather than a repeated
 * join against `volunteers`, the same convention `observationsFor` and
 * `escalationList` follow.
 */
import { desc, eq, inArray } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import {
  daysOfSupplyReadings,
  products,
  reorderComments,
  reorders,
  volunteers,
} from '../../db/schema'
import { isProductKind, type ProductKind } from '../../shared/products'
import { isAtOrBelowReorderPoint, projectedDaysRemaining } from '../../shared/supplies'
import { dayString, type DayString, type Instant } from '../../shared/time'
import { instantOfTimestamp } from '../time'

async function namesOf(
  db: OrgScopedDatabase,
  ids: ReadonlySet<string>,
): Promise<Map<string, string>> {
  if (ids.size === 0) return new Map()
  const rows = await db
    .select({ id: volunteers.id, name: volunteers.name })
    .from(volunteers)
    .where(inArray(volunteers.id, [...ids]))
  return new Map(rows.map((row) => [row.id, row.name]))
}

export interface SuppliesReadingEntry {
  readonly daysRemaining: number
  readonly countedOn: DayString
  readonly recordedBy: string
  readonly recordedByName: string
}

export interface ProductSupply {
  readonly productId: string
  readonly productName: string
  readonly productKind: ProductKind
  readonly reorderPointDays: number | null
  readonly latestReading: SuppliesReadingEntry | null
  readonly projectedDaysRemaining: number | null
  readonly atOrBelowReorderPoint: boolean
}

/**
 * Every Product's forecast, alphabetically — the last reading each carries,
 * decremented against `today` and floored at zero by
 * `src/shared/supplies.ts`. A Product nobody has ever counted answers with
 * `latestReading: null`, never a manufactured zero.
 */
export async function suppliesList(
  db: OrgScopedDatabase,
  today: DayString,
): Promise<readonly ProductSupply[]> {
  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      kind: products.kind,
      reorderPointDays: products.reorderPointDays,
    })
    .from(products)
    .orderBy(products.name)

  const readingRows = await db
    .select({
      productId: daysOfSupplyReadings.productId,
      daysRemaining: daysOfSupplyReadings.daysRemaining,
      countedOn: daysOfSupplyReadings.countedOn,
      recordedBy: daysOfSupplyReadings.recordedBy,
      recordedAt: daysOfSupplyReadings.recordedAt,
    })
    .from(daysOfSupplyReadings)
    .orderBy(desc(daysOfSupplyReadings.countedOn), desc(daysOfSupplyReadings.recordedAt))

  // The rows arrive newest first, so the first one seen per Product is its
  // latest reading — no need for a second query or a window function.
  const latestByProduct = new Map<string, (typeof readingRows)[number]>()
  for (const row of readingRows) {
    if (!latestByProduct.has(row.productId)) latestByProduct.set(row.productId, row)
  }

  const who = new Set<string>()
  for (const row of latestByProduct.values()) who.add(row.recordedBy)
  const names = await namesOf(db, who)

  return productRows.map((product) => {
    const latest = latestByProduct.get(product.id)
    const latestReading: SuppliesReadingEntry | null =
      latest === undefined
        ? null
        : {
            daysRemaining: latest.daysRemaining,
            countedOn: dayString(latest.countedOn),
            recordedBy: latest.recordedBy,
            recordedByName: names.get(latest.recordedBy) ?? latest.recordedBy,
          }
    const projected = projectedDaysRemaining(
      latestReading === null
        ? null
        : { daysRemaining: latestReading.daysRemaining, countedOn: latestReading.countedOn },
      today,
    )
    return {
      productId: product.id,
      productName: product.name,
      productKind: isProductKind(product.kind) ? product.kind : 'feed',
      reorderPointDays: product.reorderPointDays,
      latestReading,
      projectedDaysRemaining: projected,
      atOrBelowReorderPoint: isAtOrBelowReorderPoint(projected, product.reorderPointDays),
    }
  })
}

export interface ReorderComment {
  readonly id: string
  readonly text: string
  readonly authoredBy: string
  readonly authoredByName: string
  readonly authoredAt: Instant
}

export interface ReorderEntry {
  readonly id: string
  readonly productId: string
  readonly productName: string
  readonly escalationId: string | null
  readonly openedBy: string
  readonly openedByName: string
  readonly openedAt: Instant
  readonly closedAt: Instant | null
  readonly closedBy: string | null
  readonly closedByName: string | null
  readonly closingNote: string | null
  readonly comments: readonly ReorderComment[]
}

/** Every Reorder, newest first, with its own thread carried whole (ADR 0019). */
export async function reorderList(db: OrgScopedDatabase): Promise<readonly ReorderEntry[]> {
  const rows = await db
    .select({
      id: reorders.id,
      productId: reorders.productId,
      productName: products.name,
      escalationId: reorders.escalationId,
      openedBy: reorders.openedBy,
      openedAt: reorders.openedAt,
      closedAt: reorders.closedAt,
      closedBy: reorders.closedBy,
      closingNote: reorders.closingNote,
    })
    .from(reorders)
    .innerJoin(products, eq(products.id, reorders.productId))
    .orderBy(desc(reorders.openedAt))

  const comments = await db
    .select({
      id: reorderComments.id,
      reorderId: reorderComments.reorderId,
      text: reorderComments.text,
      authoredBy: reorderComments.authoredBy,
      authoredAt: reorderComments.authoredAt,
    })
    .from(reorderComments)
    .orderBy(reorderComments.authoredAt)

  const who = new Set<string>()
  for (const row of rows) {
    who.add(row.openedBy)
    if (row.closedBy !== null) who.add(row.closedBy)
  }
  for (const comment of comments) who.add(comment.authoredBy)
  const names = await namesOf(db, who)

  const commentsByReorder = new Map<string, ReorderComment[]>()
  for (const comment of comments) {
    const list = commentsByReorder.get(comment.reorderId) ?? []
    list.push({
      id: comment.id,
      text: comment.text,
      authoredBy: comment.authoredBy,
      authoredByName: names.get(comment.authoredBy) ?? comment.authoredBy,
      authoredAt: instantOfTimestamp(comment.authoredAt),
    })
    commentsByReorder.set(comment.reorderId, list)
  }

  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    escalationId: row.escalationId,
    openedBy: row.openedBy,
    openedByName: names.get(row.openedBy) ?? row.openedBy,
    openedAt: instantOfTimestamp(row.openedAt),
    closedAt: row.closedAt === null ? null : instantOfTimestamp(row.closedAt),
    closedBy: row.closedBy,
    closedByName: row.closedBy === null ? null : (names.get(row.closedBy) ?? row.closedBy),
    closingNote: row.closingNote,
    comments: commentsByReorder.get(row.id) ?? [],
  }))
}
