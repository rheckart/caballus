/**
 * `seriesNames`, table-tested: it is the one place the numbering of a run of
 * Spaces lives, the screen previews it and the write sends its output
 * verbatim, so a wrong answer here is a barn full of wrongly-named stalls.
 */
import { describe, expect, it } from 'vitest'

import { MOST_SPACES_AT_ONCE, seriesNames } from './spaces'

describe('seriesNames', () => {
  const cases: readonly {
    readonly what: string
    readonly given: Parameters<typeof seriesNames>[0]
    readonly expected: readonly string[]
  }[] = [
    {
      what: 'numbers a run from one',
      given: { prefix: 'Stall ', style: 'numbers', from: 1, count: 3 },
      expected: ['Stall 1', 'Stall 2', 'Stall 3'],
    },
    {
      what: 'starts a run wherever the barn already stopped',
      given: { prefix: 'Stall ', style: 'numbers', from: 11, count: 2 },
      expected: ['Stall 11', 'Stall 12'],
    },
    {
      what: 'letters a run, which is how fields are named',
      given: { prefix: 'Field ', style: 'letters', from: 1, count: 3 },
      expected: ['Field A', 'Field B', 'Field C'],
    },
    {
      what: 'starts lettering from the nth letter',
      given: { prefix: 'Field ', style: 'letters', from: 3, count: 2 },
      expected: ['Field C', 'Field D'],
    },
    {
      // Twenty-seven fields is not a real barn, but running out of alphabet
      // silently and starting again at A would be a duplicate nobody catches.
      what: 'carries past Z rather than starting again',
      given: { prefix: '', style: 'letters', from: 26, count: 3 },
      expected: ['Z', 'AA', 'AB'],
    },
    {
      what: 'takes a prefix that is not a word, since a barn may just number',
      given: { prefix: '', style: 'numbers', from: 1, count: 2 },
      expected: ['1', '2'],
    },
    {
      what: 'is empty for a count of nothing, rather than one name',
      given: { prefix: 'Stall ', style: 'numbers', from: 1, count: 0 },
      expected: [],
    },
    {
      what: 'is empty for a negative count rather than throwing',
      given: { prefix: 'Stall ', style: 'numbers', from: 1, count: -4 },
      expected: [],
    },
    {
      what: 'treats a first number below one as one',
      given: { prefix: 'Stall ', style: 'numbers', from: 0, count: 2 },
      expected: ['Stall 1', 'Stall 2'],
    },
    {
      what: 'truncates a fractional count rather than inventing a name for 2.5',
      given: { prefix: 'Stall ', style: 'numbers', from: 1, count: 2.9 },
      expected: ['Stall 1', 'Stall 2'],
    },
  ]

  for (const { what, given, expected } of cases) {
    it(what, () => {
      expect(seriesNames(given)).toEqual(expected)
    })
  }

  it('never returns more than one act may create', () => {
    expect(seriesNames({ prefix: 'Stall ', style: 'numbers', from: 1, count: 5000 })).toHaveLength(
      MOST_SPACES_AT_ONCE,
    )
  })
})
