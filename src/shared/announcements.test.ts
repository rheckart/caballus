/**
 * Whether an Announcement is still posted, table-driven over the boundary
 * that matters: the expiry day itself (ADR 0018).
 */
import { describe, expect, it } from 'vitest'

import { isPosted, unexpiredAnnouncements } from './announcements'
import { dayString } from './time'

describe('isPosted', () => {
  const cases: readonly [string, string, string, boolean][] = [
    ['the day before it expires', '2026-08-17', '2026-08-18', true],
    ['the whole of its expiry day', '2026-08-18', '2026-08-18', true],
    ['the day after it expires', '2026-08-19', '2026-08-18', false],
    ['far in the future', '2026-08-18', '2027-01-01', true],
    ['long expired', '2026-08-18', '2020-01-01', false],
  ]

  for (const [label, today, expiresOn, expected] of cases) {
    it(label, () => {
      expect(isPosted({ expiresOn: dayString(expiresOn) }, dayString(today))).toBe(expected)
    })
  }
})

describe('unexpiredAnnouncements', () => {
  it('keeps only what has not expired, in the order it was given them', () => {
    const today = dayString('2026-08-18')
    const current = { id: 'a', expiresOn: dayString('2026-08-20') }
    const expiring = { id: 'b', expiresOn: dayString('2026-08-18') }
    const gone = { id: 'c', expiresOn: dayString('2026-08-17') }

    expect(unexpiredAnnouncements([current, expiring, gone], today)).toEqual([current, expiring])
  })

  it('answers empty rather than dropping the caller into a null check', () => {
    expect(unexpiredAnnouncements([], dayString('2026-08-18'))).toEqual([])
  })
})
