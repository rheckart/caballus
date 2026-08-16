import { describe, expect, it } from 'vitest'

import { dayString, instant } from '../shared/time'
import { addDays, dayBounds, dayOf, daysBetween, isTimeZone, today } from './time'

const BALTIMORE = 'America/New_York'
const HOUR = 3_600_000

/** An instant at a UTC wall-clock time, built without touching the calendar. */
function atUtc(day: string, hours: number): ReturnType<typeof instant> {
  return instant(dayBounds(dayString(day), 'UTC').start + hours * HOUR)
}

describe('today', () => {
  it('answers as a day in the organisation timezone', () => {
    expect(today(BALTIMORE)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('refuses a timezone nobody has heard of', () => {
    expect(isTimeZone('Barn/FrontField')).toBe(false)
    expect(() => today('Barn/FrontField')).toThrow(RangeError)
  })
})

describe('dayOf', () => {
  // 03:30 UTC on the 15th is still the evening of the 14th in Maryland. A
  // boundary derived in UTC files that evening's feed against the wrong day.
  it('puts a late-evening instant on the day the barn was in', () => {
    expect(dayOf(atUtc('2026-08-15', 3.5), BALTIMORE)).toBe('2026-08-14')
    expect(dayOf(atUtc('2026-08-15', 3.5), 'UTC')).toBe('2026-08-15')
  })
})

describe('dayBounds', () => {
  it('covers a day, half-open', () => {
    const { start, end } = dayBounds(dayString('2026-08-15'), BALTIMORE)
    expect(dayOf(start, BALTIMORE)).toBe('2026-08-15')
    expect(dayOf(instant(end - 1), BALTIMORE)).toBe('2026-08-15')
    expect(dayOf(end, BALTIMORE)).toBe('2026-08-16')
  })

  it('is 23 hours long on the day the clocks go forward', () => {
    const { start, end } = dayBounds(dayString('2026-03-08'), BALTIMORE)
    expect(end - start).toBe(23 * HOUR)
  })
})

describe('addDays and daysBetween', () => {
  it('crosses a daylight-saving boundary without losing a day', () => {
    expect(addDays(dayString('2026-03-07'), 3, BALTIMORE)).toBe('2026-03-10')
    expect(daysBetween(dayString('2026-03-07'), dayString('2026-03-10'), BALTIMORE)).toBe(3)
  })

  it('goes backwards over a year end', () => {
    expect(addDays(dayString('2026-01-01'), -1, BALTIMORE)).toBe('2025-12-31')
  })
})
