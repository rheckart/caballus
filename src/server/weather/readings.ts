/**
 * Readings: the weather as it stood when the Conditions were evaluated, kept
 * whole (`CONTEXT.md`'s Reading; ADR 0015).
 *
 * A Reading is **the raw hours plus what they resolved to**, not the decision
 * alone. *Why was this horse blanketed* is answered by the conditions as read
 * at the time, and a re-fetch tomorrow answers a different question (#6's
 * implementation note).
 *
 * **When the forecast does not arrive**, ADR 0015 gives three steps in order.
 * The first two are here: reuse the most recent successful forecast for that
 * day, marked stale; failing that, refuse, so that nothing gated is generated
 * off a Reading the app does not have. The third — whoever holds Shift
 * Authority resolving each open Condition by hand — belongs with the Shift it
 * would unblock, and there is no Shift to unblock yet.
 *
 * **The fetch happens inside the write's transaction, and that is a cost this
 * ticket accepts rather than hides.** `mutation` opens the transaction before
 * the handler runs (ADR 0020), so the provider call holds a pooled connection
 * while it waits — which is why `TIMEOUT_MILLIS` in `providers.ts` is five
 * seconds and not a comfortable ten, and why nothing polls this endpoint. The
 * shape that removes it is the daily job ADR 0013 wants: fetch first, then
 * record what was fetched, with only the three inserts inside a transaction.
 * `recordReading` is written so that step is a parameter rather than a rewrite.
 *
 * **The window is a property of the Condition** (ADR 0015): day-scoped ones are
 * read over the whole day and shared, shift-scoped ones from a Shift's start
 * until the next Shift begins. With no Shift model yet, a shift-scoped
 * Condition is read over the day as well — `windowFor` already implements both
 * rules and is tested against both, and the day a Shift exists this passes it
 * the Shift instead.
 */
import { desc, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import {
  horses,
  weatherConditionResolutions,
  weatherReadingHours,
  weatherReadings,
} from '../../db/schema'
import {
  resolveConditions,
  windowFor,
  type HourReading,
  type Resolution,
} from '../../shared/conditions'
import { dayString, instant, type DayString, type Instant } from '../../shared/time'
import {
  CONDITION_SPECS,
  conditionsScoped,
  isConditionName,
  isMetric,
  isWeatherProvider,
  type ConditionName,
  type ConditionScope,
  type Metric,
  type ThresholdSource,
  type UnresolvedReason,
  type WeatherProvider,
} from '../../shared/weather'
import { dayBounds, dayOf, hourOf, instantOfTimestamp, timestampOf } from '../time'
import { recorded, refused, type Recorded } from './outcome'
import { currentThresholds } from './thresholds'
import { NoForecast, barnCoordinates, fetchForecast, type ProviderHour } from './providers'

export { type Recorded, type Refusal } from './outcome'

/** One hour of the series a Reading read, as the wire and the screen carry it. */
export interface ReadingHour {
  readonly at: number
  readonly day: DayString
  readonly hour: number
  readonly airTempF: number | null
  readonly apparentTempF: number | null
  readonly precipitation: boolean | null
}

/** One (Condition, subject) answer, with the horse's name for a screen to render. */
export interface ReadingResolution {
  readonly condition: ConditionName
  readonly horseId: string | null
  readonly horseName: string | null
  readonly scope: ConditionScope
  readonly holds: boolean | null
  readonly unresolved: UnresolvedReason | null
  readonly metric: Metric
  readonly thresholdValue: number | null
  readonly thresholdSource: ThresholdSource | null
  readonly readingValue: number | null
  readonly atHour: number | null
}

export interface Reading {
  readonly id: string
  readonly day: DayString
  readonly provider: WeatherProvider
  /** Who was asked first and did not answer, where the fallback was used. */
  readonly fellBackFrom: WeatherProvider | null
  readonly fellBackBecause: string | null
  /** True where nobody answered and an earlier Reading of this day was reused. */
  readonly stale: boolean
  /** Epoch milliseconds. A day belongs to the organisation and this is not one. */
  readonly fetchedAt: number
  readonly hours: readonly ReadingHour[]
  readonly conditions: readonly ReadingResolution[]
}

export interface ReadingRequest {
  readonly day: DayString
  readonly timeZone: string
}

/**
 * Fetches the forecast, evaluates every Condition against it and records the
 * whole thing as one Reading.
 *
 * Not a read with a side effect: this is the act that fixes the day's weather,
 * and everything downstream — the Board today, a Shift's list when Shifts
 * exist — reads the row it wrote rather than the internet.
 */
export async function recordReading(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: ReadingRequest,
): Promise<Recorded<{ id: string; provider: WeatherProvider; stale: boolean }>> {
  const bounds = dayBounds(about.day, about.timeZone)

  const at = barnCoordinates()
  if (at === null) return refused('coordinates_not_set')

  let provider: WeatherProvider
  let fellBackFrom: WeatherProvider | null
  let fellBackBecause: string | null
  let stale = false
  let fetchedAt: Instant
  let hours: readonly HourReading[]

  try {
    const fetched = await fetchForecast(at)
    provider = fetched.forecast.provider
    fellBackFrom = fetched.fellBackFrom
    fellBackBecause = fetched.fellBackBecause
    fetchedAt = fetched.forecast.fetchedAt
    hours = zoned(fetched.forecast.hours, about.timeZone).filter((hour) => hour.at >= bounds.start)
  } catch (error: unknown) {
    if (!(error instanceof NoForecast)) throw error

    // Step one of the degraded path: the most recent successful forecast for
    // this day, marked stale. The hours are the ones that were read then — a
    // stale Reading is honest about being yesterday's answer to today's
    // question, and re-evaluating them picks up any Threshold changed since.
    const previous = await lastReadingOf(db, about.day)
    if (previous === null) return refused('forecast_unavailable')

    provider = previous.provider
    fellBackFrom = previous.fellBackFrom
    fellBackBecause = error.message
    stale = true
    fetchedAt = instant(previous.fetchedAt)
    hours = previous.hours.map((hour) => ({ ...hour, at: instant(hour.at) }))
  }

  const [thresholds, horseRows] = await Promise.all([
    currentThresholds(db, about.day),
    db.select({ id: horses.id, departedOn: horses.departedOn }).from(horses),
  ])
  const here = horseRows.filter((row) => row.departedOn === null).map((row) => ({ id: row.id }))

  const day = { from: instant(bounds.start), to: instant(bounds.end) }
  const resolved: readonly Resolution[] = [
    ...resolveConditions({
      conditions: conditionsScoped('day'),
      hours,
      window: windowFor('day', { day }),
      thresholds: thresholds.set,
      horses: here,
    }),
    ...resolveConditions({
      conditions: conditionsScoped('shift'),
      hours,
      // No Shift materializes yet, so this is the day. `windowFor` is where the
      // Shift's own window lives, and it is what this passes when there is one.
      window: windowFor('shift', { day }),
      thresholds: thresholds.set,
      horses: here,
    }),
  ]

  const id = uuidv7()
  await db.insert(weatherReadings).values({
    id,
    orgId,
    day: about.day,
    provider,
    fellBackFrom,
    fellBackBecause,
    stale,
    fetchedAt: timestampOf(fetchedAt),
    recordedBy: actorVolunteerId,
  })

  if (hours.length > 0) {
    await db.insert(weatherReadingHours).values(
      hours.map((hour) => ({
        id: uuidv7(),
        orgId,
        readingId: id,
        at: timestampOf(hour.at),
        day: hour.day,
        hour: hour.hour,
        airTempF: hour.airTempF,
        apparentTempF: hour.apparentTempF,
        precipitation: hour.precipitation,
      })),
    )
  }

  if (resolved.length > 0) {
    await db.insert(weatherConditionResolutions).values(
      resolved.map((resolution) => ({
        id: uuidv7(),
        orgId,
        readingId: id,
        condition: resolution.condition,
        horseId: resolution.horseId,
        scope: CONDITION_SPECS[resolution.condition].scope,
        holds: resolution.holds,
        unresolved: resolution.unresolved,
        metric: resolution.metric,
        thresholdValueF: resolution.thresholdValue,
        thresholdSource: resolution.thresholdSource,
        readingValueF: resolution.readingValue,
        atHour: resolution.atHour,
      })),
    )
  }

  return recorded({ id, provider, stale })
}

/**
 * The Reading a day was fixed against — the latest one recorded for it, since
 * a re-run after a failed fetch records a stale Reading beside the one it
 * reused rather than editing it.
 */
export async function readingFor(db: OrgScopedDatabase, day: DayString): Promise<Reading | null> {
  const stored = await lastReadingOf(db, day)
  if (stored === null) return null

  const [resolutionRows, horseRows] = await Promise.all([
    db
      .select({
        condition: weatherConditionResolutions.condition,
        horseId: weatherConditionResolutions.horseId,
        scope: weatherConditionResolutions.scope,
        holds: weatherConditionResolutions.holds,
        unresolved: weatherConditionResolutions.unresolved,
        metric: weatherConditionResolutions.metric,
        thresholdValue: weatherConditionResolutions.thresholdValueF,
        thresholdSource: weatherConditionResolutions.thresholdSource,
        readingValue: weatherConditionResolutions.readingValueF,
        atHour: weatherConditionResolutions.atHour,
      })
      .from(weatherConditionResolutions)
      .where(eq(weatherConditionResolutions.readingId, stored.id)),
    db.select({ id: horses.id, name: horses.name }).from(horses),
  ])

  const named = new Map(horseRows.map((row) => [row.id, row.name]))

  return {
    id: stored.id,
    day,
    provider: stored.provider,
    fellBackFrom: stored.fellBackFrom,
    fellBackBecause: stored.fellBackBecause,
    stale: stored.stale,
    fetchedAt: stored.fetchedAt,
    hours: stored.hours,
    conditions: resolutionRows.flatMap((row): ReadingResolution[] => {
      // A row this build does not have a name for is left out rather than
      // guessed at: the column is text and a deploy can be older than a row,
      // the same reason `isSpaceKind` exists.
      if (!isConditionName(row.condition) || !isMetric(row.metric)) return []
      return [
        {
          condition: row.condition,
          horseId: row.horseId,
          horseName: row.horseId === null ? null : (named.get(row.horseId) ?? null),
          scope: row.scope === 'day' ? 'day' : 'shift',
          holds: row.holds,
          unresolved: (row.unresolved as UnresolvedReason | null) ?? null,
          metric: row.metric,
          thresholdValue: row.thresholdValue,
          thresholdSource: (row.thresholdSource as ThresholdSource | null) ?? null,
          readingValue: row.readingValue,
          atHour: row.atHour,
        },
      ]
    }),
  }
}

interface StoredReading {
  readonly id: string
  readonly provider: WeatherProvider
  readonly fellBackFrom: WeatherProvider | null
  readonly fellBackBecause: string | null
  readonly stale: boolean
  readonly fetchedAt: number
  readonly hours: readonly ReadingHour[]
}

/** The last Reading recorded for a day, hours and all, or nothing at all. */
async function lastReadingOf(db: OrgScopedDatabase, day: DayString): Promise<StoredReading | null> {
  const [row] = await db
    .select({
      id: weatherReadings.id,
      provider: weatherReadings.provider,
      fellBackFrom: weatherReadings.fellBackFrom,
      fellBackBecause: weatherReadings.fellBackBecause,
      stale: weatherReadings.stale,
      fetchedAt: weatherReadings.fetchedAt,
    })
    .from(weatherReadings)
    .where(eq(weatherReadings.day, day))
    .orderBy(desc(weatherReadings.recordedAt))
    .limit(1)

  if (row === undefined || !isWeatherProvider(row.provider)) return null

  const hourRows = await db
    .select({
      at: weatherReadingHours.at,
      day: weatherReadingHours.day,
      hour: weatherReadingHours.hour,
      airTempF: weatherReadingHours.airTempF,
      apparentTempF: weatherReadingHours.apparentTempF,
      precipitation: weatherReadingHours.precipitation,
    })
    .from(weatherReadingHours)
    .where(eq(weatherReadingHours.readingId, row.id))
    .orderBy(weatherReadingHours.at)

  return {
    id: row.id,
    provider: row.provider,
    fellBackFrom:
      row.fellBackFrom !== null && isWeatherProvider(row.fellBackFrom) ? row.fellBackFrom : null,
    fellBackBecause: row.fellBackBecause,
    stale: row.stale,
    fetchedAt: instantOfTimestamp(row.fetchedAt),
    hours: hourRows.map((hour) => ({
      at: instantOfTimestamp(hour.at),
      day: dayString(hour.day),
      hour: hour.hour,
      airTempF: hour.airTempF,
      apparentTempF: hour.apparentTempF,
      precipitation: hour.precipitation,
    })),
  }
}

/**
 * A provider's hours, stamped with the day and hour they fell in **in the
 * organisation's timezone** (ADR 0007).
 *
 * Done here, once, on the way in: *85 real feel at or before noon* is a
 * question about the barn's clock, and a screen re-deriving it in the browser's
 * zone is right for most of the year and wrong at the edges that matter.
 */
function zoned(hours: readonly ProviderHour[], timeZone: string): readonly HourReading[] {
  return hours.map((hour) => ({
    at: hour.at,
    day: dayOf(hour.at, timeZone),
    hour: hourOf(hour.at, timeZone),
    airTempF: hour.airTempF,
    apparentTempF: hour.apparentTempF,
    precipitation: hour.precipitation,
  }))
}
