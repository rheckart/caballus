import { describe, expect, it } from 'vitest'

import {
  OBSERVATION_SUBJECT_KINDS,
  isObservationDisposition,
  isObservationSubjectKind,
  suggestedScope,
  type ObservationSubjectKind,
} from './observations'

describe('suggestedScope', () => {
  const cases: readonly [ObservationSubjectKind | null, string | null][] = [
    ['horse', 'horse_care'],
    ['space', 'maintenance'],
    ['product', 'supplies'],
    // A record that is wrong owns no single Scope this table can name.
    ['record', null],
    // No subject at all: the Lead picks unaided.
    [null, null],
  ]

  it.each(cases)('suggests %s for a %s subject', (subjectKind, expected) => {
    expect(suggestedScope(subjectKind)).toBe(expected)
  })

  it('covers every declared subject kind', () => {
    const covered = cases
      .map(([kind]) => kind)
      .filter((kind): kind is ObservationSubjectKind => kind !== null)
    expect(new Set(covered)).toEqual(new Set(OBSERVATION_SUBJECT_KINDS))
  })
})

describe('isObservationSubjectKind', () => {
  it('accepts the four declared kinds and refuses everything else', () => {
    for (const kind of OBSERVATION_SUBJECT_KINDS) {
      expect(isObservationSubjectKind(kind)).toBe(true)
    }
    expect(isObservationSubjectKind('shift')).toBe(false)
    expect(isObservationSubjectKind('')).toBe(false)
  })
})

describe('isObservationDisposition', () => {
  it('accepts the three declared Dispositions and refuses everything else', () => {
    expect(isObservationDisposition('escalated')).toBe(true)
    expect(isObservationDisposition('noted_no_action')).toBe(true)
    // A Shift's own third exit — curated into Shift Notes (#45).
    expect(isObservationDisposition('curated_into_shift_notes')).toBe(true)
    expect(isObservationDisposition('acknowledged')).toBe(false)
    expect(isObservationDisposition('')).toBe(false)
  })
})
