import { describe, expect, it } from 'vitest'

import { isAtOrBelowReorderPoint, projectedDaysRemaining, type SuppliesReading } from './supplies'
import { dayString } from './time'

describe('projectedDaysRemaining', () => {
  it('is null with nothing ever counted', () => {
    expect(projectedDaysRemaining(null, dayString('2026-08-18'))).toBeNull()
  })

  it.each([
    {
      name: 'reads unchanged on the day it was counted',
      reading: { daysRemaining: 14.5, countedOn: dayString('2026-08-04') },
      today: '2026-08-04',
      expected: 14.5,
    },
    {
      name: 'decrements one day for one elapsed day',
      reading: { daysRemaining: 14.5, countedOn: dayString('2026-08-04') },
      today: '2026-08-05',
      expected: 13.5,
    },
    {
      name: "the whiteboard's own example — 14.5 on the 4th reads 9.5 on the 9th",
      reading: { daysRemaining: 14.5, countedOn: dayString('2026-08-04') },
      today: '2026-08-09',
      expected: 9.5,
    },
    {
      name: 'floors at zero rather than answering a negative number',
      reading: { daysRemaining: 14.5, countedOn: dayString('2026-08-04') },
      today: '2026-08-19',
      expected: 0,
    },
    {
      name: 'floors exactly at zero, not just below it',
      reading: { daysRemaining: 5, countedOn: dayString('2026-08-04') },
      today: '2026-08-09',
      expected: 0,
    },
    {
      name: 'crosses a month boundary correctly',
      reading: { daysRemaining: 5, countedOn: dayString('2026-07-30') },
      today: '2026-08-02',
      expected: 2,
    },
    {
      name: 'crosses a year boundary correctly',
      reading: { daysRemaining: 5, countedOn: dayString('2025-12-30') },
      today: '2026-01-02',
      expected: 2,
    },
    {
      name: 'crosses the US daylight-saving change without losing a day',
      // 2026-03-08 is 23 hours long; a count that divides milliseconds
      // instead of counting calendar days would call this short.
      reading: { daysRemaining: 10, countedOn: dayString('2026-03-07') },
      today: '2026-03-10',
      expected: 7,
    },
  ] satisfies readonly {
    readonly name: string
    readonly reading: SuppliesReading
    readonly today: string
    readonly expected: number
  }[])('$name', ({ reading, today, expected }) => {
    expect(projectedDaysRemaining(reading, dayString(today))).toBe(expected)
  })
})

describe('isAtOrBelowReorderPoint', () => {
  it('is false with no reorder point set — the Product never opted in', () => {
    expect(isAtOrBelowReorderPoint(3, null)).toBe(false)
  })

  it('is false with nothing counted yet — nothing to compare', () => {
    expect(isAtOrBelowReorderPoint(null, 7)).toBe(false)
  })

  it('is true exactly at the reorder point', () => {
    expect(isAtOrBelowReorderPoint(7, 7)).toBe(true)
  })

  it('is true below the reorder point', () => {
    expect(isAtOrBelowReorderPoint(3, 7)).toBe(true)
  })

  it('is false above the reorder point', () => {
    expect(isAtOrBelowReorderPoint(10, 7)).toBe(false)
  })
})
