/**
 * Condition evaluation: given Conditions, Thresholds and forecast hours, what
 * holds and for whom (ADR 0015).
 *
 * Pure, for the reason `src/shared/board.ts` and `src/shared/rostering.ts` are:
 * the database read answers *what are the numbers* and the provider answers
 * *what is the weather*, and everything past those two points is arithmetic a
 * table of inputs can exercise directly. Nothing here fetches, reads a clock or
 * touches a row.
 *
 * **A predicate resolves per subject when its number comes from the subject.**
 * That is ADR 0015's whole correction to ADR 0013: at 38 °F, Dawson and Apollo
 * get sheets, the rest of the horses get sheets, and Storm gets nothing — one
 * predicate, one hour, three answers. So the output is a set of
 * (Condition, subject) answers rather than a scalar per Condition.
 *
 * **An unresolved Condition is not a false one.** A window with no hours, a
 * provider that carried no apparent temperature, a number the rescue has not
 * set: each answers `holds: null` with a reason. Defaulting to false would put
 * horses out on a 90 ° day with the normal hay, which is the failure ADR 0015
 * wrote its degraded path against.
 */
import type { Instant } from './time'
import type { DayString } from './time'
import {
  CONDITION_SPECS,
  THRESHOLD_SPECS,
  type ConditionName,
  type ConditionScope,
  type ConditionSpec,
  type Metric,
  type ThresholdKind,
  type ThresholdSource,
  type UnresolvedReason,
} from './weather'

/**
 * One hour of forecast, as the evaluation reads it.
 *
 * `at` is the instant, which is what a window is compared against; `day` and
 * `hour` are the same moment in the organisation's timezone, resolved by the
 * server before this module sees it (ADR 0007) — *85 real feel at or before
 * noon* is a question about the barn's clock and not about UTC.
 *
 * Every value is nullable because a provider may not carry it: the fallback
 * has air temperature and no apparent temperature, and saying so is better
 * than a zero (#6, ADR 0015).
 */
export interface HourReading {
  readonly at: Instant
  readonly day: DayString
  /** Hour of the day, 0–23, in the organisation's timezone. */
  readonly hour: number
  readonly airTempF: number | null
  readonly apparentTempF: number | null
  readonly precipitation: boolean | null
}

/** A half-open interval of hours, `[from, to)`. */
export interface Window {
  readonly from: Instant
  readonly to: Instant
}

/** What a horse's own record says, where there is one (ADR 0015's three-valued override). */
export type ThresholdChoice =
  { readonly stance: 'overridden'; readonly value: number } | { readonly stance: 'follows_default' }

/**
 * Every number in force: the rescue's defaults, and the horses that hold a
 * record of their own.
 *
 * A horse absent from `horses`, or present with no entry for a kind, is **not
 * yet decided** — the absence *is* the third state, which is why it is not
 * spelled anywhere as a value (ADR 0015).
 */
export interface ThresholdSet {
  readonly defaults: Readonly<Partial<Record<ThresholdKind, number>>>
  readonly horses: Readonly<
    Record<string, Readonly<Partial<Record<ThresholdKind, ThresholdChoice>>>>
  >
}

/** What the evaluation needs to know about a horse: that it exists. */
export interface ConditionSubject {
  readonly id: string
}

/** One (Condition, subject) answer, carrying what the item card has to cite. */
export interface Resolution {
  readonly condition: ConditionName
  /** The horse it is about, or `null` for the barn. */
  readonly horseId: string | null
  /** `null` where the forecast or the numbers could not answer it. */
  readonly holds: boolean | null
  readonly unresolved: UnresolvedReason | null
  readonly metric: Metric
  readonly thresholdValue: number | null
  readonly thresholdSource: ThresholdSource | null
  /** The number off the forecast that decided it — *Dawson: 38 °F, sheets under 50°*. */
  readonly readingValue: number | null
  /** The hour of the day it was read at, in the organisation's timezone. */
  readonly atHour: number | null
  readonly hoursRead: number
}

export interface Evaluation {
  readonly conditions: readonly ConditionName[]
  readonly hours: readonly HourReading[]
  readonly window: Window
  readonly thresholds: ThresholdSet
  readonly horses: readonly ConditionSubject[]
}

/** Where a Shift sits in its day, for the window derivation below. */
export interface ShiftWindow {
  readonly startsAt: Instant
  /** When the next Shift begins, or `null` where this is the day's last. */
  readonly nextStartsAt: Instant | null
}

/**
 * The window a Condition of this scope is read over (ADR 0015, amending
 * ADR 0013 twice).
 *
 * A **day**-scoped Condition is read over the whole day and shared by every
 * Shift in it, because *Staying In* changes the hay plan and an AM and a PM
 * that disagreed about it would feed the alternate regime to horses that went
 * out this morning.
 *
 * A **shift**-scoped one runs from this Shift's start until the next Shift
 * begins — not to the end of this Shift's own hours — because a blanket put on
 * at PM feed is worn all night, and the hours the volunteers are present are
 * not the hours the horse is wearing it.
 *
 * With no Shift at all it is the day: nothing materializes a Shift yet, and a
 * Reading taken for the Board is a reading of the day.
 */
export function windowFor(
  scope: ConditionScope,
  over: { readonly day: Window; readonly shift?: ShiftWindow },
): Window {
  if (scope === 'day' || over.shift === undefined) return over.day
  return { from: over.shift.startsAt, to: over.shift.nextStartsAt ?? over.day.to }
}

/** The hours inside a window, half-open at the end so two windows never share one. */
export function hoursWithin(hours: readonly HourReading[], window: Window): readonly HourReading[] {
  return hours
    .filter((hour) => hour.at >= window.from && hour.at < window.to)
    .sort((left, right) => left.at - right.at)
}

/**
 * The number in force for a horse, and where it came from.
 *
 * A rescue-wide kind ignores any per-horse row: *Staying In* is one answer for
 * the barn, and a row against a horse would be a number nobody set. A per-horse
 * kind with no record answers the default and says **undecided**, which is what
 * makes the horse get its sheet while the question stays visibly open
 * (ADR 0015).
 */
export function resolveThreshold(
  thresholds: ThresholdSet,
  kind: ThresholdKind,
  horseId: string | null,
): { readonly value: number | null; readonly source: ThresholdSource } {
  const fallback = thresholds.defaults[kind] ?? null

  if (horseId === null || !THRESHOLD_SPECS[kind].perHorse) {
    return { value: fallback, source: 'default' }
  }

  const choice = thresholds.horses[horseId]?.[kind]
  if (choice === undefined) return { value: fallback, source: 'undecided' }
  if (choice.stance === 'follows_default') return { value: fallback, source: 'default' }
  return { value: choice.value, source: 'override' }
}

/**
 * Every Condition asked of every subject it has one.
 *
 * The caller passes the Conditions of one scope and the window that scope
 * declares — `conditionsScoped` and `windowFor` above — because a day-scoped
 * and a shift-scoped Condition are read over different hours and evaluating
 * them against one window is the mistake ADR 0015 corrected.
 */
export function resolveConditions(evaluation: Evaluation): readonly Resolution[] {
  const hours = hoursWithin(evaluation.hours, evaluation.window)

  return evaluation.conditions.flatMap((condition): readonly Resolution[] => {
    const spec = CONDITION_SPECS[condition]
    if (spec.subject === 'rescue') {
      return [resolveOne(condition, spec, hours, evaluation.thresholds, null)]
    }
    return evaluation.horses.map((horse) =>
      resolveOne(condition, spec, hours, evaluation.thresholds, horse.id),
    )
  })
}

function resolveOne(
  condition: ConditionName,
  spec: ConditionSpec,
  hours: readonly HourReading[],
  thresholds: ThresholdSet,
  horseId: string | null,
): Resolution {
  const threshold = resolveThreshold(thresholds, spec.threshold, horseId)
  const floor =
    spec.notBelow === undefined ? null : resolveThreshold(thresholds, spec.notBelow, horseId)

  const base = {
    condition,
    horseId,
    metric: spec.metric,
    thresholdValue: threshold.value,
    thresholdSource: threshold.source,
    hoursRead: hours.length,
  }

  const unresolved = (because: UnresolvedReason, at?: HourReading, value?: number): Resolution => ({
    ...base,
    holds: null,
    unresolved: because,
    readingValue: value ?? null,
    atHour: at?.hour ?? null,
  })

  if (hours.length === 0) return unresolved('no_hours')
  if (threshold.value === null) return unresolved('no_threshold')
  // A **missing floor is no floor**, not an unanswerable Condition. A rescue
  // that set a sheet number and no blanket number has a sheet rule the app can
  // answer, and refusing to answer it would leave the whole barn undressed on
  // a cold morning over a number nobody needed yet. What the floor removes is
  // the overlap with Blanket Weather, and where there is no Blanket Weather
  // there is no overlap to remove.

  const measured = hours.filter((hour) => valueOf(hour, spec.metric) !== null)
  if (measured.length === 0) return unresolved('no_metric')

  // A predicate about rain cannot be answered by a provider that did not say
  // whether it rains, and a missing hour is a hole in the window rather than a
  // dry one.
  if (spec.precipitation !== undefined && hours.some((hour) => hour.precipitation === null)) {
    return unresolved('no_metric')
  }

  const answered = (holds: boolean, at: HourReading | null, value: number | null): Resolution => ({
    ...base,
    holds,
    unresolved: null,
    readingValue: value,
    atHour: at?.hour ?? null,
  })

  switch (spec.kind) {
    case 'threshold_crossing': {
      // The coldest hour, because that is the one the horse is dressed for —
      // and because deciding on it is what makes Sheet and Blanket mutually
      // exclusive by construction rather than by convention (ADR 0015).
      const deciding = extreme(measured, spec.metric, spec.reducer === 'warmest' ? 'max' : 'min')
      const value = valueOf(deciding, spec.metric) ?? 0
      const crosses = compare(value, threshold.value, spec.direction)
      const aboveFloor = floor?.value == null || value >= floor.value
      return answered(crosses && aboveFloor, deciding, value)
    }

    case 'time_of_crossing': {
      // Not *how hot*, but *when* — a hotter day that gets hot at four o'clock
      // is a day the horses go out.
      const crossing = measured.find((hour) =>
        compare(valueOf(hour, spec.metric) ?? 0, threshold.value ?? 0, spec.direction),
      )
      if (crossing === undefined) {
        const hottest = extreme(measured, spec.metric, 'max')
        return answered(false, null, valueOf(hottest, spec.metric))
      }
      const byHour = spec.byHour ?? 23
      return answered(crossing.hour <= byHour, crossing, valueOf(crossing, spec.metric))
    }

    case 'precipitation_presence': {
      if (spec.reducer === 'every_hour') {
        // The fly sheet is worn across the whole window, so one wet hour or one
        // hour over the ceiling is the answer for all of it.
        const dry = hours.every((hour) => hour.precipitation === (spec.precipitation === 'present'))
        const deciding = extreme(measured, spec.metric, 'max')
        const value = valueOf(deciding, spec.metric) ?? 0
        return answered(dry && compare(value, threshold.value, spec.direction), deciding, value)
      }

      const wanted = spec.precipitation === 'present'
      const deciding = measured.find(
        (hour) =>
          hour.precipitation === wanted &&
          compare(valueOf(hour, spec.metric) ?? 0, threshold.value ?? 0, spec.direction),
      )
      if (deciding !== undefined) {
        return answered(true, deciding, valueOf(deciding, spec.metric))
      }
      const coldest = extreme(measured, spec.metric, 'min')
      return answered(false, coldest, valueOf(coldest, spec.metric))
    }
  }
}

function valueOf(hour: HourReading, metric: Metric): number | null {
  switch (metric) {
    case 'air_temp':
      return hour.airTempF
    case 'apparent_temp':
      return hour.apparentTempF
    // Neither is fetched by any provider this application has (ADR 0015): the
    // enum exists so that adding one is a data change, and until something
    // reads one an hour carries no value for it.
    case 'temp_plus_humidity_sum':
    case 'wbgt':
      return null
  }
}

/** The hour holding the highest or lowest reading of a metric; ties go to the earlier hour. */
function extreme(hours: readonly HourReading[], metric: Metric, end: 'min' | 'max'): HourReading {
  let held = hours[0]
  if (held === undefined) throw new RangeError('No hours to reduce; the caller checked for none.')

  for (const hour of hours) {
    const value = valueOf(hour, metric)
    const best = valueOf(held, metric)
    if (value === null) continue
    if (best === null || (end === 'min' ? value < best : value > best)) held = hour
  }
  return held
}

function compare(value: number, threshold: number, direction: ConditionSpec['direction']): boolean {
  switch (direction) {
    case 'below':
      return value < threshold
    case 'at_or_above':
      return value >= threshold
    case 'at_or_below':
      return value <= threshold
  }
}
