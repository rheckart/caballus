/**
 * Table-driven tests of the pure Attendance arithmetic (ADR 0012): hours off
 * the ledger, the fourth roster fact, the school-eligible flag, and the two
 * county renderings of one set of rows.
 */
import { describe, expect, it } from 'vitest'

import {
  ATTESTATION_RELATIONSHIPS,
  anneArundelReport,
  calvertReport,
  hoursOf,
  isAttestationRelationship,
  isOpen,
  isSchoolEligible,
  mayAttest,
  rosteredAbsent,
  type AttendanceRecord,
  type AttestationRelationship,
  type LedgerRow,
} from './attendance'
import type { DayString } from './time'

const DAY = '2026-08-18' as DayString

describe('isOpen', () => {
  it('is open while nobody has recorded a departure', () => {
    const record: AttendanceRecord = { volunteerId: 'beth', arrivedAt: 0, departedAt: null }
    expect(isOpen(record)).toBe(true)
  })

  it('is closed once a departure is recorded, however soon after', () => {
    const record: AttendanceRecord = { volunteerId: 'beth', arrivedAt: 0, departedAt: 1 }
    expect(isOpen(record)).toBe(false)
  })
})

describe('hoursOf', () => {
  it('is null while open — an invented departure is a fabricated completion', () => {
    const record: AttendanceRecord = { volunteerId: 'beth', arrivedAt: 0, departedAt: null }
    expect(hoursOf(record)).toBeNull()
  })

  it('is the exact duration, never rounded', () => {
    const oneHour = 60 * 60 * 1000
    const record: AttendanceRecord = {
      volunteerId: 'beth',
      arrivedAt: 0,
      departedAt: oneHour * 2.5,
    }
    expect(hoursOf(record)).toBe(2.5)
  })
})

describe('rosteredAbsent — the fourth roster fact', () => {
  it('names a rostered, standing volunteer with no arrival', () => {
    const roster = [{ volunteerId: 'beth', endedAs: null }]
    expect(rosteredAbsent(roster, [])).toEqual(['beth'])
  })

  it('says nothing about a volunteer who arrived', () => {
    const roster = [{ volunteerId: 'beth', endedAs: null }]
    expect(rosteredAbsent(roster, [{ volunteerId: 'beth' }])).toEqual([])
  })

  it('says nothing about a volunteer who dropped — that is a different fact entirely', () => {
    const roster = [{ volunteerId: 'beth', endedAs: 'dropped' as const }]
    expect(rosteredAbsent(roster, [])).toEqual([])
  })

  it('says nothing about a volunteer removed by roster', () => {
    const roster = [{ volunteerId: 'beth', endedAs: 'removed' as const }]
    expect(rosteredAbsent(roster, [])).toEqual([])
  })
})

describe('isSchoolEligible', () => {
  it.each([
    ['shift', true],
    ['maintenance', true],
    ['event', true],
    ['other', true],
    ['fundraising', false],
    ['administrative', false],
  ] as const)('%s is %s', (category, eligible) => {
    expect(isSchoolEligible(category)).toBe(eligible)
  })
})

function row(extra: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: extra.id ?? 'row',
    volunteerName: extra.volunteerName ?? 'Beth Ann',
    day: extra.day ?? DAY,
    hours: extra.hours === undefined ? 3 : extra.hours,
    description: extra.description ?? 'Mowed the north field',
    supervisorName: extra.supervisorName ?? null,
  }
}

describe('calvertReport — one row per visit', () => {
  it('carries hours, description and supervisor through unchanged', () => {
    const rows = calvertReport([row({ id: 'a', hours: 4, supervisorName: 'Grace' })])
    expect(rows).toEqual([
      {
        id: 'a',
        volunteerName: 'Beth Ann',
        day: DAY,
        hours: 4,
        description: 'Mowed the north field',
        supervisorName: 'Grace',
        overCap: false,
      },
    ])
  })

  it('leaves an open visit off the report — nothing to sign for yet', () => {
    expect(calvertReport([row({ hours: null })])).toEqual([])
  })

  it('flags every row on a day where the same volunteer’s hours sum past eight, without truncating any of them', () => {
    const rows = calvertReport([
      row({ id: 'a', hours: 5 }),
      row({ id: 'b', hours: 4 }),
      row({ id: 'c', volunteerName: 'Valerie', hours: 5 }),
    ])
    expect(
      rows.find((r) => r.description === 'Mowed the north field' && r.hours === 5)?.overCap,
    ).toBe(true)
    expect(rows.filter((r) => r.volunteerName === 'Beth Ann').every((r) => r.overCap)).toBe(true)
    expect(rows.find((r) => r.volunteerName === 'Valerie')?.overCap).toBe(false)
  })
})

describe('anneArundelReport — totals composed up from the same rows', () => {
  it('sums hours and counts visits per volunteer', () => {
    const totals = anneArundelReport([
      row({ id: 'a', hours: 3 }),
      row({ id: 'b', hours: 2, day: '2026-08-19' as DayString }),
      row({ id: 'c', volunteerName: 'Valerie', hours: 6 }),
    ])
    expect(totals).toEqual([
      { volunteerName: 'Beth Ann', totalHours: 5, visits: 2, days: [DAY, '2026-08-19'] },
      { volunteerName: 'Valerie', totalHours: 6, visits: 1, days: [DAY] },
    ])
  })

  it('leaves an open visit out of the total, the same as Calvert’s rows', () => {
    const totals = anneArundelReport([row({ hours: null })])
    expect(totals).toEqual([])
  })
})

describe('isAttestationRelationship', () => {
  it('accepts the four declared relationships and refuses everything else', () => {
    for (const relationship of ATTESTATION_RELATIONSHIPS) {
      expect(isAttestationRelationship(relationship)).toBe(true)
    }
    expect(isAttestationRelationship('sibling')).toBe(false)
    expect(isAttestationRelationship('')).toBe(false)
  })
})

describe('mayAttest', () => {
  const cases: readonly [AttestationRelationship, boolean][] = [
    ['none', true],
    ['parent', false],
    ['guardian', false],
    ['relative', false],
  ]

  it.each(cases)('%s may attest: %s', (relationship, expected) => {
    expect(mayAttest(relationship)).toBe(expected)
  })
})
