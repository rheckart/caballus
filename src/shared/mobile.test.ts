import { describe, expect, it } from 'vitest'

import { looksLikeMobile, normaliseMobile } from './mobile'

describe('one spelling for a mobile number', () => {
  it('reads the ways the barn actually writes a US number, and stores one', () => {
    // Every one of these is the same handset, and #78 makes this a credential —
    // so all of them have to resolve to the string the next sign-in compares.
    for (const written of [
      '(410) 555-0134',
      '410-555-0134',
      '410.555.0134',
      '410 555 0134',
      '4105550134',
      '1 410 555 0134',
      '+1 (410) 555-0134',
    ]) {
      expect(normaliseMobile(written)).toBe('+14105550134')
    }
  })

  it('takes a number from anywhere else as given, when it carries its own code', () => {
    // The `+1` default is a pin about this rescue, not a claim about numbers.
    expect(normaliseMobile('+44 7700 900123')).toBe('+447700900123')
  })

  it('says null for blank, because blank and absent are one fact', () => {
    expect(normaliseMobile('')).toBeNull()
    expect(normaliseMobile('   ')).toBeNull()
  })

  it('refuses what is not a number rather than storing something unusable', () => {
    for (const nonsense of ['4105', 'ask Kate', '410-555-01345678', '+1']) {
      expect(normaliseMobile(nonsense)).toBeNull()
    }
  })
})

describe('which door somebody meant at the login screen', () => {
  it('reads an address as an address', () => {
    expect(looksLikeMobile('grace@example.invalid')).toBe(false)
  })

  it('reads anything else as a number, including one they got wrong', () => {
    // A number that cannot be read is still *a number they got wrong*: sending
    // it down the email path would say we do not know an address nobody typed.
    expect(looksLikeMobile('4105550134')).toBe(true)
    expect(looksLikeMobile('410555')).toBe(true)
  })
})
