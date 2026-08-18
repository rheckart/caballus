/**
 * Sign-in and sign-out: the write half of the sign-in sheet (ADR 0012).
 *
 * **Attribution, not gatekeeping.** Anyone signed in may record anyone's
 * arrival or departure, in both directions — "an app that makes people ask
 * permission to tell it the truth gets told less of it" — and what makes that
 * safe is that `arrivedRecordedBy`/`departedRecordedBy` always name the actor,
 * never the subject. `src/server/api/app.ts` declares the floor for both
 * endpoints; this module never checks who is asking, only what they are
 * asking to be true.
 *
 * **A departure is resolved, never named.** `signOut` takes the Volunteer (and
 * a Shift, where there is one) rather than an Attendance id, and finds the
 * open row itself — which is what lets a plain volunteer close their own
 * Visit without first reading a ledger that sits behind `roster` (ADR 0012's
 * pattern-of-life carve-out, below).
 *
 * **A Visit's own close gate (ADR 0014).** "On a Visit there is no Lead, so
 * the volunteer dispositions their own Observations at sign-out" — so closing
 * a Visit refuses while any Observation recorded on it still has no
 * disposition. A Shift sign-out never carries this check: the Shift's own
 * gate is a close the Shift itself does not have yet (#45).
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { attendance, observations, shifts, volunteers } from '../../db/schema'
import { isAttendanceCategory, type AttendanceCategory } from '../../shared/attendance'
import { now } from '../../shared/time'
import { timestampOf } from '../time'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

export interface NewAttendance {
  /** Who arrived — self, or somebody else, always attributed to the actor instead (ADR 0012). */
  readonly volunteerId: string
  /** Null for a Visit. */
  readonly shiftId?: string | null
  /** Required on a Visit; ignored on a Shift row, which is `description: null`. */
  readonly description?: string | null
  /** Required on a Visit and never `shift`; ignored on a Shift row, which is `category: 'shift'`. */
  readonly category?: string | null
}

/**
 * Records an arrival, against a Shift or as a Visit.
 *
 * The category and description are the server's to decide once `shiftId` is
 * known, not the caller's: a feed-shift sign-in "is the case with a Shift and
 * no description" (ADR 0012), so whatever a caller sent for either is
 * overwritten rather than trusted on that path.
 */
export async function signIn(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: NewAttendance,
): Promise<Recorded<{ id: string }>> {
  const [volunteer] = await db
    .select({ id: volunteers.id })
    .from(volunteers)
    .where(eq(volunteers.id, about.volunteerId))
    .limit(1)
  if (volunteer === undefined) return refused('volunteer_not_found')

  const shiftId = about.shiftId ?? null
  let category: AttendanceCategory
  let description: string | null

  if (shiftId !== null) {
    const [shift] = await db
      .select({ id: shifts.id })
      .from(shifts)
      .where(eq(shifts.id, shiftId))
      .limit(1)
    if (shift === undefined) return refused('shift_not_found')
    category = 'shift'
    description = null
  } else {
    const given = (about.description ?? '').trim()
    if (given === '') return refused('description_required')
    if (
      about.category === null ||
      about.category === undefined ||
      about.category === 'shift' ||
      !isAttendanceCategory(about.category)
    ) {
      return refused('category_invalid')
    }
    category = about.category
    description = given
  }

  const open = await openRow(db, about.volunteerId, shiftId)
  if (open !== null) return refused('already_signed_in')

  const id = uuidv7()
  await db.insert(attendance).values({
    id,
    orgId,
    volunteerId: about.volunteerId,
    shiftId,
    category,
    description,
    arrivedAt: timestampOf(now()),
    arrivedRecordedBy: actorVolunteerId,
  })

  return recorded({ id })
}

export interface Departure {
  readonly volunteerId: string
  /** Null closes the open Visit; given, closes that Shift's open row. */
  readonly shiftId?: string | null
  /** Who supervised, as a Volunteer — distinct from who was merely present (ADR 0012). */
  readonly supervisingAdultId?: string | null
  readonly supervisingAdultPhone?: string | null
}

/**
 * Closes the open Attendance for `volunteerId` — against `shiftId` where one
 * is named, the open Visit otherwise. Never invents one: nothing here creates
 * a row, and a Volunteer with nothing open is refused rather than silently
 * ignored (ADR 0012).
 */
export async function signOut(
  db: OrgScopedDatabase,
  _orgId: OrgId,
  actorVolunteerId: string,
  about: Departure,
): Promise<Recorded<null>> {
  const shiftId = about.shiftId ?? null
  const open = await openRow(db, about.volunteerId, shiftId)
  if (open === null) return refused('not_signed_in')

  if (shiftId === null) {
    const [undispositioned] = await db
      .select({ id: observations.id })
      .from(observations)
      .where(and(eq(observations.attendanceId, open.id), isNull(observations.dispositionedAt)))
      .limit(1)
    if (undispositioned !== undefined) return refused('observations_undispositioned')
  }

  await db
    .update(attendance)
    .set({
      departedAt: timestampOf(now()),
      departedRecordedBy: actorVolunteerId,
      supervisingAdultId: about.supervisingAdultId ?? null,
      supervisingAdultPhone: about.supervisingAdultPhone ?? null,
    })
    .where(eq(attendance.id, open.id))

  return recorded(null)
}

/**
 * The open row for this Volunteer against this Shift-or-Visit, newest first —
 * there should only ever be one, and `already_signed_in` is what stops a
 * second, but two would not be a crash here, only a wrong answer.
 */
async function openRow(
  db: OrgScopedDatabase,
  volunteerId: string,
  shiftId: string | null,
): Promise<{ id: string } | null> {
  const matchesShift =
    shiftId === null ? isNull(attendance.shiftId) : eq(attendance.shiftId, shiftId)
  const [row] = await db
    .select({ id: attendance.id })
    .from(attendance)
    .where(
      and(eq(attendance.volunteerId, volunteerId), matchesShift, isNull(attendance.departedAt)),
    )
    .orderBy(desc(attendance.arrivedAt))
    .limit(1)
  return row ?? null
}
