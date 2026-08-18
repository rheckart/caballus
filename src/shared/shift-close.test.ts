import { describe, expect, it } from 'vitest'

import { closeBlockers, mayClose, type CloseBlockerCounts } from './shift-close'

const clear: CloseBlockerCounts = {
  unsentCount: 0,
  openAttendanceCount: 0,
  undispositionedObservationCount: 0,
}

describe('closeBlockers', () => {
  it('lists nothing when every count is zero', () => {
    expect(closeBlockers(clear)).toEqual([])
  })

  it('names each nonzero count, in the order the close screen states them', () => {
    expect(
      closeBlockers({ unsentCount: 2, openAttendanceCount: 1, undispositionedObservationCount: 3 }),
    ).toEqual([
      { kind: 'unsent_work', count: 2 },
      { kind: 'open_attendance', count: 1 },
      { kind: 'undispositioned_observation', count: 3 },
    ])
  })

  it('leaves out a blocker whose count is zero', () => {
    expect(closeBlockers({ ...clear, openAttendanceCount: 1 })).toEqual([
      { kind: 'open_attendance', count: 1 },
    ])
  })
})

describe('mayClose', () => {
  it('is true only with no blockers', () => {
    expect(mayClose(clear)).toBe(true)
    expect(mayClose({ ...clear, unsentCount: 1 })).toBe(false)
    expect(mayClose({ ...clear, openAttendanceCount: 1 })).toBe(false)
    expect(mayClose({ ...clear, undispositionedObservationCount: 1 })).toBe(false)
  })
})
