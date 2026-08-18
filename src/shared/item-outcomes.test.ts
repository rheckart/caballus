import { describe, expect, it } from 'vitest'

import {
  ITEM_OUTCOMES,
  consecutiveSkips,
  isItemOutcome,
  isOverdue,
  isSkip,
  mayDrop,
  type ItemOutcome,
} from './item-outcomes'

describe('isItemOutcome', () => {
  it('accepts the three written outcomes and refuses everything else, blank included', () => {
    for (const outcome of ITEM_OUTCOMES) expect(isItemOutcome(outcome)).toBe(true)
    expect(isItemOutcome('blank')).toBe(false)
    expect(isItemOutcome('n/a')).toBe(false)
    expect(isItemOutcome('')).toBe(false)
  })
})

describe('isSkip', () => {
  const cases: readonly [ItemOutcome | null, boolean][] = [
    ['done', false],
    ['dropped', true],
    ['not_done', true],
    // Blank — nobody answered — is a skip like the honest Drop, never softer.
    [null, true],
  ]

  it.each(cases)('reads %s as a skip: %s', (outcome, expected) => {
    expect(isSkip(outcome)).toBe(expected)
  })
})

describe('consecutiveSkips', () => {
  it('counts zero against an empty history', () => {
    expect(consecutiveSkips([])).toBe(0)
  })

  it('counts leading skips and stops at the first Done', () => {
    expect(consecutiveSkips([true, true, true])).toBe(3)
    expect(consecutiveSkips([true, true, false, true])).toBe(2)
    expect(consecutiveSkips([false, true, true])).toBe(0)
  })
})

describe('isOverdue', () => {
  it('is never overdue against a null tolerance', () => {
    expect(isOverdue(0, null)).toBe(false)
    expect(isOverdue(50, null)).toBe(false)
  })

  it('is overdue once leaving today skipped would reach the tolerance count', () => {
    // Tolerance 3: two prior skips means today would be the third in a row.
    expect(isOverdue(2, 3)).toBe(true)
    expect(isOverdue(1, 3)).toBe(false)
    expect(isOverdue(3, 3)).toBe(true)
  })

  it('is overdue immediately at a tolerance of one', () => {
    expect(isOverdue(0, 1)).toBe(true)
  })
})

describe('mayDrop', () => {
  it('refuses Essential work regardless of tolerance', () => {
    expect(mayDrop('essential', false)).toBe(false)
    expect(mayDrop('essential', true)).toBe(false)
  })

  it('allows Discretionary work under tolerance and withdraws it once overdue', () => {
    expect(mayDrop('discretionary', false)).toBe(true)
    expect(mayDrop('discretionary', true)).toBe(false)
  })
})
