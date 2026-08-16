/**
 * The calendar. This is the only module in the repository that does IANA
 * arithmetic, and the second of the two exempt from ADR 0016's day-boundary
 * ban.
 *
 * ADR 0007: the day boundary belongs to the organisation, not to the browser.
 * Overdue alerts, the fourteen-day feed-board marker and days-of-supply are all
 * day arithmetic, and a day has no meaning without a timezone. Timestamps cross
 * the wire as instants; days cross it as `DayString`s resolved here.
 *
 * Luxon rather than a Temporal polyfill, on ADR 0007's instruction to prefer
 * the unfashionable option with a decade of answers behind it.
 */
import { DateTime, IANAZone } from 'luxon'

import { dayString, instant, type DayString, type Instant } from '../shared/time'

/** True when the string names a zone this machine's ICU data knows. */
export function isTimeZone(timeZone: string): boolean {
  return IANAZone.isValidZone(timeZone)
}

function zoned(timeZone: string): { zone: string } {
  if (!isTimeZone(timeZone)) {
    throw new RangeError(`Unknown timezone: ${timeZone}`)
  }
  return { zone: timeZone }
}

/** The day it is now, in the organisation's timezone. */
export function today(timeZone: string): DayString {
  return dayString(DateTime.now().setZone(zoned(timeZone).zone).toISODate() ?? '')
}

/** The day an instant fell on, in the organisation's timezone. */
export function dayOf(at: Instant, timeZone: string): DayString {
  const iso = DateTime.fromMillis(at, zoned(timeZone)).toISODate()
  if (iso === null) throw new RangeError(`Not a representable instant: ${String(at)}`)
  return dayString(iso)
}

/**
 * The half-open interval `[start, end)` a day covers in the organisation's
 * timezone — the thing a query filtering `timestamptz` by day actually needs.
 * The two are not 24 hours apart on the days the clocks change, which is the
 * whole reason this is computed here and not by subtraction somewhere else.
 */
export function dayBounds(day: DayString, timeZone: string): { start: Instant; end: Instant } {
  const start = parse(day, timeZone)
  return {
    start: instant(start.toMillis()),
    end: instant(start.plus({ days: 1 }).toMillis()),
  }
}

/** The day `count` days after `day` — negative counts go backwards. */
export function addDays(day: DayString, count: number, timeZone: string): DayString {
  const iso = parse(day, timeZone).plus({ days: count }).toISODate()
  if (iso === null) throw new RangeError(`Not a representable day: ${day}`)
  return dayString(iso)
}

/** Whole days from `from` to `to`, in the organisation's timezone. */
export function daysBetween(from: DayString, to: DayString, timeZone: string): number {
  return Math.round(parse(to, timeZone).diff(parse(from, timeZone), 'days').days)
}

function parse(day: DayString, timeZone: string): DateTime<true> {
  const parsed = DateTime.fromISO(day, zoned(timeZone)).startOf('day')
  if (!parsed.isValid) {
    throw new RangeError(`Not a day in ${timeZone}: ${day} (${parsed.invalidReason})`)
  }
  return parsed as DateTime<true>
}
