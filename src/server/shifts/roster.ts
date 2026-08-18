/**
 * What happens to one dated Shift's roster: an assignment, a Cover, a Drop, a
 * removal — and the Pop-up that is a Shift with no Pattern behind it
 * (`CONTEXT.md`'s Cover, Drop and Pop-up; ADR 0010, ADR 0011).
 *
 * **A row is marked, never deleted.** *Beth was rostered and dropped*, *Beth
 * was never on Thursday* and *Beth was taken off by the Coordinator* are three
 * different facts, and a fourth — she did not come — arrives with Attendance.
 * Deleting the row collapses all of them.
 *
 * **Cover and Drop are the volunteer's own and need no Domain Scope.** Saying
 * you cannot come is not authority over the roster, and an app that makes
 * people ask permission to tell it the truth gets told less of it. Removing
 * *somebody else* is the act ADR 0010 puts under `roster`, and it is a separate
 * function here for that reason.
 *
 * **Neither queues** (ADR 0011's carve-out from ADR 0005, restated by ADR 0018
 * as *the app queues when it is the ledger and not when it is the medium*). A
 * Cover is not true until it arrives: two volunteers each looking at their own
 * phone, each seeing Thursday covered, is a Thursday with nobody on it. The
 * contract marks both `neverQueued`, which is where the phone's queue reads it.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { shiftRoster, shifts } from '../../db/schema'
import type { AssignablePosition, RosterOrigin } from '../../shared/shifts'
import { now, type DayString } from '../../shared/time'
import { audit } from '../roster/audit'
import { timestampOf } from '../time'
import { assignable, gatesOf, mayCover } from './gates'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

export interface NewPopUp {
  readonly day: DayString
  readonly startTime: string
  readonly targetHeadcount: number
  /** What it is for, in the words of whoever called it. */
  readonly purpose: string
}

/**
 * Creates a Pop-up: a Shift like any other, with no Pattern behind it and
 * Staffing Mode Sign-up from birth (ADR 0011). Nothing about it is bespoke —
 * the same roster, the same Cover flow, the same screen.
 */
export async function createPopUp(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: NewPopUp,
): Promise<Recorded<{ id: string }>> {
  const id = uuidv7()
  await db.insert(shifts).values({
    id,
    orgId,
    patternId: null,
    day: about.day,
    shiftType: 'pop_up',
    startTime: about.startTime,
    targetHeadcount: about.targetHeadcount,
    staffingMode: 'sign_up',
    purpose: about.purpose,
    createdBy: actorVolunteerId,
  })
  return recorded({ id })
}

export interface ShiftAssignment {
  readonly shiftId: string
  readonly volunteerId: string
  readonly position: AssignablePosition
  readonly today: DayString
}

/**
 * The Coordinator putting somebody on one dated Shift — ADR 0011's second door,
 * gated on full rosterability exactly as the Standing Roster is.
 */
export async function assignToShift(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: ShiftAssignment,
): Promise<Recorded<{ id: string }>> {
  const shift = await shiftAt(db, about.shiftId)
  if (shift === null) return refused('shift_not_found')

  const people = await gatesOf(db, about.today)
  const allowed = assignable(people, about.volunteerId)
  if (!allowed.ok) return refused(allowed.because)

  if (about.position === 'lead') {
    const held = await leadOf(db, about.shiftId, about.volunteerId)
    if (held) return refused('lead_already_held')
  }

  return place(db, orgId, actorVolunteerId, {
    shiftId: about.shiftId,
    volunteerId: about.volunteerId,
    position: about.position,
    // Neither a copy of a standing arrangement nor a Cover: somebody put on
    // this one Shift by hand (`ROSTER_ORIGINS`).
    origin: 'assigned',
    // The Coordinator may move somebody from volunteer to Co-Lead in place.
    // Removing and re-adding would record a removal that never happened, and
    // the Pattern door already upserts the position for the same reason.
    mayChangePosition: true,
  })
}

/**
 * A Cover: a volunteer taking a place on a Shift they were not rostered on.
 *
 * It lands immediately, **as a volunteer and never as a Lead**, marked as
 * having arrived by Cover. There is no approval step and no provisional state,
 * and the app never refuses one for what the volunteer lacks — a Shift needing
 * medication still takes somebody who cannot give it and says what it still
 * needs (ADR 0011).
 */
export async function coverShift(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: { readonly shiftId: string; readonly today: DayString },
): Promise<Recorded<{ id: string }>> {
  const shift = await shiftAt(db, about.shiftId)
  if (shift === null) return refused('shift_not_found')
  // Sign-up stays open until a Shift closes rather than until it starts — the
  // call is for tonight and somebody arriving an hour in is the case it exists
  // for (ADR 0011). Close is a later ticket, so *past* is the coarsest honest
  // reading of it: a day that is over.
  if (shift.day < about.today) return refused('shift_is_over')

  const people = await gatesOf(db, about.today)
  const allowed = mayCover(people, actorVolunteerId)
  if (!allowed.ok) return refused(allowed.because)

  return place(db, orgId, actorVolunteerId, {
    shiftId: about.shiftId,
    volunteerId: actorVolunteerId,
    // Covering never confers leadership (ADR 0010's `acting_lead` is a separate,
    // explicit claim).
    position: 'volunteer',
    origin: 'cover',
    mayChangePosition: false,
  })
}

/**
 * A Drop: a volunteer taking themselves off one dated Shift.
 *
 * It marks the roster row and **touches only this Shift** — never the Shift
 * Pattern behind it, because *I have moved to Tuesdays* is a Pattern edit and a
 * different act, and a Drop that quietly rewrote the Standing Roster would be
 * ADR 0001's failure mode arriving through the back door.
 */
export async function dropFromShift(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    readonly shiftId: string
    readonly reason?: string | null
    readonly today: DayString
  },
): Promise<Recorded<null>> {
  return end(db, orgId, actorVolunteerId, {
    shiftId: about.shiftId,
    volunteerId: actorVolunteerId,
    kind: 'dropped',
    reason: about.reason ?? null,
    // Telling the app you cannot come to a day that is over changes nothing
    // about what happened, and the record of that day is not a promise any
    // more.
    notBefore: about.today,
  })
}

/** Removing somebody else, which is authority over the roster (ADR 0010). */
export async function removeFromShift(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    readonly shiftId: string
    readonly volunteerId: string
    readonly reason?: string | null
  },
): Promise<Recorded<null>> {
  return end(db, orgId, actorVolunteerId, {
    shiftId: about.shiftId,
    volunteerId: about.volunteerId,
    kind: 'removed',
    reason: about.reason ?? null,
  })
}

/**
 * Writes the roster row, or brings a dropped one back.
 *
 * One row per Volunteer per Shift: somebody who dropped and then Covers again
 * is that row standing again — with its origin updated to say how they came
 * back — rather than a second row that would count them twice.
 */
async function place(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    readonly shiftId: string
    readonly volunteerId: string
    readonly position: AssignablePosition
    readonly origin: RosterOrigin
    /**
     * Whether an existing standing row may be moved to this position. True for
     * a Coordinator's assignment, false for a Cover — a second Cover is a
     * volunteer tapping twice, and answering it as a change would report a
     * commitment nobody made.
     */
    readonly mayChangePosition: boolean
  },
): Promise<Recorded<{ id: string }>> {
  const [existing] = await db
    .select({ id: shiftRoster.id, endedAt: shiftRoster.endedAt, position: shiftRoster.position })
    .from(shiftRoster)
    .where(
      and(eq(shiftRoster.shiftId, about.shiftId), eq(shiftRoster.volunteerId, about.volunteerId)),
    )
    .limit(1)

  if (existing !== undefined && existing.endedAt === null) {
    if (!about.mayChangePosition || existing.position === about.position) {
      return refused('already_rostered')
    }
  }

  if (existing !== undefined) {
    await db
      .update(shiftRoster)
      .set({
        position: about.position,
        origin: about.origin,
        endedAt: null,
        endedKind: null,
        endedReason: null,
        endedBy: null,
        addedBy: actorVolunteerId,
      })
      .where(eq(shiftRoster.id, existing.id))
    await audit(db, orgId, actorVolunteerId, [
      {
        entity: 'shift_roster',
        entityId: about.shiftId,
        field: about.volunteerId,
        after: `${about.position} by ${about.origin}`,
      },
    ])
    return recorded({ id: existing.id })
  }

  const id = uuidv7()
  const inserted = await db
    .insert(shiftRoster)
    .values({
      id,
      orgId,
      shiftId: about.shiftId,
      volunteerId: about.volunteerId,
      position: about.position,
      origin: about.origin,
      addedBy: actorVolunteerId,
    })
    // Two Covers arriving together both find no row. The index decides, and the
    // loser is told *you are already on this* rather than handed a 500 — which
    // a phone reads as *try again* on a write that already worked.
    .onConflictDoNothing({
      target: [shiftRoster.orgId, shiftRoster.shiftId, shiftRoster.volunteerId],
    })
    .returning({ id: shiftRoster.id })
  if (inserted.length === 0) return refused('already_rostered')

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'shift_roster',
      entityId: about.shiftId,
      field: about.volunteerId,
      after: `${about.position} by ${about.origin}`,
    },
  ])
  return recorded({ id })
}

/** Marks a standing roster row as no longer a commitment. */
async function end(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    readonly shiftId: string
    readonly volunteerId: string
    readonly kind: 'dropped' | 'removed'
    readonly reason: string | null
    /** Refuse a Shift whose day is already over, where the caller cares. */
    readonly notBefore?: DayString
  },
): Promise<Recorded<null>> {
  const shift = await shiftAt(db, about.shiftId)
  if (shift === null) return refused('shift_not_found')
  if (about.notBefore !== undefined && shift.day < about.notBefore) {
    return refused('shift_is_over')
  }

  const ended = await db
    .update(shiftRoster)
    .set({
      endedAt: timestampOf(now()),
      endedKind: about.kind,
      endedReason: about.reason,
      endedBy: actorVolunteerId,
    })
    .where(
      and(
        eq(shiftRoster.shiftId, about.shiftId),
        eq(shiftRoster.volunteerId, about.volunteerId),
        isNull(shiftRoster.endedAt),
      ),
    )
    .returning({ id: shiftRoster.id })

  // Never on it, or already off it. Either way there is nothing here to mark,
  // and saying so beats answering as though something changed.
  if (ended.length === 0) return refused('not_rostered')

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'shift_roster',
      entityId: about.shiftId,
      field: about.volunteerId,
      after: about.kind,
      reason: about.reason,
    },
  ])

  return recorded(null)
}

async function shiftAt(
  db: OrgScopedDatabase,
  shiftId: string,
): Promise<{ id: string; day: string } | null> {
  const [row] = await db
    .select({ id: shifts.id, day: shifts.day })
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .limit(1)
  return row ?? null
}

/** Whether somebody other than `exceptVolunteerId` already holds Lead here. */
async function leadOf(
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
