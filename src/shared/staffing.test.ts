/**
 * The gap derivation and the Acting Lead suggestion, table-driven over roster
 * shapes — which is what #40 asks of this seam, and it is the right shape for
 * it: every case here is a roster somebody actually ends up with on a bad
 * Thursday, and the interesting ones are the near-misses. A Shift with three
 * people on it and one of them dropped. A Shift with a Lead who dropped and two
 * volunteers still standing. A Shift that needs medication and has three people
 * on it, none of whom may give it.
 *
 * **Short appears nowhere in this file**, and that is the point of ADR 0011's
 * sharpest distinction: a Staffing Gap is arithmetic and Short is a person's
 * judgement, so nothing here can produce one or take one away.
 */
import { describe, expect, it } from 'vitest'

import {
  isUrgentGap,
  staffingGaps,
  standing,
  suggestedActingLead,
  type StaffingMember,
  type StaffingSubject,
} from './staffing'
import { dayString } from './time'

function member(overrides: Partial<StaffingMember> = {}): StaffingMember {
  return {
    volunteerId: 'v-beth',
    position: 'volunteer',
    endedAs: null,
    medicationAuthority: false,
    since: dayString('2024-03-01'),
    ...overrides,
  }
}

/** A Feed Shift wanting three, whose feeding includes nothing to medicate. */
function shift(overrides: Partial<StaffingSubject> = {}): StaffingSubject {
  return { targetHeadcount: 3, needsMedication: false, roster: [], ...overrides }
}

describe('staffingGaps', () => {
  it('answers Unstaffed alone, and never the other three beside it', () => {
    expect(staffingGaps(shift({ needsMedication: true }))).toEqual(['unstaffed'])
  })

  it('reads a Shift everybody dropped as Unstaffed, not as a Shift with people on it', () => {
    const abandoned = shift({
      roster: [
        member({ volunteerId: 'v-beth', position: 'lead', endedAs: 'dropped' }),
        member({ volunteerId: 'v-valerie', endedAs: 'removed' }),
      ],
    })

    expect(staffingGaps(abandoned)).toEqual(['unstaffed'])
  })

  it('finds nothing missing on a full Shift with a Lead', () => {
    const full = shift({
      roster: [
        member({ volunteerId: 'v-beth', position: 'lead' }),
        member({ volunteerId: 'v-valerie' }),
        member({ volunteerId: 'v-nora' }),
      ],
    })

    expect(staffingGaps(full)).toEqual([])
  })

  it('counts a dropped row for nothing, which is what puts a full Shift below target', () => {
    const dropped = shift({
      roster: [
        member({ volunteerId: 'v-beth', position: 'lead' }),
        member({ volunteerId: 'v-valerie' }),
        member({ volunteerId: 'v-nora', endedAs: 'dropped' }),
      ],
    })

    expect(staffingGaps(dropped)).toEqual(['below_target_headcount'])
  })

  it('reads a Co-Lead as leadership, because no check distinguishes the two', () => {
    const coLed = shift({
      targetHeadcount: 1,
      roster: [member({ volunteerId: 'v-valerie', position: 'co_lead' })],
    })

    expect(staffingGaps(coLed)).toEqual([])
  })

  it('reads an Acting Lead as leadership, because the claim carries the full set', () => {
    const claimed = shift({
      targetHeadcount: 1,
      roster: [member({ volunteerId: 'v-nora', position: 'acting_lead' })],
    })

    expect(staffingGaps(claimed)).toEqual([])
  })

  it('says no Lead when the Lead dropped and the volunteers stayed', () => {
    const leaderless = shift({
      targetHeadcount: 2,
      roster: [
        member({ volunteerId: 'v-beth', position: 'lead', endedAs: 'dropped' }),
        member({ volunteerId: 'v-valerie' }),
        member({ volunteerId: 'v-nora' }),
      ],
    })

    expect(staffingGaps(leaderless)).toEqual(['no_lead'])
  })

  it('says nobody can medicate only where the feeding needs it', () => {
    const roster = [
      member({ volunteerId: 'v-beth', position: 'lead' }),
      member({ volunteerId: 'v-valerie' }),
      member({ volunteerId: 'v-nora' }),
    ]

    expect(staffingGaps(shift({ needsMedication: true, roster }))).toEqual([
      'no_medication_authority',
    ])
    expect(staffingGaps(shift({ needsMedication: false, roster }))).toEqual([])
  })

  it('takes the qualification from anybody standing, not from the Lead', () => {
    const covered = shift({
      needsMedication: true,
      roster: [
        member({ volunteerId: 'v-beth', position: 'lead' }),
        member({ volunteerId: 'v-valerie', medicationAuthority: true }),
        member({ volunteerId: 'v-nora' }),
      ],
    })

    expect(staffingGaps(covered)).toEqual([])
  })

  it('does not take it from somebody who dropped', () => {
    const gone = shift({
      needsMedication: true,
      roster: [
        member({ volunteerId: 'v-beth', position: 'lead' }),
        member({ volunteerId: 'v-valerie', medicationAuthority: true, endedAs: 'dropped' }),
        member({ volunteerId: 'v-nora' }),
      ],
    })

    expect(gone.roster).toHaveLength(3)
    expect(standing(gone.roster)).toHaveLength(2)
    expect(staffingGaps(gone)).toEqual(['below_target_headcount', 'no_medication_authority'])
  })

  it('answers three at once for a Shift down to one un-led volunteer', () => {
    const thin = shift({
      needsMedication: true,
      roster: [member({ volunteerId: 'v-nora' })],
    })

    expect(staffingGaps(thin)).toEqual([
      'no_lead',
      'below_target_headcount',
      'no_medication_authority',
    ])
  })

  it('never says below target for a Shift over it', () => {
    const over = shift({
      targetHeadcount: 2,
      roster: [
        member({ volunteerId: 'v-beth', position: 'lead' }),
        member({ volunteerId: 'v-valerie' }),
        member({ volunteerId: 'v-nora', position: 'volunteer' }),
      ],
    })

    expect(staffingGaps(over)).toEqual([])
  })
})

describe('suggestedActingLead', () => {
  it('suggests nobody where somebody already holds Shift Authority', () => {
    const led = shift({
      roster: [
        member({ volunteerId: 'v-beth', position: 'co_lead' }),
        member({ volunteerId: 'v-valerie', medicationAuthority: true }),
      ],
    })

    expect(suggestedActingLead(led)).toBeNull()
  })

  it('suggests nobody on an empty Shift, because there is nobody to claim it', () => {
    expect(suggestedActingLead(shift())).toBeNull()
  })

  it('suggests Medication Authority ahead of longer tenure', () => {
    const leaderless = shift({
      roster: [
        member({ volunteerId: 'v-beth', since: dayString('2015-01-01') }),
        member({
          volunteerId: 'v-valerie',
          since: dayString('2025-06-01'),
          medicationAuthority: true,
        }),
      ],
    })

    expect(suggestedActingLead(leaderless)).toBe('v-valerie')
  })

  it('breaks a tie on tenure, oldest first', () => {
    const leaderless = shift({
      roster: [
        member({ volunteerId: 'v-nora', since: dayString('2025-06-01') }),
        member({ volunteerId: 'v-beth', since: dayString('2015-01-01') }),
      ],
    })

    expect(suggestedActingLead(leaderless)).toBe('v-beth')
  })

  it('sorts an unknown joining date last rather than treating it as long service', () => {
    const leaderless = shift({
      roster: [
        member({ volunteerId: 'v-anon', since: null }),
        member({ volunteerId: 'v-nora', since: dayString('2026-01-01') }),
      ],
    })

    expect(suggestedActingLead(leaderless)).toBe('v-nora')
  })

  it('breaks a dead heat on the id, so the same roster suggests the same name twice', () => {
    const roster = [
      member({ volunteerId: 'v-nora', since: dayString('2024-03-01') }),
      member({ volunteerId: 'v-beth', since: dayString('2024-03-01') }),
    ]

    expect(suggestedActingLead(shift({ roster }))).toBe('v-beth')
    expect(suggestedActingLead(shift({ roster: [...roster].reverse() }))).toBe('v-beth')
  })

  it('passes over somebody who dropped', () => {
    const leaderless = shift({
      roster: [
        member({
          volunteerId: 'v-valerie',
          medicationAuthority: true,
          endedAs: 'dropped',
          since: dayString('2015-01-01'),
        }),
        member({ volunteerId: 'v-nora', since: dayString('2026-01-01') }),
      ],
    })

    expect(suggestedActingLead(leaderless)).toBe('v-nora')
  })
})

describe('isUrgentGap', () => {
  it('leads with the two ADR 0011 puts first', () => {
    expect(isUrgentGap('unstaffed')).toBe(true)
    expect(isUrgentGap('no_lead')).toBe(true)
    expect(isUrgentGap('below_target_headcount')).toBe(false)
    expect(isUrgentGap('no_medication_authority')).toBe(false)
  })
})
