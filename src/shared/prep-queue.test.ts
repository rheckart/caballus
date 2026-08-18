import { describe, expect, it } from 'vitest'

import { arrangePrepQueue, type PrepQueueItem } from './prep-queue'

function item(overrides: Partial<PrepQueueItem> & { readonly id: string }): PrepQueueItem {
  return {
    horseId: null,
    horseName: null,
    horseStallName: null,
    spaceId: null,
    spaceName: null,
    ...overrides,
  }
}

describe('arrangePrepQueue', () => {
  it('puts stalled horses in stall order, "10" after "9"', () => {
    const arranged = arrangePrepQueue([
      item({ id: 'a', horseId: 'blue', horseName: 'Blue', horseStallName: '10' }),
      item({ id: 'b', horseId: 'apollo', horseName: 'Apollo', horseStallName: '2' }),
      item({ id: 'c', horseId: 'nora', horseName: 'Nora', horseStallName: '9' }),
    ])

    expect(arranged.horses.map((card) => card.horseId)).toEqual(['apollo', 'nora', 'blue'])
  })

  it('groups every Item for one horse onto one card', () => {
    const arranged = arrangePrepQueue([
      item({ id: 'feed', horseId: 'apollo', horseName: 'Apollo', horseStallName: '2' }),
      item({ id: 'medicate', horseId: 'apollo', horseName: 'Apollo', horseStallName: '2' }),
    ])

    expect(arranged.horses).toHaveLength(1)
    expect(arranged.horses[0]?.items.map((each) => each.id)).toEqual(['feed', 'medicate'])
  })

  it('puts unstalled horses after stalled ones, by name', () => {
    const arranged = arrangePrepQueue([
      item({ id: 'a', horseId: 'zara', horseName: 'Zara', horseStallName: null }),
      item({ id: 'b', horseId: 'mystery', horseName: 'Mystery', horseStallName: null }),
      item({ id: 'c', horseId: 'apollo', horseName: 'Apollo', horseStallName: '1' }),
    ])

    expect(arranged.horses.map((card) => card.horseId)).toEqual(['apollo', 'mystery', 'zara'])
  })

  it('groups Items with no horse but a Space onto Space cards, sorted by name', () => {
    const arranged = arrangePrepQueue([
      item({ id: 'a', spaceId: 'field-d', spaceName: 'Field D' }),
      item({ id: 'b', spaceId: 'field-c', spaceName: 'Field C' }),
    ])

    expect(arranged.horses).toEqual([])
    expect(arranged.spaces.map((card) => card.spaceId)).toEqual(['field-c', 'field-d'])
  })

  it('puts an Item with neither a horse nor a Space in the rescue list', () => {
    const arranged = arrangePrepQueue([item({ id: 'sweep' })])

    expect(arranged.horses).toEqual([])
    expect(arranged.spaces).toEqual([])
    expect(arranged.rescue.map((each) => each.id)).toEqual(['sweep'])
  })

  it('drops nothing: every Item lands on exactly one card or the rescue list', () => {
    const items = [
      item({ id: 'a', horseId: 'apollo', horseName: 'Apollo', horseStallName: '1' }),
      item({ id: 'b', spaceId: 'field-c', spaceName: 'Field C' }),
      item({ id: 'c' }),
    ]
    const arranged = arrangePrepQueue(items)

    const seen = [
      ...arranged.horses.flatMap((card) => card.items.map((each) => each.id)),
      ...arranged.spaces.flatMap((card) => card.items.map((each) => each.id)),
      ...arranged.rescue.map((each) => each.id),
    ]
    expect(seen.sort()).toEqual(items.map((each) => each.id).sort())
  })
})
