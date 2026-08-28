import { describe, expect, it } from 'vitest'

import { announcementText, isReachable, reachSentence, shortText } from './urgent'

function person(overrides: Partial<Parameters<typeof isReachable>[0]> = {}) {
  return {
    mobile: '+14105550134',
    smsConsentAt: 1_770_000_000_000,
    smsStoppedAt: null,
    ...overrides,
  }
}

describe('who an Urgent Send actually reaches', () => {
  it('reaches somebody with a number, consent, and no STOP', () => {
    expect(isReachable(person())).toBe(true)
  })

  it('does not reach somebody with no number', () => {
    expect(isReachable(person({ mobile: null }))).toBe(false)
  })

  it('does not reach somebody who never consented', () => {
    // Carriers require documented opt-in, and the record of it is the gate.
    expect(isReachable(person({ smsConsentAt: null }))).toBe(false)
  })

  it('does not reach somebody who replied STOP, even with consent on file', () => {
    // The carrier refuses the message anyway; counting them reachable makes
    // *this reaches 47 of 60* wrong in the direction that matters.
    expect(isReachable(person({ smsStoppedAt: 1_772_000_000_000 }))).toBe(false)
  })
})

describe('what the sender is shown before confirming', () => {
  it('names the shortfall rather than leaving it to arithmetic', () => {
    expect(reachSentence(47, 60)).toBe('This reaches 47 of 60 — 13 will not get it.')
  })

  it('says so plainly when it reaches everybody', () => {
    expect(reachSentence(60, 60)).toBe('This reaches all 60.')
  })

  it('says so plainly when it reaches nobody', () => {
    expect(reachSentence(0, 60)).toMatch(/reaches nobody/)
  })

  it('says so when there is nobody at all', () => {
    expect(reachSentence(0, 0)).toBe('There is nobody to text.')
  })
})

describe('the two sentences, and there are only two', () => {
  it('asks a short Shift to be covered in the app, never by reply', () => {
    // The reply is the receipt: somebody taps Cover, which is already a record
    // with a name on it (ADR 0028). Nothing asks them to text back.
    const sent = shortText({ shiftType: 'Feed PM', day: '2026-08-29', startTime: '16:00' })

    expect(sent).toBe(
      'Caballus: Feed PM on 2026-08-29 at 16:00 is short. Open the app to cover. Reply STOP to stop.',
    )
  })

  it("carries an Announcement's own words, unedited", () => {
    // Nothing is said in a text that is not already written somewhere it will
    // still be true tomorrow.
    expect(announcementText('  The hay comes Thursday.  ')).toBe(
      'Caballus: The hay comes Thursday. Reply STOP to stop.',
    )
  })

  it('tells everybody how to stop, on every message', () => {
    expect(shortText({ shiftType: 'Feed AM', day: '2026-08-29', startTime: '06:30' })).toContain(
      'Reply STOP to stop.',
    )
    expect(announcementText('Anything')).toContain('Reply STOP to stop.')
  })
})
