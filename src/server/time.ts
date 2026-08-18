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
import { WEEKDAYS, type Weekday } from '../shared/shifts'

/** True when the string names a zone this machine's ICU data knows. */
export function isTimeZone(timeZone: string): boolean {
  return IANAZone.isValidZone(timeZone)
}

function zonedName(timeZone: string): string {
  return zoned(timeZone).zone
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

/**
 * Whole days between two days is `daysBetween` in `src/shared/time.ts`, and it
 * is re-exported rather than reimplemented here: once both ends are days in the
 * same timezone the zone drops out of the arithmetic, and two functions of one
 * name that agree today are two that can disagree later.
 */
export { daysBetween } from '../shared/time'

function parse(day: DayString, timeZone: string): DateTime<true> {
  const parsed = DateTime.fromISO(day, zoned(timeZone)).startOf('day')
  if (!parsed.isValid) {
    throw new RangeError(`Not a day in ${timeZone}: ${day} (${parsed.invalidReason})`)
  }
  return parsed as DateTime<true>
}

/**
 * The hour of the day an instant fell in, in the organisation's timezone.
 *
 * *85 real feel at or before noon* is a question about the barn's clock
 * (ADR 0015), and a forecast hour arrives from a provider as an instant. This
 * is the conversion, and it lives here for the same reason `dayOf` does.
 */
export function hourOf(at: Instant, timeZone: string): number {
  const zoned = DateTime.fromMillis(at, { zone: zonedName(timeZone) })
  if (!zoned.isValid) throw new RangeError(`Not a representable instant: ${String(at)}`)
  return zoned.hour
}

/**
 * An ISO timestamp from outside — a forecast hour off a weather provider —
 * as an instant.
 *
 * Here rather than in the provider module because parsing a timestamp with an
 * offset is calendar arithmetic, and this is the only module that does any
 * (ADR 0016). The provider knows the URL; the calendar knows the clock.
 */
export function instantOfIso(iso: string): Instant {
  const parsed = DateTime.fromISO(iso, { setZone: true })
  if (!parsed.isValid) throw new RangeError(`Not an ISO timestamp: ${iso}`)
  return instant(parsed.toMillis())
}

/**
 * An instant as the driver hands it to a `timestamptz` column, and back.
 *
 * The two exist so that no other module constructs a `Date` to write one:
 * ADR 0016 bans the global everywhere but here, and a Reading has two
 * timestamps a caller genuinely chooses — when the forecast was fetched, and
 * which hour of it a row is. Neither is a day boundary, which is what the ban
 * is about, and neither is an excuse to open one.
 */
export function timestampOf(at: Instant): Date {
  return new Date(at)
}

export function instantOfTimestamp(value: Date): Instant {
  return instant(value.getTime())
}

/**
 * An instant as an ISO timestamp in the organisation's timezone — the other
 * direction of `instantOfIso`.
 *
 * Paired with it deliberately: a provider hands us ISO strings and something
 * has to be able to hand one back, and both halves of that conversion belong
 * in the module that owns the calendar rather than either being done by hand
 * beside a URL.
 */
export function isoOf(at: Instant, timeZone: string): string {
  const zoned = DateTime.fromMillis(at, { zone: zonedName(timeZone) })
  const iso = zoned.toISO()
  if (iso === null) throw new RangeError(`Not a representable instant: ${String(at)}`)
  return iso
}

/**
 * What weekday a day is, in the organisation's timezone (ADR 0001's Shift
 * Patterns recur on one).
 *
 * A word rather than Luxon's number, because `WEEKDAYS` is what a Pattern
 * stores and the two libraries this application touches disagree about which
 * day is zero. Luxon counts Monday as 1, which is the order `WEEKDAYS` is
 * written in, and this is the one place that conversion happens.
 */
export function weekdayOf(day: DayString, timeZone: string): Weekday {
  const weekday = WEEKDAYS[parse(day, timeZone).weekday - 1]
  if (weekday === undefined) throw new RangeError(`Not a day: ${day}`)
  return weekday
}

/**
 * The days of a horizon, from `from` inclusive, each with its weekday — what
 * generation reads (ADR 0001's rolling two-week window).
 */
export function horizonFrom(
  from: DayString,
  days: number,
  timeZone: string,
): readonly { day: DayString; weekday: Weekday }[] {
  const horizon: { day: DayString; weekday: Weekday }[] = []
  for (let ahead = 0; ahead < days; ahead += 1) {
    const day = addDays(from, ahead, timeZone)
    horizon.push({ day, weekday: weekdayOf(day, timeZone) })
  }
  return horizon
}

/**
 * The instant a Shift starts: a day and a `HH:MM` on the barn's own clock.
 *
 * The two are stored separately because that is what they are — a Shift on the
 * morning the clocks go forward starts at six regardless of how many hours ago
 * that was — and this is where they become a moment.
 */
export function startOfShift(day: DayString, timeOfDay: string, timeZone: string): Instant {
  const [hour, minute] = timeOfDay.split(':')
  const started = parse(day, timeZone).set({
    hour: Number(hour ?? ''),
    minute: Number(minute ?? ''),
  })
  if (!started.isValid) throw new RangeError(`Not a time of day: ${timeOfDay}`)
  return instant(started.toMillis())
}
