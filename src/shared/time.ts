/**
 * Wall clock and day formatting for code that runs on either side of the wire.
 *
 * ADR 0016 bans `Date` and `Intl` everywhere but the two time modules, because
 * a day boundary derived in the browser's timezone passes every check and is
 * wrong for half the year. This module is one of the two, and it is the only
 * place `Intl` is constructed for display.
 *
 * The calendar itself lives in `src/server/time.ts`. What arrives here is a
 * `DayString` the server already resolved in the organisation's timezone.
 */

declare const instantBrand: unique symbol

/**
 * A moment, as epoch milliseconds and nothing else. It carries no calendar
 * methods, so elapsed time is arithmetic and a day boundary is unreachable.
 */
export type Instant = number & { readonly [instantBrand]: true }

declare const dayBrand: unique symbol

/** A calendar day in the organisation's timezone, as `YYYY-MM-DD`. */
export type DayString = string & { readonly [dayBrand]: true }

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * The rescue is one organisation in Maryland, so display is en-US. This is a
 * deliberate pin rather than the host's locale: a test asserting a formatted
 * day must not depend on which machine ran it.
 */
const DISPLAY_LOCALE = 'en-US'

const MILLIS_PER_DAY = 86_400_000

/**
 * The current moment.
 *
 * `performance.timeOrigin + performance.now()` rather than a clock read: it is
 * epoch-anchored like a wall clock but monotonic, so a phone whose clock jumps
 * mid-shift cannot make elapsed time run backwards.
 */
export function now(): Instant {
  return Math.trunc(performance.timeOrigin + performance.now()) as Instant
}

/** Wraps epoch milliseconds — a timestamp off the wire — as an `Instant`. */
export function instant(epochMillis: number): Instant {
  if (!Number.isFinite(epochMillis)) {
    throw new TypeError(`Not an instant: ${String(epochMillis)}`)
  }
  return Math.trunc(epochMillis) as Instant
}

/** Milliseconds between two instants. Negative when `to` precedes `from`. */
export function elapsed(from: Instant, to: Instant): number {
  return to - from
}

export function isDayString(value: string): value is DayString {
  return DAY_PATTERN.test(value)
}

/**
 * Accepts a `YYYY-MM-DD` day from the server. The shape is checked here; that
 * the date exists in a calendar is the server's business.
 */
export function dayString(value: string): DayString {
  if (!isDayString(value)) {
    throw new TypeError(`Not a day: ${value}`)
  }
  return value
}

/** The day it is right now, in the organisation's timezone. */
export function todayIn(timeZone: string): DayString {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now())
  return dayString(parts)
}

/**
 * A day, for a volunteer to read: `Today`, `Tomorrow`, `Yesterday`, or
 * `Sat, Mar 7`.
 *
 * The timezone is what makes "today" answerable — the day string itself is
 * already anchored to the organisation's day, so it needs no conversion.
 */
export function formatDay(day: DayString, timeZone: string): string {
  const today = todayIn(timeZone)
  const offset = daysBetween(today, day)
  if (offset === 0) return 'Today'
  if (offset === 1) return 'Tomorrow'
  if (offset === -1) return 'Yesterday'

  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(middayUtc(day))
}

/**
 * Whole days from `from` to `to`, both being days in the same timezone.
 *
 * Counting days between two calendar days needs no timezone once both are
 * anchored: midday UTC is far enough from either edge that no rounding lands
 * on the wrong day.
 */
export function daysBetween(from: DayString, to: DayString): number {
  return Math.round((middayUtc(to) - middayUtc(from)) / MILLIS_PER_DAY)
}

function middayUtc(day: DayString): number {
  const match = DAY_PATTERN.exec(day)
  if (!match) throw new TypeError(`Not a day: ${day}`)
  const [, year, month, dayOfMonth] = match
  return Date.UTC(Number(year), Number(month) - 1, Number(dayOfMonth), 12)
}
