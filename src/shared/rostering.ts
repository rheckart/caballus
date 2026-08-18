/**
 * The three rostering gates, derived rather than stored.
 *
 * ADR 0011 gave the first — an Orientation — and ADR 0017 the other two, a
 * current Release and, for a minor, a Consent. All three are **hard blocks with
 * no override**, and this module is the one place that decides whether they
 * hold: a pure function of the facts on a Volunteer and the day you are asking
 * about, touching no I/O so that the whiteboard's own awkward cases can be a
 * table of inputs rather than a fixture in a database.
 *
 * Two of the three go stale, and **both staleness rules are read-time
 * derivations and never a scheduled job** (ADR 0017). An eighteenth birthday
 * arrives on a morning nobody deployed on, and a job that had not run yet would
 * mean the app rostering a nineteen-year-old on her mother's signature. Asking
 * the question at the moment somebody needs the answer cannot be late.
 *
 * It is `shared` rather than server-side because the admin screen shows the
 * same words the check uses — a screen that computed *rosterable* its own way
 * would be a second answer to the question this module exists to have one
 * answer to.
 */
import { type DayString } from './time'

/**
 * Which gate is open, in a fixed order so that a list of them reads the same
 * way twice.
 *
 * Shared with the API contract rather than restated there, for the reason
 * `DOMAIN_SCOPES` is: the phone is told which gate failed, and two spellings of
 * that vocabulary is the drift ADR 0021 exists to remove.
 */
export const ROSTER_GAPS = ['no_orientation', 'no_current_release', 'no_consent'] as const

export type RosterGap = (typeof ROSTER_GAPS)[number]

/**
 * One signature against one Release Version, as this module needs to see it.
 *
 * `byParent` is the Parent/Guardian block on the paper — enforceable in
 * Maryland under *BJ's Wholesale Club v. Rosen* and the reason a minor's
 * release is a different artifact from an adult's, rather than the same one
 * with an extra line.
 */
export interface ReleaseSignature {
  readonly signedOn: DayString
  /**
   * The valid-from of the Release Version this signature cites — **which text
   * she actually signed**, and what staleness is decided from.
   *
   * Not `signedOn`. ADR 0017 says a Version obsoletes "prior signatures", and
   * the date one was given is the tempting reading of that; it is the wrong
   * one. The Coordinator works a paper backlog, so a signature against the 2020
   * text can be *recorded* the week after the rescue re-papers — and dated by
   * `signedOn` it would look current while the paper in the cabinet is the text
   * counsel just replaced. The Version is the thing that answers *which text
   * did she sign*, which is the question the whole entity exists for.
   */
  readonly versionValidFrom: DayString
  /** Signed by a parent or guardian, which is what an eighteenth birthday ends. */
  readonly byParent: boolean
  /** Expressly revoked in writing. One field, and that is the whole feature. */
  readonly revoked: boolean
}

/** What the gates are decided from. Everything here is a stored fact. */
export interface VolunteerGates {
  /** Never lapses and is never revoked; leaving the rescue is that act. */
  readonly orientedOn: DayString | null
  /**
   * Unknown until the desk sights the ID. It cannot be unknown *and* oriented —
   * recording it is a precondition of the Orientation tick (ADR 0017) — which
   * is what lets `isMinor` read an absent date as *not established* without
   * that ever deciding a gate: no date means no Orientation, and no Orientation
   * already blocks.
   */
  readonly dateOfBirth: DayString | null
  /** Every signature this Volunteer has given, in any order. */
  readonly signatures: readonly ReleaseSignature[]
  /**
   * The valid-from days of every Release Version published with the
   * obsoletes-prior flag. A signature citing an *earlier* Version is stale.
   *
   * Every one of them, not only the newest: a Version published today staling
   * everything before it does not un-stale what an earlier obsoleting Version
   * already staled, and taking the maximum would be right today and wrong the
   * first time somebody backdates a valid-from.
   */
  readonly obsoletingVersionsFrom: readonly DayString[]
  /** A parent's permission for a minor, kept forever because it was true. */
  readonly consentedOn: DayString | null
}

export interface Rosterability {
  /** All three gates hold. There is no override, so nothing else can make this true. */
  readonly rosterable: boolean
  /** Which gates are open, in `ROSTER_GAPS` order. Empty when rosterable. */
  readonly gaps: readonly RosterGap[]
  /** Under 18 on the day asked about. Shown as a state, never as a number. */
  readonly isMinor: boolean
  /** The day the Consent retires and a parent's signature obsoletes, if known. */
  readonly turnsEighteenOn: DayString | null
  /**
   * A Consent that is kept and no longer gates anything, which is what an
   * eighteenth birthday does to it. Distinct from having none: *she never
   * needed one* and *she has one and it is spent* are different facts, and the
   * Coordinator's list should not read them as the same.
   */
  readonly consentIsHistorical: boolean
}

/**
 * Whether this Volunteer may be put on a roster on `on`.
 *
 * `on` is a day in the organisation's timezone, resolved by the caller — a
 * gate that derived its own *today* would derive it in whatever timezone the
 * machine asking happened to be in (ADR 0007).
 */
export function rosterability(gates: VolunteerGates, on: DayString): Rosterability {
  const turnsEighteenOn = gates.dateOfBirth === null ? null : eighteenthBirthday(gates.dateOfBirth)
  const isMinor = turnsEighteenOn !== null && on < turnsEighteenOn

  const gaps: RosterGap[] = []
  if (gates.orientedOn === null) gaps.push('no_orientation')
  if (!hasCurrentRelease(gates, isMinor)) gaps.push('no_current_release')
  if (isMinor && gates.consentedOn === null) gaps.push('no_consent')

  return {
    rosterable: gaps.length === 0,
    gaps,
    isMinor,
    turnsEighteenOn,
    consentIsHistorical: gates.consentedOn !== null && !isMinor,
  }
}

/**
 * Whether any signature still stands.
 *
 * Three ways one stops standing, and ADR 0017 is deliberate that they are one
 * mechanism rather than three: a revocation, a Version published to obsolete
 * what came before, and an eighteenth birthday reusing that same flag rather
 * than inventing a second staleness rule.
 */
function hasCurrentRelease(gates: VolunteerGates, isMinor: boolean): boolean {
  return gates.signatures.some((signature) => {
    if (signature.revoked) return false

    // **A minor's release is the parent's signature or it is nothing.** ADR
    // 0017: the release is the participant's own waiver, "and for a minor it is
    // additionally signed by the parent under *BJ's*" — which is the whole
    // reason Maryland's minority rule matters here. A fifteen-year-old's own
    // signature waives a claim she cannot waive, so it must not open the gate.
    if (isMinor !== signature.byParent) return false

    // Strictly before, so that a signature against the Version published *as*
    // the obsoleting one is not staled by it. Read off the Version rather than
    // off `signedOn`, for the reason on `versionValidFrom` above.
    return !gates.obsoletingVersionsFrom.some((validFrom) => signature.versionValidFrom < validFrom)
  })
}

/**
 * The day somebody born on `dateOfBirth` turns eighteen.
 *
 * Pure string arithmetic on a `YYYY-MM-DD`, which is enough because both ends
 * are already days in the organisation's timezone — and because ADR 0016 bans
 * `Date` outside the two time modules, where it is banned precisely so that a
 * calculation like this cannot silently acquire the host's clock.
 *
 * A 29 February birth turns eighteen on 1 March in a year that has no 29th.
 * The alternative — 28 February — would have the app treat somebody as an
 * adult a day before they are one, and the direction that errs is the one that
 * keeps a gate closed for a day longer.
 */
export function eighteenthBirthday(dateOfBirth: DayString): DayString {
  const [year, month, day] = dateOfBirth.split('-')
  const eighteen = Number(year) + 18

  if (month === '02' && day === '29' && !isLeapYear(eighteen)) {
    return `${String(eighteen)}-03-01` as DayString
  }
  return `${String(eighteen)}-${month ?? ''}-${day ?? ''}` as DayString
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * The day and the month, which is what a birthday is (ADR 0017).
 *
 * The year is the whole of the sensitive part and the whole of the gate input,
 * so it sits behind `roster` with contact details while this sits on the floor
 * — the rescue has a party, and sixty people already know when.
 */
export interface Birthday {
  readonly month: number
  readonly day: number
}

export function birthdayOf(dateOfBirth: DayString): Birthday {
  const [, month, day] = dateOfBirth.split('-')
  return { month: Number(month), day: Number(day) }
}

/**
 * Whole years old on `on`, for the `roster` holders who may see it.
 *
 * Derived rather than stored for ADR 0003's reason: an age is a fact about
 * today and a stored one is wrong within a year of being written down.
 */
export function ageOn(dateOfBirth: DayString, on: DayString): number {
  const [birthYear, birthMonth, birthDay] = dateOfBirth.split('-')
  const [year, month, day] = on.split('-')
  const years = Number(year) - Number(birthYear)
  const beforeBirthday = `${month ?? ''}-${day ?? ''}` < `${birthMonth ?? ''}-${birthDay ?? ''}`
  return beforeBirthday ? years - 1 : years
}
