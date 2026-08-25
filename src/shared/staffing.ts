/**
 * What a Shift is missing, and who the app suggests takes charge of it
 * (`CONTEXT.md`'s Staffing Gap and Acting Lead; ADR 0010, ADR 0011).
 *
 * Pure, for the reason `src/shared/rostering.ts` and `src/shared/board.ts` are:
 * the database answers *who is on this Shift, what does it want, does its
 * feeding include medication*, and everything past that point is arithmetic a
 * table of inputs exercises directly. It is also the arithmetic the digest and
 * three screens all read, and a second copy of it would be three answers to
 * *does Thursday have a Lead*.
 *
 * **A Staffing Gap is computed; Short is declared, and the two are not the same
 * thing.** Conflating them is the failure ADR 0011 says this domain is most
 * exposed to. Everything in this module is derived and only ever displayed.
 * Short is a person's judgement, lives on the Shift with an actor and a time,
 * and appears nowhere here — arithmetic never declares it and, symmetrically,
 * arithmetic never undeclares it either.
 *
 * **`Staffing Gap` is an internal term and never reaches a screen.** The names
 * cross the wire because the derivation is the server's; what a volunteer reads
 * is the concrete fact — *no Lead*, *nobody who can give medication* — and
 * `staffingFact` below is the one place those sentences are written, so the
 * phone, the desk and the evening digest cannot say different things about
 * Thursday.
 */
import { carriesShiftAuthority, type RosterEndKind, type ShiftPosition } from './shifts'
import type { DayString } from './time'

/**
 * The four gaps ADR 0011 names, **and no others**. A fifth is a decision
 * somebody makes deliberately, not a condition that accretes: the whole value
 * of this list is that a rescue can learn what the app means by it, and a
 * staffing state that cries wolf is ignored exactly the way a channel that
 * carries everything is ignored.
 *
 * In the order they are worth reading, which is the order the digest and the
 * screens present them in.
 */
export const STAFFING_GAPS = [
  'unstaffed',
  'no_lead',
  'below_target_headcount',
  'no_medication_authority',
] as const

export type StaffingGap = (typeof STAFFING_GAPS)[number]

/** One person on a Shift, as far as the derivations below need to see them. */
export interface StaffingMember {
  readonly volunteerId: string
  readonly position: ShiftPosition
  /**
   * Null while the commitment stands. A dropped or removed row counts for
   * nothing here — but it is still a row, because *rostered and dropped* is not
   * *never rostered* (ADR 0011), and this module reads the mark rather than
   * asking the caller to filter first.
   */
  readonly endedAs: RosterEndKind | null
  /**
   * The qualification, which is a grant on the Volunteer and not a position on
   * this Shift (ADR 0010). An acting Lead without it still cannot medicate.
   */
  readonly medicationAuthority: boolean
  /**
   * When they joined the rescue — the Orientation date — for the tie-break
   * below and nothing else. Behind `roster` on a person's record, so it is
   * resolved on the server and never travels; what travels is the suggested id.
   */
  readonly since: DayString | null
}

/** One Shift, as far as the derivations below need to see it. */
export interface StaffingSubject {
  readonly targetHeadcount: number
  /**
   * Whether this Shift's feeding includes a Product given as medication — the
   * condition ADR 0011 puts on the fourth gap, so that *nobody who can give
   * medication* is only ever said about a Shift where somebody has to.
   */
  readonly needsMedication: boolean
  readonly roster: readonly StaffingMember[]
}

/**
 * Everybody still counted on: the mark is what takes a row out (ADR 0011).
 *
 * Generic over the row, because the three surfaces that count a roster hold
 * three different shapes of it — the derivation's own, the schedule read's, and
 * the wire's — and all three mean *the rows that have not ended*.
 */
export function standing<T extends { readonly endedAs: RosterEndKind | null }>(
  roster: readonly T[],
): readonly T[] {
  return roster.filter((member) => member.endedAs === null)
}

/**
 * **The #34 gates are not a fifth gap, and that is deliberate.**
 *
 * A volunteer whose Release lapsed after being assigned is still on the Shift
 * and still counts toward its headcount here. ADR 0011 fixes this list at
 * "four of them, and no others", and ADR 0017 settles what a failing gate does:
 * it **flags** the person, on the roster row, where `rosterable` and `gaps`
 * already ride beside their name — it never removes them and never empties a
 * roster. Making staleness a fifth gap would be the removal wearing a different
 * hat: one re-papering would report every Shift in the rescue as missing
 * something on the same morning, which is the cry-wolf failure this list is
 * shaped against. The gate is shown where somebody can act on it, which is the
 * name it belongs to.
 *
 * What this Shift is missing, in reading order.
 *
 * **Unstaffed is answered alone.** Nobody at all is also no Lead, also below
 * any target, and also nobody who can medicate — and a screen listing four
 * facts about an empty Shift is one fact spelled four times, which is how a
 * list of gaps stops being read. The Shift is still a Shift and still visible:
 * an Unstaffed Shift is never cancelled or removed (ADR 0001), it is the first
 * thing in the digest.
 */
export function staffingGaps(shift: StaffingSubject): readonly StaffingGap[] {
  const present = standing(shift.roster)
  if (present.length === 0) return ['unstaffed']

  const gaps: StaffingGap[] = []
  if (!present.some((member) => carriesShiftAuthority(member.position))) gaps.push('no_lead')
  if (present.length < shift.targetHeadcount) gaps.push('below_target_headcount')
  if (shift.needsMedication && !present.some((member) => member.medicationAuthority)) {
    gaps.push('no_medication_authority')
  }
  return gaps
}

/**
 * Who the app suggests claims Acting Lead: Medication Authority first, tenure
 * breaking ties (ADR 0010).
 *
 * **A suggestion and never a restriction.** Limiting the claim to this person
 * leaves a Shift leaderless exactly when this person did not show, which is the
 * case the claim exists for — so the endpoint takes it from anybody rostered,
 * and this only decides whose name the screen offers first.
 *
 * Null when somebody already carries Shift Authority here, because there is
 * nothing to claim, and null when nobody stands, because there is nobody to
 * claim it. The final tie-break is the id: two volunteers oriented on the same
 * day must not have the app offer a different name on each refresh.
 */
export function suggestedActingLead(shift: StaffingSubject): string | null {
  const present = standing(shift.roster)
  if (present.some((member) => carriesShiftAuthority(member.position))) return null

  const [first] = [...present].sort(byAuthorityThenTenure)
  return first?.volunteerId ?? null
}

function byAuthorityThenTenure(left: StaffingMember, right: StaffingMember): number {
  if (left.medicationAuthority !== right.medicationAuthority) {
    return left.medicationAuthority ? -1 : 1
  }
  // An unknown joining date is not long tenure: it sorts last rather than
  // first, so a missing fact never wins an argument it cannot make.
  if (left.since !== right.since) {
    if (left.since === null) return 1
    if (right.since === null) return -1
    return left.since < right.since ? -1 : 1
  }
  return left.volunteerId < right.volunteerId ? -1 : left.volunteerId > right.volunteerId ? 1 : 0
}

/**
 * The concrete fact, in the words a person reads.
 *
 * One table rather than one per surface, for the reason `src/shared/refusals.ts`
 * is one table: the phone, the desk and the evening digest all have to say the
 * same thing about Thursday, and three copies is three chances for one of them
 * to be the vague one.
 *
 * **None of these sentences is the phrase *staffing gap*.** ADR 0011 keeps that
 * term internal — it never appears on a screen, because *no Lead* and *nobody
 * who can give medication* are what somebody can act on and a category name is
 * not.
 */
export function staffingFact(
  gap: StaffingGap,
  about: { readonly standing: number; readonly targetHeadcount: number },
): string {
  switch (gap) {
    case 'unstaffed':
      return 'nobody at all'
    case 'no_lead':
      return 'no Lead'
    case 'below_target_headcount':
      return `${String(about.standing)} of ${String(about.targetHeadcount)} wanted`
    case 'no_medication_authority':
      return 'nobody who can give medication'
  }
}

/**
 * Every fact about one Shift, in reading order and ready to print.
 *
 * The one place a caller goes, because the phone, the desk and the digest were
 * each counting the standing rows and mapping the gaps themselves — three
 * copies of one derivation, which is precisely what the module doc above says
 * this file exists to prevent. It takes the shape the wire carries, so a screen
 * hands it a Shift and gets sentences.
 */
export function staffingFacts(shift: {
  readonly targetHeadcount: number
  readonly staffing: { readonly gaps: readonly StaffingGap[] }
  readonly roster: readonly { readonly endedAs: RosterEndKind | null }[]
}): readonly string[] {
  const present = standing(shift.roster).length
  return shift.staffing.gaps.map((gap) =>
    staffingFact(gap, { standing: present, targetHeadcount: shift.targetHeadcount }),
  )
}

/**
 * How far out a volunteer is shown what a Shift is missing.
 *
 * ADR 0011: the gaps are computed across the whole horizon **for holders of
 * `roster`**, and are "prominent to everyone else only inside roughly the next
 * 48 hours". A fortnight of *no Lead* on a phone is a wall of red about Shifts
 * nobody can do anything about yet, and a screen that shouts every day is a
 * screen people stop reading — the same argument the four-gap list is shaped
 * by, pointed at distance instead of at count. Beyond the window the Shift is
 * still listed and still coverable; the headcount beside it still says how
 * thin it is.
 *
 * Here rather than in `src/routes/shifts.tsx`, where it started, because #67
 * gave it a second reader: the home screen's *shifts needing cover* is the
 * same prominence decision seen from the dashboard, and two copies of the
 * window is two answers to *is Thursday worth shouting about*.
 */
export const PROMINENT_DAYS = 2

/**
 * Whether a gap is one the evening digest leads with (ADR 0011: "Unstaffed and
 * no-Lead first").
 *
 * Here rather than in the digest because the ordering is a claim about what
 * matters in this domain, and the screens sort by the same rule.
 */
export function isUrgentGap(gap: StaffingGap): boolean {
  return gap === 'unstaffed' || gap === 'no_lead'
}
