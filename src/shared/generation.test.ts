/**
 * What generation decides, as a table (ADR 0001).
 *
 * The claim under test is the one the ticket asks for by name: **generating
 * twice creates nothing twice**. Everything about idempotency that is not the
 * database's unique index is here — which Shifts a horizon wants, and which of
 * them already exist — as a pure function of days, Patterns and what is
 * already there.
 *
 * Pure throughout: no clock and no rows. Which days the horizon covers, and
 * what weekday each is in the barn's timezone, is the caller's answer to give
 * (ADR 0007).
 */
import { describe, expect, it } from 'vitest'

import { shiftsToGenerate, type HorizonDay, type PatternToGenerate } from './generation'
import { dayString } from './time'

/** A fortnight from Monday the 5th of January 2026, which is a real Monday. */
const HORIZON: readonly HorizonDay[] = [
  { day: dayString('2026-01-05'), weekday: 'monday' },
  { day: dayString('2026-01-06'), weekday: 'tuesday' },
  { day: dayString('2026-01-07'), weekday: 'wednesday' },
  { day: dayString('2026-01-08'), weekday: 'thursday' },
  { day: dayString('2026-01-09'), weekday: 'friday' },
  { day: dayString('2026-01-10'), weekday: 'saturday' },
  { day: dayString('2026-01-11'), weekday: 'sunday' },
  { day: dayString('2026-01-12'), weekday: 'monday' },
  { day: dayString('2026-01-13'), weekday: 'tuesday' },
  { day: dayString('2026-01-14'), weekday: 'wednesday' },
]

const TUESDAY_AM: PatternToGenerate = { id: 'tuesday-am', weekday: 'tuesday' }
const TUESDAY_PM: PatternToGenerate = { id: 'tuesday-pm', weekday: 'tuesday' }
const SATURDAY_AM: PatternToGenerate = { id: 'saturday-am', weekday: 'saturday' }

function generated(
  patterns: readonly PatternToGenerate[],
  existing: readonly { readonly patternId: string; readonly day: string }[] = [],
): readonly string[] {
  return shiftsToGenerate(
    patterns,
    HORIZON,
    existing.map((each) => ({ patternId: each.patternId, day: dayString(each.day) })),
  ).map((each) => `${each.patternId}:${each.day}`)
}

describe('what a horizon wants', () => {
  it('puts a Pattern on every one of its weekdays in the window', () => {
    expect(generated([TUESDAY_AM])).toEqual(['tuesday-am:2026-01-06', 'tuesday-am:2026-01-13'])
  })

  it('generates nothing for a Pattern whose day the window does not reach', () => {
    // The fortnight above stops on a Wednesday, so its second Saturday is
    // outside it — and a Shift outside the horizon is one the next run makes.
    expect(generated([SATURDAY_AM])).toEqual(['saturday-am:2026-01-10'])
  })

  it('puts two Patterns on the same day, because AM and PM are two Shifts', () => {
    expect(generated([TUESDAY_AM, TUESDAY_PM])).toEqual([
      'tuesday-am:2026-01-06',
      'tuesday-pm:2026-01-06',
      'tuesday-am:2026-01-13',
      'tuesday-pm:2026-01-13',
    ])
  })

  it('answers in day order, so a partial run leaves the near days done first', () => {
    const days = generated([SATURDAY_AM, TUESDAY_AM]).map((each) => each.split(':')[1])
    expect(days).toEqual([...days].sort())
  })

  it('wants nothing when there are no Patterns at all', () => {
    expect(generated([])).toEqual([])
  })
})

describe('generating twice', () => {
  it('creates nothing the second time', () => {
    const first = generated([TUESDAY_AM, SATURDAY_AM])
    const already = first.map((each) => {
      const [patternId, day] = each.split(':')
      return { patternId: patternId ?? '', day: day ?? '' }
    })
    expect(generated([TUESDAY_AM, SATURDAY_AM], already)).toEqual([])
  })

  it('fills only the gap when one occurrence is already there', () => {
    expect(generated([TUESDAY_AM], [{ patternId: 'tuesday-am', day: '2026-01-06' }])).toEqual([
      'tuesday-am:2026-01-13',
    ])
  })

  it('is not confused by another Pattern occupying the same day', () => {
    // Two Patterns on one Tuesday are two Shifts; one existing must not stand
    // in for the other, which is the failure a day-keyed check would have.
    expect(
      generated([TUESDAY_AM, TUESDAY_PM], [{ patternId: 'tuesday-pm', day: '2026-01-06' }]),
    ).toEqual(['tuesday-am:2026-01-06', 'tuesday-am:2026-01-13', 'tuesday-pm:2026-01-13'])
  })

  it('ignores a Shift that belongs to no Pattern, because a Pop-up is not an occurrence', () => {
    // A Pop-up on Tuesday morning is somebody's ad-hoc call for help and says
    // nothing about whether Tuesday's Feed AM exists (`CONTEXT.md`'s Pop-up).
    expect(generated([TUESDAY_AM], [{ patternId: 'a-pop-up', day: '2026-01-06' }])).toEqual([
      'tuesday-am:2026-01-06',
      'tuesday-am:2026-01-13',
    ])
  })

  it('ignores an occurrence outside the window it was asked about', () => {
    expect(generated([TUESDAY_AM], [{ patternId: 'tuesday-am', day: '2025-12-30' }])).toEqual([
      'tuesday-am:2026-01-06',
      'tuesday-am:2026-01-13',
    ])
  })
})
