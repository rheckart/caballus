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
    const sent = shortText(
      { shiftType: 'Feed PM', day: '2026-08-29', startTime: '16:00' },
      'https://caballus.tech',
    )

    expect(sent).toBe(
      'Caballus: Feed PM on 2026-08-29 at 16:00 is short. Cover it: https://caballus.tech/shifts Reply STOP to stop.',
    )
  })

  it("carries an Announcement's own words, unedited", () => {
    // Nothing is said in a text that is not already written somewhere it will
    // still be true tomorrow.
    expect(announcementText('  The hay comes Thursday.  ', 'https://caballus.tech')).toBe(
      'Caballus: The hay comes Thursday. More: https://caballus.tech Reply STOP to stop.',
    )
  })

  it('tells everybody how to stop, on every message', () => {
    expect(
      shortText({ shiftType: 'Feed AM', day: '2026-08-29', startTime: '06:30' }, null),
    ).toContain('Reply STOP to stop.')
    expect(announcementText('Anything', null)).toContain('Reply STOP to stop.')
  })
})

describe('the link a text carries (#83)', () => {
  it('sends a Short to the schedule, which is where Cover lives', () => {
    // Not `/shifts/:shiftId`: the id is a uuid that would half again the
    // message, and the Work Surface is not the screen with the button on it.
    expect(
      shortText(
        { shiftType: 'Feed AM', day: '2026-09-03', startTime: '07:00' },
        'https://caballus.tech',
      ),
    ).toBe(
      'Caballus: Feed AM on 2026-09-03 at 07:00 is short. Cover it: https://caballus.tech/shifts Reply STOP to stop.',
    )
  })

  it('sends an Announcement to home, which is where the wall is', () => {
    expect(announcementText('The farrier comes Thursday morning.', 'https://caballus.tech')).toBe(
      'Caballus: The farrier comes Thursday morning. More: https://caballus.tech Reply STOP to stop.',
    )
  })

  it('names the development origin on a development box, and never production', () => {
    // `APP_URL` is already `http://localhost:3000` there, which is the whole
    // reason the origin is passed in rather than hard-coded.
    expect(
      shortText(
        { shiftType: 'Feed AM', day: '2026-09-03', startTime: '07:00' },
        'http://localhost:3000',
      ),
    ).toContain('http://localhost:3000/shifts')
  })

  it('composes a sensible message with no origin at all, rather than one naming undefined', () => {
    // An unset `APP_URL` is a real case and not an error: what it composes is
    // exactly what it composed before the link existed.
    expect(shortText({ shiftType: 'Feed PM', day: '2026-08-29', startTime: '16:00' }, null)).toBe(
      'Caballus: Feed PM on 2026-08-29 at 16:00 is short. Open the app to cover. Reply STOP to stop.',
    )
    expect(announcementText('The hay comes Thursday.', null)).toBe(
      'Caballus: The hay comes Thursday. Reply STOP to stop.',
    )
  })

  it('treats a blank origin as none, because an empty variable is an unset one', () => {
    expect(shortText({ shiftType: 'Feed PM', day: '2026-08-29', startTime: '16:00' }, '   ')).toBe(
      'Caballus: Feed PM on 2026-08-29 at 16:00 is short. Open the app to cover. Reply STOP to stop.',
    )
  })

  it('never doubles the slash when the origin carries a trailing one', () => {
    expect(announcementText('Anything', 'https://caballus.tech/')).toContain(
      'More: https://caballus.tech ',
    )
    expect(
      shortText(
        { shiftType: 'Feed AM', day: '2026-09-03', startTime: '07:00' },
        'https://caballus.tech/',
      ),
    ).toContain('https://caballus.tech/shifts ')
  })

  it('never reaches for a shortener, because a carrier cannot see through one', () => {
    // bit.ly and its kind are the most reliable way to have a campaign blocked.
    // The brand's own domain is the whole point, so the origin travels whole.
    const sent = announcementText('Anything', 'https://caballus.tech')

    expect(sent).toContain('https://caballus.tech')
    expect(sent).not.toMatch(/bit\.ly|tinyurl|t\.co/)
  })
})
