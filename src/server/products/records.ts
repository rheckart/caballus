/**
 * The catalogue: creating a Supplier, and creating and editing a Product
 * (ADR 0019, `CONTEXT.md`'s Product and Supplier).
 *
 * **Editable by holders of `horse_care` or `supplies`** — ADR 0019's one
 * two-Scope record, checked in `src/server/api/app.ts` via `anyDomainScope`
 * and not here: this module writes what it is told, the same discipline
 * `src/server/horses/records.ts` follows.
 *
 * Everything here takes the scoped transaction `mutation` opened, so the
 * effect and its audit entry commit together (ADR 0020).
 */
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { products, suppliers } from '../../db/schema'
import type { ProductKind } from '../../shared/products'
import { audit, type AuditEntry } from '../roster/audit'
import { recorded, refused, type Recorded } from '../horses/outcome'

export { type Recorded, type Refusal } from '../horses/outcome'

export interface NewSupplier {
  readonly name: string
  readonly url?: string | null
  readonly note?: string | null
}

/** Creates a Supplier. It never points at a Contact — nothing here takes one. */
export async function createSupplier(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  details: NewSupplier,
): Promise<Recorded<{ id: string; name: string }>> {
  const id = uuidv7()
  const name = details.name.trim()
  await db.insert(suppliers).values({
    id,
    orgId,
    name,
    url: normalised(details.url),
    note: normalised(details.note),
  })

  await audit(db, orgId, actorVolunteerId, [{ entity: 'supplier', entityId: id, after: name }])

  return recorded({ id, name })
}

function normalised(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export interface NewProduct {
  readonly name: string
  readonly kind: ProductKind
  readonly supplierId?: string | null
  readonly prescription: boolean
  readonly reorderPointDays?: number | null
  readonly orderingNote?: string | null
  /** Why, on the audit entry — a Whiteboard Read's *read from the whiteboard photograph* (ADR 0023). */
  readonly reason?: string | null
}

/**
 * Creates a Product. `Product` does not stretch to what the rescue buys and
 * does not feed a horse (ADR 0019) — that boundary is the caller's, since
 * this module trusts the kind it is given the same way `createHorse` trusts a
 * name.
 */
export async function createProduct(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  details: NewProduct,
): Promise<Recorded<{ id: string; name: string }>> {
  if (details.supplierId != null) {
    const found = await supplierExists(db, details.supplierId)
    if (!found) return refused('supplier_not_found')
  }

  const id = uuidv7()
  const name = details.name.trim()
  await db.insert(products).values({
    id,
    orgId,
    name,
    kind: details.kind,
    supplierId: details.supplierId ?? null,
    prescription: details.prescription,
    reorderPointDays: details.reorderPointDays ?? null,
    orderingNote: normalised(details.orderingNote),
  })

  await audit(db, orgId, actorVolunteerId, [
    { entity: 'product', entityId: id, after: name, reason: details.reason ?? null },
  ])

  return recorded({ id, name })
}

async function supplierExists(db: OrgScopedDatabase, supplierId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .limit(1)
  return row !== undefined
}

interface ProductEdit {
  readonly productId: string
  /** `undefined` leaves the field unchanged; omitted from the audit unless it actually changed. */
  readonly name?: string
  readonly kind?: ProductKind
  readonly supplierId?: string | null
  readonly prescription?: boolean
  readonly reorderPointDays?: number | null
  readonly orderingNote?: string | null
  readonly reason?: string | null
}

/**
 * Edits a Product in place, auditing only the fields actually sent and
 * actually changed — the same before/after discipline `editHorseAttributes`
 * follows.
 */
export async function editProduct(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: ProductEdit,
): Promise<Recorded> {
  const [existing] = await db
    .select({
      name: products.name,
      kind: products.kind,
      supplierId: products.supplierId,
      prescription: products.prescription,
      reorderPointDays: products.reorderPointDays,
      orderingNote: products.orderingNote,
    })
    .from(products)
    .where(eq(products.id, about.productId))
    .limit(1)
  if (existing === undefined) return refused('product_not_found')

  if (about.supplierId != null && about.supplierId !== existing.supplierId) {
    const found = await supplierExists(db, about.supplierId)
    if (!found) return refused('supplier_not_found')
  }

  const before = existing
  const after = {
    name: about.name !== undefined ? about.name.trim() : before.name,
    kind: about.kind ?? before.kind,
    supplierId: 'supplierId' in about ? (about.supplierId ?? null) : before.supplierId,
    prescription: about.prescription ?? before.prescription,
    reorderPointDays:
      'reorderPointDays' in about ? (about.reorderPointDays ?? null) : before.reorderPointDays,
    orderingNote: 'orderingNote' in about ? normalised(about.orderingNote) : before.orderingNote,
  }

  const next: Record<string, string | number | boolean | null> = {}
  const entries: AuditEntry[] = []
  const fields: readonly (readonly [string, keyof typeof after])[] = [
    ['name', 'name'],
    ['kind', 'kind'],
    ['supplier_id', 'supplierId'],
    ['prescription', 'prescription'],
    ['reorder_point_days', 'reorderPointDays'],
    ['ordering_note', 'orderingNote'],
  ]
  for (const [field, column] of fields) {
    if (after[column] === before[column]) continue
    next[column] = after[column]
    entries.push({
      entity: 'product',
      entityId: about.productId,
      field,
      before: before[column] === null ? null : String(before[column]),
      after: after[column] === null ? null : String(after[column]),
      reason: about.reason ?? null,
    })
  }

  if (Object.keys(next).length > 0) {
    await db.update(products).set(next).where(eq(products.id, about.productId))
  }
  await audit(db, orgId, actorVolunteerId, entries)

  return recorded(null)
}
