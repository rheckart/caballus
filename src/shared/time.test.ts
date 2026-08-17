import { describe, expect, it } from 'vitest'

import { addDays } from '../server/time'
import {
  dayString,
  daysBetween,
  elapsed,
  formatDay,
  instant,
  isDayString,
  now,
  todayIn,
} from './time'

const BALTIMORE = 'America/New_York'

describe('now', () => {
  it('is epoch milliseconds', () => {
    const at = now()
    expect(at).toBeGreaterThan(1_700_000_000_000)
    expect(Number.isInteger(at)).toBe(true)
  })

  it('does not run backwards', () => {
    expect(elapsed(now(), now())).toBeGreaterThanOrEqual(0)
  })
})

describe('instant', () => {
  it('refuses a value that is not a number of milliseconds', () => {
    expect(() => instant(Number.NaN)).toThrow(TypeError)
  })
})

describe('dayString', () => {
  it('accepts a server day', () => {
    expect(dayString('2026-08-15')).toBe('2026-08-15')
  })

  it.each(['15/08/2026', '2026-8-15', 'today', ''])('refuses %o', (value) => {
    expect(isDayString(value)).toBe(false)
    expect(() => dayString(value)).toThrow(TypeError)
  })
})

describe('daysBetween', () => {
  it('counts forwards and backwards', () => {
    expect(daysBetween(dayString('2026-08-15'), dayString('2026-08-18'))).toBe(3)
    expect(daysBetween(dayString('2026-08-18'), dayString('2026-08-15'))).toBe(-3)
  })

  it('is unmoved by a daylight-saving change', () => {
    // The US clocks go forward on 2026-03-08. That day is 23 hours long, and a
    // count of days that divides milliseconds would call this 2.
    expect(daysBetween(dayString('2026-03-07'), dayString('2026-03-10'))).toBe(3)
  })
})

describe('formatDay', () => {
  // The neighbouring days come from the server's calendar rather than from
  // arithmetic here: this file is not exempt from the day-boundary ban, and
  // nor should a test be.
  it('says today, tomorrow and yesterday', () => {
    const today = todayIn(BALTIMORE)
    expect(formatDay(today, BALTIMORE)).toBe('Today')
    expect(formatDay(addDays(today, 1, BALTIMORE), BALTIMORE)).toBe('Tomorrow')
    expect(formatDay(addDays(today, -1, BALTIMORE), BALTIMORE)).toBe('Yesterday')
  })

  it('names any other day', () => {
    expect(formatDay(dayString('2020-03-07'), BALTIMORE)).toBe('Sat, Mar 7')
  })
})
