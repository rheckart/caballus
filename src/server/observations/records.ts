/**
 * Recording an Observation, and dispositioning one at a Visit's sign-out
 * (ADR 0014).
 *
 * **Recording needs no Domain Scope** — `record-an-observation`, ADR 0010's
 * floor — and attaches to the **recorder's own** Attendance, found the same
 * way `src/server/attendance/records.ts` finds the row a departure closes:
 * resolved from who is asking and which Shift-or-Visit, never named by id.
 *
 * **Shift Authority may name another rostered volunteer as the observer** —
 * "recorded by Kate, observed by Joy" — checked here rather than declared on
 * the endpoint, because half of it is a join against a Shift the payload does
 * not carry as its own `shiftId` in the shape `src/server/api/route.ts`'s
 * automatic join recognises. `src/server/shifts/authority.ts` is asked
 * directly instead, the same module the automatic join itself calls.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { attendance, horses, observations, products, shiftRoster, spaces } from '../../db/schema'
import { isObservationSubjectKind, type ObservationSubjectKind } from '../../shared/observations'
import { now } from '../../shared/time'
import type { Actor } from '../request-context'
import { holdsShiftAuthority } from '../shifts/authority'
import { timestampOf } from '../time'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

export interface NewObservation {
  /** Null for a Visit. */
  readonly shiftId?: string | null
  readonly text: string
  readonly subjectKind?: string | null
  /** Required for `horse`/`space`/`product`; ignored otherwise. */
  readonly subjectId?: string | null
  /** Required for `record`; ignored otherwise. */
  readonly subjectLabel?: string | null
  /** Shift Authority naming somebody else as the observer. Defaults to the actor. */
  readonly observerVolunteerId?: string | null
}

interface Subject {
  readonly kind: ObservationSubjectKind | null
  readonly id: string | null
  readonly label: string | null
}

async function resolveSubject(
  db: OrgScopedDatabase,
  about: NewObservation,
): Promise<Recorded<Subject>> {
  const kind = about.subjectKind ?? null
  if (kind === null) return recorded({ kind: null, id: null, label: null })
  if (!isObservationSubjectKind(kind)) return refused('subject_kind_invalid')

  if (kind === 'record') {
    // "The subject is the record" — there is no fourth table to resolve
    // against, so the label is what the caller says it is (ADR 0014).
    const label = (about.subjectLabel ?? '').trim()
    if (label === '') return refused('subject_label_required')
    return recorded({ kind, id: null, label })
  }

  const subjectId = about.subjectId ?? null
  if (subjectId === null) return refused('subject_id_required')

  const table = kind === 'horse' ? horses : kind === 'space' ? spaces : products
  const [row] = await db
    .select({ name: table.name })
    .from(table)
    .where(eq(table.id, subjectId))
    .limit(1)
  if (row === undefined) return refused('subject_not_found')

  return recorded({ kind, id: subjectId, label: row.name })
}

/** The actor's own open Attendance against this Shift-or-Visit, newest first. */
async function openAttendanceRow(
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

export async function recordObservation(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actor: Actor,
  about: NewObservation,
): Promise<Recorded<{ id: string }>> {
  const text = about.text.trim()
  if (text === '') return refused('text_required')

  const shiftId = about.shiftId ?? null
  const observerVolunteerId = about.observerVolunteerId ?? actor.volunteerId

  if (observerVolunteerId !== actor.volunteerId) {
    // A Visit has no Lead to speak for anybody, so naming somebody else only
    // makes sense against a Shift (ADR 0014).
    if (shiftId === null) return refused('on_behalf_requires_shift')

    const held = await holdsShiftAuthority(orgId, actor, shiftId)
    if (!held) return refused('not_shift_authority')

    const [rostered] = await db
      .select({ id: shiftRoster.id })
      .from(shiftRoster)
      .where(
        and(
          eq(shiftRoster.shiftId, shiftId),
          eq(shiftRoster.volunteerId, observerVolunteerId),
          isNull(shiftRoster.endedAt),
        ),
      )
      .limit(1)
    if (rostered === undefined) return refused('observer_not_rostered')
  }

  const subject = await resolveSubject(db, about)
  if (!subject.ok) return subject

  const openAttendance = await openAttendanceRow(db, actor.volunteerId, shiftId)
  if (openAttendance === null) return refused('attendance_not_found')

  const id = uuidv7()
  await db.insert(observations).values({
    id,
    orgId,
    attendanceId: openAttendance.id,
    text,
    subjectKind: subject.value.kind,
    subjectId: subject.value.id,
    subjectLabel: subject.value.label,
    recordedBy: actor.volunteerId,
    observedBy: observerVolunteerId,
    recordedAt: timestampOf(now()),
  })

  return recorded({ id })
}

/**
 * The Visit's own second exit: noted, with no action. The first — Escalate —
 * is the ordinary `/escalations` write, which marks the Observation
 * dispositioned itself the moment it lands (`src/server/observations/escalations.ts`),
 * so there is nothing left for this function to do on that branch.
 *
 * Belongs to the Observation's own recorder alone — "dispositioned by their
 * recorder at sign-out" (ADR 0014) — never to Shift Authority, because a
 * Visit has none.
 */
export async function noteObservation(
  db: OrgScopedDatabase,
  actorVolunteerId: string,
  about: { readonly observationId: string },
): Promise<Recorded<null>> {
  const [row] = await db
    .select({
      id: observations.id,
      recordedBy: observations.recordedBy,
      dispositionedAt: observations.dispositionedAt,
    })
    .from(observations)
    .where(eq(observations.id, about.observationId))
    .limit(1)
  if (row === undefined) return refused('observation_not_found')
  if (row.recordedBy !== actorVolunteerId) return refused('not_the_recorder')
  if (row.dispositionedAt !== null) return refused('already_dispositioned')

  await db
    .update(observations)
    .set({
      dispositionedAt: timestampOf(now()),
      dispositionedBy: actorVolunteerId,
      disposition: 'noted_no_action',
    })
    .where(eq(observations.id, about.observationId))

  return recorded(null)
}
