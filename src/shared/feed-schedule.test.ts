import { describe, expect, it } from 'vitest'

import { dayString } from './time'
import { isNewVersion, shiftTypeIncludesMedication } from './feed-schedule'

describe('the New marker on a Feed Schedule version', () => {
  it('is new the day it is published', () => {
    expect(isNewVersion(dayString('2024-03-01'), dayString('2024-03-01'))).toBe(true)
  })

  it('is still new at exactly 14 days', () => {
    expect(isNewVersion(dayString('2024-03-01'), dayString('2024-03-15'))).toBe(true)
  })

  it('ages out on its own past 14 days', () => {
    expect(isNewVersion(dayString('2024-03-01'), dayString('2024-03-16'))).toBe(false)
  })

  it('is never new for a version whose valid-from has not arrived yet', () => {
    // A version published to take effect in the future is not "recently
    // changed" until the day it actually takes hold.
    expect(isNewVersion(dayString('2024-03-10'), dayString('2024-03-01'))).toBe(false)
  })
})

describe('whether a Shift Type includes medication', () => {
  it('is false with no lines at all', () => {
    expect(shiftTypeIncludesMedication([])).toBe(false)
  })

  it('is false when every line is feed or supplement', () => {
    expect(
      shiftTypeIncludesMedication([{ productKind: 'feed' }, { productKind: 'supplement' }]),
    ).toBe(false)
  })

  it('is true when any line names a medication', () => {
    expect(
      shiftTypeIncludesMedication([{ productKind: 'feed' }, { productKind: 'medication' }]),
    ).toBe(true)
  })
})
