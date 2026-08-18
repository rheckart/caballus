import { describe, expect, it } from 'vitest'

import { arrangeBoard, compareStallNames, type BoardHorseFacts } from './board'

function horse(name: string, at: { stall?: string; barn?: string } = {}): BoardHorseFacts {
  return {
    id: `${name.toLowerCase()}-1`,
    name,
    stall: at.stall === undefined ? null : { id: `stall-${at.stall}`, name: at.stall },
    barn: at.barn === undefined ? null : { id: `barn-${at.barn}`, name: at.barn },
  }
}

function stall(name: string) {
  return { id: `stall-${name}`, name }
}

/** The names of the rows of one section, an OPEN stall reading as its stall. */
function rowNames(section: {
  rows: readonly { stall: { name: string } | null; horse: unknown }[]
}) {
  return section.rows.map((row) => {
    const held = row.horse as BoardHorseFacts | null
    return held === null ? `${row.stall?.name ?? '?'}: OPEN` : held.name
  })
}

describe('stall order', () => {
  it('counts rather than spells: stall 10 comes after stall 9', () => {
    // The whole reason this is a comparison and not `order by name`: the
    // board's stalls are numbers, and a text sort puts 10 between 1 and 2.
    const names = ['10', '2 & 3', '1', '9'].sort(compareStallNames)
    expect(names).toEqual(['1', '2 & 3', '9', '10'])
  })

  it('reads a joined Space by the first stall in its name', () => {
    // "2 & 3" is one Space (ADR 0002), and it belongs where stall 2 was.
    expect(compareStallNames('2 & 3', '4') < 0).toBe(true)
    expect(compareStallNames('2 & 3', '1') > 0).toBe(true)
  })

  it('puts a stall with no number after the numbered ones, in name order', () => {
    const names = ['Foaling', '3', 'Barn aisle', '1'].sort(compareStallNames)
    expect(names).toEqual(['1', '3', 'Barn aisle', 'Foaling'])
  })
})

describe('the arrangement of the board', () => {
  it('puts the stalls first, in stall order, each stall carrying its horse', () => {
    const sections = arrangeBoard(
      [horse('Blue', { stall: '2 & 3' }), horse('Dawson', { stall: '1' })],
      [stall('1'), stall('2 & 3')],
    )

    expect(sections).toHaveLength(1)
    expect(rowNames(sections[0]!)).toEqual(['Dawson', 'Blue'])
  })

  it('keeps the row for a stall no horse is in', () => {
    // Stall 7 stands OPEN and the feed board keeps its row, because an empty
    // stall is information (ADR 0002).
    const sections = arrangeBoard([horse('Apollo', { stall: '10' })], [stall('7'), stall('10')])

    expect(rowNames(sections[0]!)).toEqual(['7: OPEN', 'Apollo'])
  })

  it('gives the Small Barn its own section, after the stalls', () => {
    const sections = arrangeBoard(
      [
        horse('Dawson', { stall: '1', barn: 'Main barn' }),
        horse('Mystery', { barn: 'Small Barn' }),
        horse('Nora', { barn: 'Small Barn' }),
      ],
      [stall('1')],
    )

    expect(sections.map((section) => section.heading)).toEqual(['Main barn', 'Small Barn'])
    expect(rowNames(sections[1]!)).toEqual(['Mystery', 'Nora'])
  })

  it('heads the stall section with the barn its horses are in, and otherwise says Stalls', () => {
    const named = arrangeBoard([horse('Dawson', { stall: '1', barn: 'Main barn' })], [stall('1')])
    expect(named[0]?.heading).toBe('Main barn')

    const unnamed = arrangeBoard([horse('Dawson', { stall: '1' })], [stall('1')])
    expect(unnamed[0]?.heading).toBe('Stalls')
  })

  it('shows a horse with no Space at all rather than dropping it off the board', () => {
    // A horse the board cannot place is the one thing a faithful grid may not
    // do: leave a horse off it.
    const sections = arrangeBoard([horse('Storm')], [])

    expect(sections.map((section) => section.heading)).toEqual(['No space assigned'])
    expect(rowNames(sections[0]!)).toEqual(['Storm'])
  })

  it('keeps a horse whose stall is not among the Spaces it was given', () => {
    const sections = arrangeBoard([horse('Apollo', { stall: '10' })], [])

    expect(rowNames(sections[0]!)).toEqual(['Apollo'])
  })

  it('leaves out a section with no rows', () => {
    expect(arrangeBoard([], [])).toEqual([])
  })
})
