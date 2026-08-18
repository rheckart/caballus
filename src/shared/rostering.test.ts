/**
 * The gates, table-driven, because the cases that matter here are the ones a
 * Coordinator meets on a bad morning rather than the ones that are easy to
 * think of: a signature that was fine yesterday and is not today, a Consent
 * that is kept and no longer counts, a birthday that does not exist.
 */
import { describe, expect, it } from 'vitest'

import {
  ageOn,
  birthdayOf,
  eighteenthBirthday,
  rosterability,
  type ReleaseSignature,
  type VolunteerGates,
} from './rostering'
import { dayString, type DayString } from './time'

const TODAY = dayString('2026-08-17')

function day(value: string): DayString {
  return dayString(value)
}

/** Everything present and current — the state the other cases break one of. */
function oriented(overrides: Partial<VolunteerGates> = {}): VolunteerGates {
  return {
    orientedOn: day('2024-03-01'),
    dateOfBirth: day('1980-06-12'),
    signatures: [signature()],
    obsoletingVersionsFrom: [],
    consentedOn: null,
    ...overrides,
  }
}

function signature(overrides: Partial<ReleaseSignature> = {}): ReleaseSignature {
  return {
    signedOn: day('2024-03-01'),
    versionValidFrom: day('2020-01-01'),
    byParent: false,
    revoked: false,
    ...overrides,
  }
}

describe('rosterability', () => {
  it('opens every gate for an oriented adult with a current release', () => {
    const derived = rosterability(oriented(), TODAY)

    expect(derived.rosterable).toBe(true)
    expect(derived.gaps).toEqual([])
    expect(derived.isMinor).toBe(false)
  })

  it('blocks a Candidate, who is a Volunteer without an Orientation', () => {
    const derived = rosterability(oriented({ orientedOn: null }), TODAY)

    expect(derived.rosterable).toBe(false)
    expect(derived.gaps).toEqual(['no_orientation'])
  })

  it('blocks a Volunteer with no release at all', () => {
    const derived = rosterability(oriented({ signatures: [] }), TODAY)

    expect(derived.gaps).toEqual(['no_current_release'])
  })

  it('blocks a Volunteer whose release was revoked in writing', () => {
    const derived = rosterability(oriented({ signatures: [signature({ revoked: true })] }), TODAY)

    expect(derived.gaps).toEqual(['no_current_release'])
  })

  it('names every open gate rather than the first', () => {
    const derived = rosterability(
      {
        orientedOn: null,
        dateOfBirth: day('2012-01-04'),
        signatures: [],
        obsoletingVersionsFrom: [],
        consentedOn: null,
      },
      TODAY,
    )

    expect(derived.gaps).toEqual(['no_orientation', 'no_current_release', 'no_consent'])
  })
})

describe('a Release Version published to obsolete what came before', () => {
  it('stales a signature given before it became valid', () => {
    const derived = rosterability(oriented({ obsoletingVersionsFrom: [day('2026-01-01')] }), TODAY)

    expect(derived.gaps).toEqual(['no_current_release'])
  })

  it('leaves a signature against the obsoleting Version itself standing', () => {
    const derived = rosterability(
      oriented({
        signatures: [signature({ versionValidFrom: day('2026-01-01') })],
        obsoletingVersionsFrom: [day('2026-01-01')],
      }),
      TODAY,
    )

    expect(derived.rosterable).toBe(true)
  })

  it('is answered by the newest signature, not by the oldest', () => {
    const derived = rosterability(
      oriented({
        signatures: [
          signature({ versionValidFrom: day('2020-01-01') }),
          signature({ versionValidFrom: day('2026-01-01') }),
        ],
        obsoletingVersionsFrom: [day('2026-01-01')],
      }),
      TODAY,
    )

    expect(derived.rosterable).toBe(true)
  })

  it('stales the old text even when the paper is recorded after the re-papering', () => {
    // The Coordinator works a paper backlog. A signature against the 2020 text
    // recorded the week after counsel replaced it is still the 2020 text, and
    // reading staleness off `signedOn` would have called it current.
    const derived = rosterability(
      oriented({
        signatures: [
          signature({ signedOn: day('2026-06-01'), versionValidFrom: day('2020-01-01') }),
        ],
        obsoletingVersionsFrom: [day('2026-01-01')],
      }),
      TODAY,
    )

    expect(derived.gaps).toEqual(['no_current_release'])
  })

  it('does not stale anything when the version was published without the flag', () => {
    // The flag is what makes the rest of the time livable: a typo fix publishes
    // without sweeping sixty people back through a signature.
    const derived = rosterability(oriented({ obsoletingVersionsFrom: [] }), TODAY)

    expect(derived.rosterable).toBe(true)
  })
})

describe('an eighteenth birthday', () => {
  const minor: VolunteerGates = {
    orientedOn: day('2025-04-01'),
    // Eighteen on 2026-09-01, a fortnight after TODAY.
    dateOfBirth: day('2008-09-01'),
    signatures: [signature({ signedOn: day('2025-04-01'), byParent: true })],
    obsoletingVersionsFrom: [],
    consentedOn: day('2025-04-01'),
  }

  it('leaves a minor with a parent signature and a Consent rosterable', () => {
    const derived = rosterability(minor, TODAY)

    expect(derived.rosterable).toBe(true)
    expect(derived.isMinor).toBe(true)
    expect(derived.consentIsHistorical).toBe(false)
    expect(derived.turnsEighteenOn).toBe('2026-09-01')
  })

  it('blocks a minor with no Consent', () => {
    const derived = rosterability({ ...minor, consentedOn: null }, TODAY)

    expect(derived.gaps).toEqual(['no_consent'])
  })

  it("obsoletes the parent's signature on the day itself, with nothing having run", () => {
    const derived = rosterability(minor, day('2026-09-01'))

    expect(derived.isMinor).toBe(false)
    expect(derived.gaps).toEqual(['no_current_release'])
  })

  it('retires the Consent rather than deleting it', () => {
    const derived = rosterability(minor, day('2026-09-01'))

    expect(derived.consentIsHistorical).toBe(true)
  })

  it("refuses a minor's own signature, because a parent's is the one that waives", () => {
    // Maryland enforces parental pre-injury waivers (*BJ's*); a fifteen-year-old
    // signing in her own name waives a claim she cannot waive.
    const derived = rosterability(
      { ...minor, signatures: [signature({ signedOn: day('2025-04-01'), byParent: false })] },
      TODAY,
    )

    expect(derived.gaps).toEqual(['no_current_release'])
  })

  it("leaves an adult's own signature alone", () => {
    const derived = rosterability(
      { ...minor, signatures: [signature({ signedOn: day('2026-09-02'), byParent: false })] },
      day('2026-09-02'),
    )

    expect(derived.rosterable).toBe(true)
  })

  it('never gates on a date of birth nobody has established', () => {
    // Unknowable is not the same as adult, and this is the one place that
    // matters: the Orientation tick cannot happen without the date, so a
    // Volunteer with no date is already blocked by the first gate.
    const derived = rosterability(
      {
        orientedOn: null,
        dateOfBirth: null,
        signatures: [signature()],
        obsoletingVersionsFrom: [],
        consentedOn: null,
      },
      TODAY,
    )

    expect(derived.isMinor).toBe(false)
    expect(derived.turnsEighteenOn).toBeNull()
    expect(derived.gaps).toEqual(['no_orientation'])
  })
})

describe('eighteenthBirthday', () => {
  it.each([
    ['2008-09-01', '2026-09-01'],
    ['2000-01-31', '2018-01-31'],
    ['2004-02-29', '2022-03-01'],
    // 2026 has a 29th of February... it does not, and 2008 + 18 is 2026.
    ['2008-02-29', '2026-03-01'],
    // 1984 + 18 is 2002, which is not a leap year either; 1996 + 18 is 2014.
    ['1996-02-29', '2014-03-01'],
    // A leap year eighteen years on keeps the date it was born on.
    ['1988-02-29', '2006-03-01'],
    ['2002-02-29', '2020-02-29'],
  ])('turns %s into %s', (born, eighteen) => {
    expect(eighteenthBirthday(day(born))).toBe(eighteen)
  })
})

describe('what the floor sees and what roster sees', () => {
  it('reads a birthday as a day and a month, with no year in it', () => {
    expect(birthdayOf(day('1980-06-12'))).toEqual({ month: 6, day: 12 })
  })

  it.each([
    ['1980-06-12', '2026-08-17', 46],
    ['1980-08-17', '2026-08-17', 46],
    ['1980-08-18', '2026-08-17', 45],
    ['1980-12-31', '2026-01-01', 45],
  ])('ages %s on %s to %i', (born, on, years) => {
    expect(ageOn(day(born), day(on))).toBe(years)
  })
})
