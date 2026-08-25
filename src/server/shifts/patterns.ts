/**
 * Shift Patterns and their Standing Rosters (`CONTEXT.md`'s Shift Pattern and
 * Standing Roster; ADR 0001).
 *
 * **A Pattern edit never reaches into the past, and reaches forward only when
 * asked.** ADR 0001 is emphatic about both halves: a Shift copies its roster
 * and start time when it is generated, so editing a Pattern changes future
 * generations by itself — and whether it also touches the Shifts already
 * standing inside the horizon is a question the Coordinator answers on the way
 * in. `applyToScheduled` is that answer, and it is required rather than
 * defaulted, because without the prompt the model is quietly wrong in the most
 * common editing case.
 *
 * Current state plus an audit entry (ADR 0003). What a Pattern *used to be* is
 * answered by the Shifts it generated — which is the point of copying — rather
 * than by a version of the Pattern.
 */
import { and, eq, gte, isNull, ne } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { shiftPatternRoster, shiftPatterns, shiftRoster, shifts } from '../../db/schema'
import type { ShiftType } from '../../shared/feed-schedule'
import { asTimeOfDay, type AssignablePosition, type Weekday } from '../../shared/shifts'
import { now, type DayString } from '../../shared/time'
import { audit } from '../roster/audit'
import { timestampOf } from '../time'
import { assignable, gatesOf } from './gates'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

export interface NewShiftPattern {
  readonly weekday: Weekday
  readonly shiftType: ShiftType
  /** `HH:MM` on the barn's own clock. */
  readonly startTime: string
  readonly targetHeadcount: number
}

/** Creates a Shift Pattern. It generates nothing by itself — generation is its own act. */
export async function createPattern(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: NewShiftPattern,
): Promise<Recorded<{ id: string }>> {
  const id = uuidv7()
  await db.insert(shiftPatterns).values({
    id,
    orgId,
    weekday: about.weekday,
    shiftType: about.shiftType,
    startTime: about.startTime,
    targetHeadcount: about.targetHeadcount,
    createdBy: actorVolunteerId,
  })

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'shift_pattern',
      entityId: id,
      after: `${about.weekday} ${about.shiftType} at ${about.startTime}`,
    },
  ])

  return recorded({ id })
}

export interface NewShiftPatterns {
  readonly shiftType: ShiftType
  readonly weekdays: readonly Weekday[]
  readonly startTime: string
  readonly targetHeadcount: number
}

/**
 * One Shift Type across several weekdays, in one act (#69).
 *
 * The rescue runs AM, Lunch and PM seven days a week and only the start time
 * and the headcount vary, so the composer that matters is *this Shift Type, on
 * these days* — twenty-one single adds is the same schedule spelled the long
 * way. **The model does not move for it**: a Pattern is still one weekday,
 * because a Pattern spanning several would have to share one Standing Roster
 * across all of them and who is on Saturday morning is not who is on Monday
 * morning (ADR 0001).
 *
 * **A weekday already holding a live Pattern of this Shift Type is skipped and
 * named back**, the way `/spaces/batch` names a stall the rescue already has:
 * asking for the week when Monday is already set means the six that are
 * missing. The held Pattern's start time and headcount are **not** touched —
 * this creates, and moving an existing one is `editPattern`'s act with its own
 * apply-to-upcoming prompt.
 *
 * A **retired** Pattern does not block, which is what makes the partial unique
 * index behind this the right one: retirement here means what it means for a
 * Product and a Space, and a bulk add that silently un-retired something a
 * person deliberately retired is the surprise that stops the button being
 * trusted.
 */
export async function createPatterns(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: NewShiftPatterns,
): Promise<Recorded<{ ids: string[]; skipped: Weekday[] }>> {
  const live = await db
    .select({ weekday: shiftPatterns.weekday })
    .from(shiftPatterns)
    .where(and(eq(shiftPatterns.shiftType, about.shiftType), isNull(shiftPatterns.retiredAt)))
  const held = new Set(live.map((row) => row.weekday))

  const ids: string[] = []
  const skipped: Weekday[] = []
  // In the order sent, so the screen can name the skipped days back in the
  // order the person ticked them.
  for (const weekday of about.weekdays) {
    if (held.has(weekday)) {
      skipped.push(weekday)
      continue
    }
    // Through `createPattern` rather than one bulk insert, so the durable trail
    // is one audit entry per created Pattern and there is no batch record to
    // become the fifth hand-rolled log (ADR 0019, #59).
    const outcome = await createPattern(db, orgId, actorVolunteerId, {
      weekday,
      shiftType: about.shiftType,
      startTime: about.startTime,
      targetHeadcount: about.targetHeadcount,
    })
    if (!outcome.ok) return outcome
    ids.push(outcome.value.id)
    // A weekday sent twice is one Pattern, not a unique violation.
    held.add(weekday)
  }

  return recorded({ ids, skipped })
}

export interface PatternEdit {
  readonly patternId: string
  readonly startTime?: string
  readonly targetHeadcount?: number
  /**
   * ADR 0001's prompt, and the reason it is not optional: a Coordinator who
   * moves a start time and is never asked will find next Tuesday still on the
   * old one.
   */
  readonly applyToScheduled: boolean
  readonly reason?: string | null
  /**
   * The day the horizon starts at. Shifts **from today forward** are touched —
   * including one that was worked this morning, since nothing yet records that
   * a Shift is over. Close is what will make *has not happened yet* precise.
   */
  readonly today: DayString
}

/**
 * Edits a Pattern, and — if that is what was answered — the Shifts already
 * generated from it, from today forward.
 *
 * **Never a Shift on a past day**, under any answer. What was planned on the
 * 14th is a fact recorded at the time, and rewriting it a fortnight later is
 * the retroactive edit ADR 0001 rejected live resolution to avoid. Today's own
 * Shifts are still in reach, which is right for the evening feed and wrong for
 * the morning one — a distinction nothing can draw until Close exists.
 */
export async function editPattern(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: PatternEdit,
): Promise<Recorded<{ scheduledTouched: number }>> {
  const [pattern] = await db
    .select({
      id: shiftPatterns.id,
      startTime: shiftPatterns.startTime,
      targetHeadcount: shiftPatterns.targetHeadcount,
    })
    .from(shiftPatterns)
    .where(eq(shiftPatterns.id, about.patternId))
    .limit(1)
  if (pattern === undefined) return refused('pattern_not_found')

  // Normalised on both sides of the comparison: Postgres answers a `time`
  // column as `HH:MM:SS` and the barn writes `HH:MM`, and comparing the two
  // spellings would write an audit entry saying 06:30:00 became 06:30 every
  // time somebody edited the headcount and left the time alone.
  const held = asTimeOfDay(pattern.startTime)
  const startTime = about.startTime ?? held
  const targetHeadcount = about.targetHeadcount ?? pattern.targetHeadcount

  await db
    .update(shiftPatterns)
    .set({ startTime, targetHeadcount })
    .where(eq(shiftPatterns.id, about.patternId))

  const entries = []
  if (startTime !== held) {
    entries.push({
      entity: 'shift_pattern' as const,
      entityId: about.patternId,
      field: 'start_time',
      before: held,
      after: startTime,
      reason: about.reason ?? null,
    })
  }
  if (targetHeadcount !== pattern.targetHeadcount) {
    entries.push({
      entity: 'shift_pattern' as const,
      entityId: about.patternId,
      field: 'target_headcount',
      before: String(pattern.targetHeadcount),
      after: String(targetHeadcount),
      reason: about.reason ?? null,
    })
  }
  if (entries.length > 0) await audit(db, orgId, actorVolunteerId, entries)

  if (!about.applyToScheduled) return recorded({ scheduledTouched: 0 })

  const touched = await db
    .update(shifts)
    .set({ startTime, targetHeadcount })
    .where(and(eq(shifts.patternId, about.patternId), gte(shifts.day, about.today)))
    .returning({ id: shifts.id })

  return recorded({ scheduledTouched: touched.length })
}

export interface StandingRosterAssignment {
  readonly patternId: string
  readonly volunteerId: string
  readonly position: AssignablePosition
  /** ADR 0001's prompt again: does this reach the Shifts already generated? */
  readonly applyToScheduled: boolean
  readonly today: DayString
}

/**
 * Puts somebody on a Pattern's Standing Roster — the first of ADR 0011's two
 * doors, and gated on full rosterability with no override.
 */
export async function assignToStandingRoster(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: StandingRosterAssignment,
): Promise<Recorded<{ scheduledTouched: number; leadHeldOn: number }>> {
  const [pattern] = await db
    .select({ id: shiftPatterns.id })
    .from(shiftPatterns)
    .where(eq(shiftPatterns.id, about.patternId))
    .limit(1)
  if (pattern === undefined) return refused('pattern_not_found')

  const people = await gatesOf(db, about.today)
  const allowed = assignable(people, about.volunteerId)
  if (!allowed.ok) return refused(allowed.because)

  if (about.position === 'lead') {
    const held = await db
      .select({ volunteerId: shiftPatternRoster.volunteerId })
      .from(shiftPatternRoster)
      .where(
        and(
          eq(shiftPatternRoster.patternId, about.patternId),
          eq(shiftPatternRoster.position, 'lead'),
          ne(shiftPatternRoster.volunteerId, about.volunteerId),
        ),
      )
      .limit(1)
    // At most one Lead (ADR 0010). Zero is legal and stays legal; two is the
    // state that makes "who was in charge on Thursday" unanswerable.
    if (held.length > 0) return refused('lead_already_held')
  }

  await db
    .insert(shiftPatternRoster)
    .values({
      orgId,
      patternId: about.patternId,
      volunteerId: about.volunteerId,
      position: about.position,
      assignedBy: actorVolunteerId,
    })
    .onConflictDoUpdate({
      target: [
        shiftPatternRoster.orgId,
        shiftPatternRoster.patternId,
        shiftPatternRoster.volunteerId,
      ],
      set: { position: about.position, assignedBy: actorVolunteerId },
    })

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'shift_pattern_roster',
      entityId: about.patternId,
      field: about.volunteerId,
      after: about.position,
    },
  ])

  if (!about.applyToScheduled) return recorded({ scheduledTouched: 0, leadHeldOn: 0 })

  const upcoming = await upcomingShiftsOf(db, about.patternId, about.today)
  let touched = 0
  let leadHeldOn = 0
  for (const shift of upcoming) {
    // At most one Lead **on the Shift**, not only on the Pattern. Somebody put
    // on next Thursday by hand already holds it there, and carrying a Pattern
    // change forward must not quietly make a second one — which is the state
    // ADR 0010's rule exists to make impossible. The Shift is left alone and
    // said out loud rather than silently skipped.
    if (about.position === 'lead' && (await leadOtherThan(db, shift.id, about.volunteerId))) {
      leadHeldOn += 1
      continue
    }

    const [existing] = await db
      .select({ id: shiftRoster.id, endedAt: shiftRoster.endedAt })
      .from(shiftRoster)
      .where(and(eq(shiftRoster.shiftId, shift.id), eq(shiftRoster.volunteerId, about.volunteerId)))
      .limit(1)

    if (existing === undefined) {
      await db.insert(shiftRoster).values({
        id: uuidv7(),
        orgId,
        shiftId: shift.id,
        volunteerId: about.volunteerId,
        position: about.position,
        origin: 'standing_roster',
        addedBy: actorVolunteerId,
      })
      touched += 1
      continue
    }

    // A row that was dropped stays dropped: applying a Pattern edit forward is
    // the Coordinator saying *this is the standing arrangement now*, not the
    // app overruling a volunteer who has already said they cannot come.
    if (existing.endedAt !== null) continue
    await db
      .update(shiftRoster)
      .set({ position: about.position })
      .where(eq(shiftRoster.id, existing.id))
    touched += 1
  }

  return recorded({ scheduledTouched: touched, leadHeldOn })
}

/** Whether somebody other than `exceptVolunteerId` holds Lead on this Shift. */
async function leadOtherThan(
  db: OrgScopedDatabase,
  shiftId: string,
  exceptVolunteerId: string,
): Promise<boolean> {
  const rows = await db
    .select({ volunteerId: shiftRoster.volunteerId })
    .from(shiftRoster)
    .where(
      and(
        eq(shiftRoster.shiftId, shiftId),
        eq(shiftRoster.position, 'lead'),
        isNull(shiftRoster.endedAt),
      ),
    )
  return rows.some((row) => row.volunteerId !== exceptVolunteerId)
}

/**
 * Retires a Pattern, or brings it back.
 *
 * How a rescue stops a Tuesday morning: retired Patterns generate nothing, and
 * the Shifts they already made stand — *what were the Tuesday mornings before
 * we stopped* stays answerable, which a delete would take away. It does not
 * touch the horizon already generated: whether next Tuesday still happens is a
 * question about that Shift, and the Coordinator answers it there.
 */
export async function retirePattern(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: { readonly patternId: string; readonly retired: boolean; readonly reason?: string | null },
): Promise<Recorded<null>> {
  const [pattern] = await db
    .select({ id: shiftPatterns.id, retiredAt: shiftPatterns.retiredAt })
    .from(shiftPatterns)
    .where(eq(shiftPatterns.id, about.patternId))
    .limit(1)
  if (pattern === undefined) return refused('pattern_not_found')

  await db
    .update(shiftPatterns)
    .set({ retiredAt: about.retired ? timestampOf(now()) : null })
    .where(eq(shiftPatterns.id, about.patternId))

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'shift_pattern',
      entityId: about.patternId,
      field: 'retired_at',
      before: pattern.retiredAt === null ? null : 'retired',
      after: about.retired ? 'retired' : null,
      reason: about.reason ?? null,
    },
  ])

  return recorded(null)
}

export interface StandingRosterRemoval {
  readonly patternId: string
  readonly volunteerId: string
  readonly applyToScheduled: boolean
  readonly reason?: string | null
  readonly today: DayString
}

/**
 * Takes somebody off a Standing Roster. Under `roster`, because this is
 * authority over the roster rather than a statement about your own
 * availability — which is a Drop, and is the volunteer's own (ADR 0011).
 */
export async function removeFromStandingRoster(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: StandingRosterRemoval,
): Promise<Recorded<{ scheduledTouched: number }>> {
  const removed = await db
    .delete(shiftPatternRoster)
    .where(
      and(
        eq(shiftPatternRoster.patternId, about.patternId),
        eq(shiftPatternRoster.volunteerId, about.volunteerId),
      ),
    )
    .returning({ position: shiftPatternRoster.position })
  if (removed.length === 0) return refused('not_rostered')

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'shift_pattern_roster',
      entityId: about.patternId,
      field: about.volunteerId,
      before: removed[0]?.position ?? null,
      after: null,
      reason: about.reason ?? null,
    },
  ])

  if (!about.applyToScheduled) return recorded({ scheduledTouched: 0 })

  const upcoming = await upcomingShiftsOf(db, about.patternId, about.today)
  let touched = 0
  for (const shift of upcoming) {
    // Marked, never deleted — on the dated Shift as on nothing else, because
    // *she was rostered and taken off* is a fact the record keeps (ADR 0011).
    const ended = await db
      .update(shiftRoster)
      .set({
        endedAt: timestampOf(now()),
        endedKind: 'removed',
        endedReason: about.reason ?? null,
        endedBy: actorVolunteerId,
      })
      .where(
        and(
          eq(shiftRoster.shiftId, shift.id),
          eq(shiftRoster.volunteerId, about.volunteerId),
          isNull(shiftRoster.endedAt),
        ),
      )
      .returning({ id: shiftRoster.id })
    touched += ended.length
  }

  return recorded({ scheduledTouched: touched })
}

/** The Shifts this Pattern has already generated, from today forward. */
async function upcomingShiftsOf(
  db: OrgScopedDatabase,
  patternId: string,
  today: DayString,
): Promise<readonly { id: string }[]> {
  return db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.patternId, patternId), gte(shifts.day, today)))
}
