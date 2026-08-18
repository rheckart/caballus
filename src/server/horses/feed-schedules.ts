/**
 * Feed Schedules: publishing a new version, and reading the current one per
 * Shift Type for a horse's profile (`CONTEXT.md`'s Feed Schedule; ADR 0003's
 * versioned tier).
 *
 * **Editing creates a version; it never updates a row.** The current version
 * for a `(horseId, shiftType)` pair is derived as the latest by `validFrom`
 * rather than a flag anything sets — the same discipline `releaseVersionList`
 * follows for Release Versions, and for the same reason: *what was she eating
 * the week she lost thirty pounds* stays answerable.
 *
 * **No audit entry.** A versioned-tier change *is* a version (ADR 0003),
 * exactly as `publishReleaseVersion` documents for its own table.
 */
import { eq, inArray } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { feedScheduleLines, feedScheduleVersions, horses, products } from '../../db/schema'
import {
  isNewVersion,
  isRoute,
  isShiftType,
  type Route,
  type ShiftType,
} from '../../shared/feed-schedule'
import { isProductKind, type ProductKind } from '../../shared/products'
import { dayString, type DayString } from '../../shared/time'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

export interface NewFeedScheduleLine {
  readonly productId: string
  readonly amount: string
  readonly route: Route
}

export interface NewFeedSchedule {
  readonly horseId: string
  readonly shiftType: ShiftType
  readonly validFrom: DayString
  readonly lines: readonly NewFeedScheduleLine[]
}

/**
 * Publishes a new Feed Schedule version. An empty `lines` array is legal — the
 * whole of how a horse_care holder retires a schedule, as a version rather
 * than deleting one (ADR 0003).
 */
export async function publishFeedSchedule(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: NewFeedSchedule,
): Promise<Recorded<{ id: string }>> {
  const [horse] = await db
    .select({ id: horses.id })
    .from(horses)
    .where(eq(horses.id, about.horseId))
    .limit(1)
  if (horse === undefined) return refused('horse_not_found')

  if (about.lines.length > 0) {
    const productIds = [...new Set(about.lines.map((line) => line.productId))]
    const found = await db
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.id, productIds))
    if (found.length !== productIds.length) return refused('product_not_found')
  }

  const id = uuidv7()
  await db.insert(feedScheduleVersions).values({
    id,
    orgId,
    horseId: about.horseId,
    shiftType: about.shiftType,
    validFrom: about.validFrom,
    createdBy: actorVolunteerId,
  })

  if (about.lines.length > 0) {
    await db.insert(feedScheduleLines).values(
      about.lines.map((line) => ({
        id: uuidv7(),
        orgId,
        versionId: id,
        productId: line.productId,
        amount: line.amount.trim(),
        route: line.route,
      })),
    )
  }

  return recorded({ id })
}

export interface CurrentFeedLine {
  readonly productId: string
  readonly productName: string
  readonly productKind: ProductKind
  readonly amount: string
  readonly route: Route
}

export interface CurrentFeedSchedule {
  readonly shiftType: ShiftType
  readonly validFrom: DayString
  readonly isNew: boolean
  readonly lines: readonly CurrentFeedLine[]
}

/**
 * The current Feed Schedule for every Shift Type this horse actually has one
 * for — a Lunch feeding stays absent for a horse that has never had a Lunch
 * version published, rather than appearing empty (#36's Dawson-and-Apollo
 * case).
 */
export async function currentFeedSchedulesFor(
  db: OrgScopedDatabase,
  horseId: string,
  today: DayString,
): Promise<readonly CurrentFeedSchedule[]> {
  const byHorse = await currentFeedSchedulesByHorse(db, today, horseId)
  return byHorse.get(horseId) ?? []
}

/**
 * The same, for every horse at once — what the Board reads, because a grid of
 * eleven horses asking one query each is eleven round trips for a screen that
 * repaints every minute (#37).
 *
 * `onlyHorseId` narrows it to one horse, which is what the profile wants; the
 * resolution of *which version is current* is the same either way, and having
 * it twice is having it drift.
 */
export async function currentFeedSchedulesByHorse(
  db: OrgScopedDatabase,
  today: DayString,
  onlyHorseId?: string,
): Promise<ReadonlyMap<string, readonly CurrentFeedSchedule[]>> {
  const versionRows = await db
    .select({
      id: feedScheduleVersions.id,
      horseId: feedScheduleVersions.horseId,
      shiftType: feedScheduleVersions.shiftType,
      validFrom: feedScheduleVersions.validFrom,
      createdAt: feedScheduleVersions.createdAt,
    })
    .from(feedScheduleVersions)
    .where(onlyHorseId === undefined ? undefined : eq(feedScheduleVersions.horseId, onlyHorseId))

  interface VersionRow {
    readonly id: string
    readonly horseId: string
    readonly shiftType: ShiftType
    readonly validFrom: string
    readonly createdAt: Date
  }

  // The latest version per horse per Shift Type, by valid-from and then by
  // when it was recorded — resolved in application code rather than a window
  // function, the same call `horseList` makes for grouping Space assignments.
  const latest = new Map<string, VersionRow>()
  for (const row of versionRows) {
    if (!isShiftType(row.shiftType)) continue
    const shiftType = row.shiftType
    const at = `${row.horseId}:${shiftType}`
    const held = latest.get(at)
    if (
      held === undefined ||
      row.validFrom > held.validFrom ||
      (row.validFrom === held.validFrom && row.createdAt > held.createdAt)
    ) {
      latest.set(at, {
        id: row.id,
        horseId: row.horseId,
        shiftType,
        validFrom: row.validFrom,
        createdAt: row.createdAt,
      })
    }
  }

  if (latest.size === 0) return new Map()

  const versionIds = [...latest.values()].map((version) => version.id)
  const lineRows = await db
    .select({
      versionId: feedScheduleLines.versionId,
      productId: feedScheduleLines.productId,
      productName: products.name,
      productKind: products.kind,
      amount: feedScheduleLines.amount,
      route: feedScheduleLines.route,
    })
    .from(feedScheduleLines)
    .innerJoin(products, eq(products.id, feedScheduleLines.productId))
    .where(inArray(feedScheduleLines.versionId, versionIds))

  const linesByVersion = new Map<string, CurrentFeedLine[]>()
  for (const row of lineRows) {
    if (!isRoute(row.route) || !isProductKind(row.productKind)) continue
    const held = linesByVersion.get(row.versionId) ?? []
    held.push({
      productId: row.productId,
      productName: row.productName,
      productKind: row.productKind,
      amount: row.amount,
      route: row.route,
    })
    linesByVersion.set(row.versionId, held)
  }

  const schedules = new Map<string, CurrentFeedSchedule[]>()
  for (const version of [...latest.values()].sort((left, right) =>
    left.shiftType.localeCompare(right.shiftType),
  )) {
    const held = schedules.get(version.horseId) ?? []
    held.push({
      shiftType: version.shiftType,
      validFrom: dayString(version.validFrom),
      isNew: isNewVersion(dayString(version.validFrom), today),
      lines: linesByVersion.get(version.id) ?? [],
    })
    schedules.set(version.horseId, held)
  }
  return schedules
}

/**
 * Every current line, across every horse, for one Shift Type — what
 * `shiftTypeIncludesMedication` needs to answer *does this Shift Type's
 * feeding include medication*. Reused by staffing and materialization once
 * those exist; nothing in this ticket calls it yet.
 */
export async function currentLinesForShiftType(
  db: OrgScopedDatabase,
  shiftType: ShiftType,
): Promise<readonly { readonly productKind: ProductKind }[]> {
  const versionRows = await db
    .select({
      horseId: feedScheduleVersions.horseId,
      id: feedScheduleVersions.id,
      validFrom: feedScheduleVersions.validFrom,
      createdAt: feedScheduleVersions.createdAt,
    })
    .from(feedScheduleVersions)
    .where(eq(feedScheduleVersions.shiftType, shiftType))

  const latestByHorse = new Map<string, (typeof versionRows)[number]>()
  for (const row of versionRows) {
    const held = latestByHorse.get(row.horseId)
    if (
      held === undefined ||
      row.validFrom > held.validFrom ||
      (row.validFrom === held.validFrom && row.createdAt > held.createdAt)
    ) {
      latestByHorse.set(row.horseId, row)
    }
  }

  const versionIds = [...latestByHorse.values()].map((version) => version.id)
  if (versionIds.length === 0) return []

  const lineRows = await db
    .select({ productKind: products.kind })
    .from(feedScheduleLines)
    .innerJoin(products, eq(products.id, feedScheduleLines.productId))
    .where(inArray(feedScheduleLines.versionId, versionIds))

  return lineRows
    .filter((row) => isProductKind(row.productKind))
    .map((row) => ({ productKind: row.productKind as ProductKind }))
}
