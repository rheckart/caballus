/**
 * The reads: the Supplier list and the Product catalogue.
 *
 * Every Volunteer reads all of it (ADR 0010's floor) — supplies is inside the
 * read-everything floor by name, the same as horses and Spaces.
 */
import { eq } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import { products, suppliers } from '../../db/schema'
import { isProductKind, type ProductKind } from '../../shared/products'

export interface Supplier {
  readonly id: string
  readonly name: string
  readonly url: string | null
  readonly note: string | null
}

/** Every Supplier, name order. */
export async function supplierList(db: OrgScopedDatabase): Promise<readonly Supplier[]> {
  return db
    .select({ id: suppliers.id, name: suppliers.name, url: suppliers.url, note: suppliers.note })
    .from(suppliers)
    .orderBy(suppliers.name)
}

export interface Product {
  readonly id: string
  readonly name: string
  readonly kind: ProductKind
  readonly supplierId: string | null
  readonly supplierName: string | null
  readonly prescription: boolean
  readonly reorderPointDays: number | null
  readonly orderingNote: string | null
}

/** Every Product, name order, with its Supplier's name carried along so a list renders in one read. */
export async function productList(db: OrgScopedDatabase): Promise<readonly Product[]> {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      kind: products.kind,
      supplierId: products.supplierId,
      supplierName: suppliers.name,
      prescription: products.prescription,
      reorderPointDays: products.reorderPointDays,
      orderingNote: products.orderingNote,
    })
    .from(products)
    .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
    .orderBy(products.name)

  // The column is text and a deploy can be older than a row (the same reason
  // `spaceList` filters on `isSpaceKind`); a kind this build does not know is
  // left out rather than guessed at.
  return rows
    .filter((row) => isProductKind(row.kind))
    .map((row) => ({
      ...row,
      kind: row.kind as ProductKind,
      supplierName: row.supplierName ?? null,
    }))
}
