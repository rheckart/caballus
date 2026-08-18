/**
 * Attendance, as the domain sees it once the write path has done its work
 * (ADR 0012): the fourth roster fact, hours off the ledger, and the two
 * county renderings of the same rows.
 *
 * Pure, for the reason `src/shared/staffing.ts` and `src/shared/rostering.ts`
 * are: the database answers *who arrived, when, and against what*, and
 * everything past that point is arithmetic a table of inputs exercises
 * directly — which is what lets the phone, the desk and a county's report
 * share one answer instead of three.
 */
import type { RosterEndKind } from './shifts'
import type { DayString } from './time'

/**
 * The coarse category ADR 0012 asks for: two consumers, Grace's Board report
 * and the school-eligible flag, and **the volunteer is never asked which**.
 *
 * `shift` is reserved for a Shift row and set by the server regardless of
 * what a caller sends — a feed shift is not a category anybody chooses
 * (ADR 0012: "a feed-shift sign-in is the case with a Shift and no
 * description").
 */
export const ATTENDANCE_CATEGORIES = [
  'shift',
  'maintenance',
  'event',
  'fundraising',
  'administrative',
  'other',
] as const

export type AttendanceCategory = (typeof ATTENDANCE_CATEGORIES)[number]

/** A Visit's own category — everything but the one a Shift reserves for itself. */
export const VISIT_CATEGORIES = ATTENDANCE_CATEGORIES.filter(
  (category) => category !== 'shift',
) as readonly Exclude<AttendanceCategory, 'shift'>[]

export function isAttendanceCategory(value: string): value is AttendanceCategory {
  return (ATTENDANCE_CATEGORIES as readonly string[]).includes(value)
}

/**
 * Whether Maryland counts this category toward a student's 75 hours
 * (ADR 0012): "work Maryland excludes from service learning — fundraising,
 * collecting donations — never silently inflates a student's total."
 *
 * Derived from the category a person already chose for an unrelated reason,
 * rather than asked of the volunteer directly — the question invites the
 * wrong answer, because a sixteen-year-old cannot know MSDE's rule and
 * volunteering alone is not service learning regardless of the answer given.
 */
const SCHOOL_ELIGIBLE: Record<AttendanceCategory, boolean> = {
  shift: true,
  maintenance: true,
  event: true,
  fundraising: false,
  administrative: false,
  other: true,
}

export function isSchoolEligible(category: AttendanceCategory): boolean {
  return SCHOOL_ELIGIBLE[category]
}

/** One Attendance, as far as the derivations below need to see it. */
export interface AttendanceRecord {
  readonly volunteerId: string
  readonly arrivedAt: number
  readonly departedAt: number | null
}

/** Still open: arrived, and nobody has recorded a departure (ADR 0012). */
export function isOpen(record: AttendanceRecord): boolean {
  return record.departedAt === null
}

/**
 * Hours on the ledger, exact — "durations come from the timestamps, nothing
 * is rounded in storage" (ADR 0012). Null while open: an invented departure
 * is a fabricated completion, so there is no duration to report until a
 * person closes it.
 */
export function hoursOf(record: AttendanceRecord): number | null {
  if (record.departedAt === null) return null
  return (record.departedAt - record.arrivedAt) / (1000 * 60 * 60)
}

/**
 * The fourth roster fact ADR 0012 names: **rostered, absent, no Drop** —
 * distinct from *rostered and dropped* and from *never rostered*, and one the
 * app cannot tell apart from "sorted out between two people on the phone."
 *
 * A **displayed** fact and nothing more: it is not counted, not flagged as a
 * pattern, and never a label the app applies to a person (ADR 0012, on the
 * same restraint ADR 0011 already gave repeated Drops).
 */
export function rosteredAbsent(
  roster: readonly { readonly volunteerId: string; readonly endedAs: RosterEndKind | null }[],
  attendance: readonly { readonly volunteerId: string }[],
): readonly string[] {
  const arrived = new Set(attendance.map((record) => record.volunteerId))
  return roster
    .filter((member) => member.endedAs === null && !arrived.has(member.volunteerId))
    .map((member) => member.volunteerId)
}

/** One row of the ledger, as the report renderings below need to see it. */
export interface LedgerRow {
  readonly id: string
  readonly volunteerName: string
  readonly day: DayString
  /** Null while open — never reported, per `hoursOf`. */
  readonly hours: number | null
  readonly description: string
  readonly supervisorName: string | null
}

/**
 * Calvert wants one row per visit, with a signature line each (ADR 0012).
 *
 * Open rows are left out: a letter reporting hours nobody closed is exactly
 * the fabrication ADR 0012 writes itself against, so an open visit simply has
 * not reached the report yet.
 */
export interface CalvertRow {
  /** The ledger row's own id, carried through so a rendered list has a stable key. */
  readonly id: string
  readonly volunteerName: string
  readonly day: DayString
  readonly hours: number
  readonly description: string
  readonly supervisorName: string | null
  /**
   * Calvert's cap of eight service-learning hours per twenty-four — "flagged
   * on the report, never truncated in the record" (ADR 0012). True when this
   * row's own day, summed across every row for the same volunteer, is over
   * the cap; the record itself is untouched.
   */
  readonly overCap: boolean
}

export function calvertReport(rows: readonly LedgerRow[]): readonly CalvertRow[] {
  const closed = rows.filter((row): row is LedgerRow & { hours: number } => row.hours !== null)

  const byVolunteerDay = new Map<string, number>()
  for (const row of closed) {
    const key = `${row.volunteerName}|${row.day}`
    byVolunteerDay.set(key, (byVolunteerDay.get(key) ?? 0) + row.hours)
  }

  return closed.map((row) => ({
    id: row.id,
    volunteerName: row.volunteerName,
    day: row.day,
    hours: row.hours,
    description: row.description,
    supervisorName: row.supervisorName,
    overCap: (byVolunteerDay.get(`${row.volunteerName}|${row.day}`) ?? 0) > 8,
  }))
}

/**
 * Anne Arundel wants dates and a total, no line items (ADR 0012). Totals are
 * derived from the same rows Calvert renders — "rows compose upward into
 * totals; totals do not decompose into rows" — never a separate tally kept in
 * step by hand.
 */
export interface AnneArundelTotal {
  readonly volunteerName: string
  readonly totalHours: number
  readonly visits: number
  readonly days: readonly DayString[]
}

export function anneArundelReport(rows: readonly LedgerRow[]): readonly AnneArundelTotal[] {
  const totals = new Map<string, { hours: number; visits: number; days: Set<DayString> }>()
  for (const row of rows) {
    if (row.hours === null) continue
    const existing = totals.get(row.volunteerName) ?? { hours: 0, visits: 0, days: new Set() }
    existing.hours += row.hours
    existing.visits += 1
    existing.days.add(row.day)
    totals.set(row.volunteerName, existing)
  }

  return [...totals.entries()]
    .map(([volunteerName, total]) => ({
      volunteerName,
      totalHours: total.hours,
      visits: total.visits,
      days: [...total.days].sort(),
    }))
    .sort((left, right) => (left.volunteerName < right.volunteerName ? -1 : 1))
}

/** The counties this rescue's students come from, and the shape each wants (ADR 0012). */
export const COUNTIES = ['calvert', 'anne_arundel'] as const

export type County = (typeof COUNTIES)[number]

/**
 * The Attestor's relationship to the minor they are attesting for (ADR 0012,
 * #45): "the model separates who was present with a volunteer from who
 * supervised them, stores the relationship, and refuses an attestation by a
 * parent, guardian or relative." `none` is the only relationship an
 * Attestation is ever recorded against.
 */
export const ATTESTATION_RELATIONSHIPS = ['none', 'parent', 'guardian', 'relative'] as const

export type AttestationRelationship = (typeof ATTESTATION_RELATIONSHIPS)[number]

export function isAttestationRelationship(value: string): value is AttestationRelationship {
  return (ATTESTATION_RELATIONSHIPS as readonly string[]).includes(value)
}

/** MSDE's own refusal: a parent, a guardian or a relative may not attest (ADR 0012). */
export function mayAttest(relationship: AttestationRelationship): boolean {
  return relationship === 'none'
}
