/**
 * Weight and body-condition measurements (`CONTEXT.md`'s Weight; ADR 0003's
 * measurement-series tier): appended, never edited, no reason field, and no
 * audit entry — the tier is its own record.
 *
 * On the floor: any signed-in Volunteer may record one, not a Domain Scope
 * holder — recording that a horse was weighed today is not an edit to a care
 * instruction, the same reasoning `CONTEXT.md`'s Observation carries.
 */
import { asc, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { horseMeasurements, horses } from '../../db/schema'
import type { MeasurementKind, MeasurementMethod } from '../../shared/measurements'
import { dayString, type DayString } from '../../shared/time'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

export interface NewMeasurement {
  readonly horseId: string
  readonly kind: MeasurementKind
  readonly value: number
  /** Weight only — normalised to `null` for a body-condition entry regardless of what was sent. */
  readonly method?: MeasurementMethod | null
  readonly takenOn: DayString
}

/** Appends a measurement. There is no edit and no delete for this tier. */
export async function recordMeasurement(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: NewMeasurement,
): Promise<Recorded<{ id: string }>> {
  const [horse] = await db
    .select({ id: horses.id })
    .from(horses)
    .where(eq(horses.id, about.horseId))
    .limit(1)
  if (horse === undefined) return refused('horse_not_found')

  const id = uuidv7()
  await db.insert(horseMeasurements).values({
    id,
    orgId,
    horseId: about.horseId,
    kind: about.kind,
    value: about.value,
    method: about.kind === 'weight' ? (about.method ?? null) : null,
    takenOn: about.takenOn,
    recordedBy: actorVolunteerId,
  })

  return recorded({ id })
}

export interface WeightEntry {
  readonly id: string
  readonly value: number
  readonly method: MeasurementMethod | null
  readonly takenOn: DayString
  readonly recordedBy: string | null
}

export interface BodyConditionEntry {
  readonly id: string
  readonly value: number
  readonly takenOn: DayString
  readonly recordedBy: string | null
}

export interface HorseMeasurements {
  readonly weights: readonly WeightEntry[]
  readonly bodyConditions: readonly BodyConditionEntry[]
}

/** Both series for one horse, oldest first — a series, not a single latest reading. */
export async function measurementsFor(
  db: OrgScopedDatabase,
  horseId: string,
): Promise<HorseMeasurements> {
  const rows = await db
    .select({
      id: horseMeasurements.id,
      kind: horseMeasurements.kind,
      value: horseMeasurements.value,
      method: horseMeasurements.method,
      takenOn: horseMeasurements.takenOn,
      recordedBy: horseMeasurements.recordedBy,
    })
    .from(horseMeasurements)
    .where(eq(horseMeasurements.horseId, horseId))
    // `recordedAt` breaks the tie for same-day entries — the exact case the
    // `method` column exists for, two people weighing the same horse on one
    // day, and Postgres gives no order among equal `takenOn` values otherwise.
    .orderBy(asc(horseMeasurements.takenOn), asc(horseMeasurements.recordedAt))

  const weights: WeightEntry[] = []
  const bodyConditions: BodyConditionEntry[] = []
  for (const row of rows) {
    if (row.kind === 'weight') {
      weights.push({
        id: row.id,
        value: row.value,
        method: row.method === 'tape' || row.method === 'scale' ? row.method : null,
        takenOn: dayString(row.takenOn),
        recordedBy: row.recordedBy,
      })
    } else if (row.kind === 'body_condition') {
      bodyConditions.push({
        id: row.id,
        value: row.value,
        takenOn: dayString(row.takenOn),
        recordedBy: row.recordedBy,
      })
    }
  }

  return { weights, bodyConditions }
}
