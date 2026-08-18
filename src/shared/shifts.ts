/**
 * The Shift vocabulary (`CONTEXT.md`'s Shift Pattern, Shift, Staffing Mode,
 * Standing Roster, Cover and Drop; ADR 0001, ADR 0010, ADR 0011).
 *
 * Here rather than beside the checks, for the reason `DOMAIN_SCOPES` is: a
 * roster position and a staffing mode cross the wire to the Coordinator's
 * schedule and to a volunteer's phone, and a second copy of either in the
 * contract is the drift ADR 0021 exists to remove.
 */
import { SHIFT_TYPES, type ShiftType } from './feed-schedule'

/**
 * The days a Shift Pattern may recur on, as words.
 *
 * Words rather than the numbers Luxon or Postgres would give, because the two
 * disagree about which day is zero and a Pattern stored as `0` is a Pattern
 * that means Sunday in one library and Monday in the next. The server resolves
 * a day to one of these in the organisation's timezone (ADR 0007).
 */
export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

export type Weekday = (typeof WEEKDAYS)[number]

export function isWeekday(stored: string): stored is Weekday {
  return (WEEKDAYS as readonly string[]).includes(stored)
}

/**
 * What kind of work a Shift is, **including Pop-up** — which `SHIFT_TYPES` in
 * `src/shared/feed-schedule.ts` deliberately excludes, because only the three
 * regular ones carry a Feed Schedule (`CONTEXT.md`'s Shift Type).
 *
 * Derived from that list rather than restated, so a fourth feeding type added
 * there arrives here without anybody remembering to.
 */
export const SHIFT_TYPES_INCLUDING_POP_UP = [...SHIFT_TYPES, 'pop_up'] as const

export type AnyShiftType = ShiftType | 'pop_up'

export function isAnyShiftType(stored: string): stored is AnyShiftType {
  return (SHIFT_TYPES_INCLUDING_POP_UP as readonly string[]).includes(stored)
}

/**
 * The position a Volunteer holds on one Shift (ADR 0010): `lead`, `co_lead`,
 * `acting_lead`, `volunteer`.
 *
 * **No check ever distinguishes Lead from Co-Lead** — the brief gives them a
 * character-for-character identical responsibility set — but the barn
 * distinguishes them and *who was in charge on Thursday* is a question the
 * record has to answer, so they stay two positions.
 */
export const SHIFT_POSITIONS = ['lead', 'co_lead', 'acting_lead', 'volunteer'] as const

export type ShiftPosition = (typeof SHIFT_POSITIONS)[number]

export function isShiftPosition(stored: string): stored is ShiftPosition {
  return (SHIFT_POSITIONS as readonly string[]).includes(stored)
}

/**
 * The positions somebody may be *assigned* to. `acting_lead` is missing
 * deliberately: it is a claim a rostered volunteer makes about a Shift with no
 * Lead on it (ADR 0010), never a slot a Coordinator fills, and the claim lands
 * with staffing rather than here.
 */
export const ASSIGNABLE_POSITIONS = ['lead', 'co_lead', 'volunteer'] as const

export type AssignablePosition = (typeof ASSIGNABLE_POSITIONS)[number]

export function isAssignablePosition(stored: string): stored is AssignablePosition {
  return (ASSIGNABLE_POSITIONS as readonly string[]).includes(stored)
}

/**
 * How somebody came to be on a Shift's roster: copied from the Standing Roster
 * when the Shift was generated, put on this one Shift by hand, or claimed by
 * Cover (ADR 0001, ADR 0011).
 *
 * Recorded rather than derived, because *who turned up outside their
 * assignment* is what the Coordinator's real interest in Cover is — and that
 * question needs `assigned` as well as the two ADR 0011 names. A Coordinator
 * putting somebody on next Thursday alone is not a copy of a standing
 * arrangement, and recording it as one would make the column answer a question
 * it was invented to answer wrongly.
 */
export const ROSTER_ORIGINS = ['standing_roster', 'assigned', 'cover'] as const

export type RosterOrigin = (typeof ROSTER_ORIGINS)[number]

export function isRosterOrigin(stored: string): stored is RosterOrigin {
  return (ROSTER_ORIGINS as readonly string[]).includes(stored)
}

/**
 * How a Shift gets its people (`CONTEXT.md`'s Staffing Mode): from a Standing
 * Roster, or by Sign-up. A property of the Shift and not a consequence of its
 * type — a regular Feed Shift that comes up short can be opened to Sign-up.
 */
export const STAFFING_MODES = ['standing_roster', 'sign_up'] as const

export type StaffingMode = (typeof STAFFING_MODES)[number]

export function isStaffingMode(stored: string): stored is StaffingMode {
  return (STAFFING_MODES as readonly string[]).includes(stored)
}

/**
 * Why a roster row is no longer counted on: the volunteer dropped themselves,
 * or somebody holding `roster` took them off (ADR 0011, ADR 0010).
 *
 * The row is **marked, never deleted**: *Beth was rostered and dropped* and
 * *Beth was never on Thursday* are different facts, and a no-show will be a
 * third. Deleting the row collapses all three.
 */
export const ROSTER_END_KINDS = ['dropped', 'removed'] as const

export type RosterEndKind = (typeof ROSTER_END_KINDS)[number]

export function isRosterEndKind(stored: string): stored is RosterEndKind {
  return (ROSTER_END_KINDS as readonly string[]).includes(stored)
}

/**
 * Where a Shift is in its life.
 *
 * Two states in this ticket and no `cancelled`, ever: the property is never
 * closed, so a Shift nobody can staff is still a Shift, still visible and
 * escalating (ADR 0001). Close is a later ticket, and until then `in_progress`
 * is derived from the clock rather than stored — nothing yet exists that could
 * honestly write the transition, and a column nothing sets would be a lifecycle
 * the app only pretends to have.
 */
export const SHIFT_STATES = ['scheduled', 'in_progress'] as const

export type ShiftState = (typeof SHIFT_STATES)[number]

/**
 * How far ahead Shifts are generated (ADR 0001's rolling two-week horizon; ADR
 * 0011 computes staffing across the same window because a roster is built a
 * fortnight out).
 */
export const HORIZON_DAYS = 14

/** A time of day as a Shift carries one — `06:30`, in the barn's own clock. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/

export function isTimeOfDay(value: string): boolean {
  return TIME_OF_DAY.test(value)
}

/**
 * A stored time as the barn writes it: `06:30`, never `06:30:00`.
 *
 * Postgres normalises a `time` column to `HH:MM:SS` on the way out, and the
 * seconds are noise nobody typed — a Shift starts at half six. Trimmed here
 * rather than in each read, so the wire carries one spelling.
 */
export function asTimeOfDay(stored: string): string {
  const [hour = '00', minute = '00'] = stored.split(':')
  return `${hour}:${minute}`
}
