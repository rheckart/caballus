/**
 * Escalating an Observation, closing an Escalation, and the thread that
 * outlives the close (ADR 0014).
 *
 * **Authorization here is a data-dependent OR that `src/server/api/route.ts`
 * has no static shape for**: Shift Authority over the Shift the Observation
 * was recorded on, or a holder of the Scope the payload itself names. The
 * first is a fact about the Observation rather than about this write's own
 * payload — `MutationAuthorization`'s automatic join only recognises a
 * `shiftId` field on the payload itself — and the second is a Scope chosen at
 * write time rather than fixed at registration. `claimActingLead` in
 * `src/server/shifts/roster.ts` set the precedent: the endpoint declares the
 * floor (ADR 0010's `record-an-observation` and its neighbours), and the real
 * rule is checked here, in the domain function, the same way *any rostered
 * volunteer* is checked there rather than declared on the route.
 */
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { attendance, escalationComments, escalations, observations } from '../../db/schema'
import { DOMAIN_SCOPES, type DomainScope } from '../../shared/domain-scopes'
import { now } from '../../shared/time'
import type { Actor } from '../request-context'
import { holdsShiftAuthority } from '../shifts/authority'
import { timestampOf } from '../time'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

interface ObservationForEscalation {
  readonly id: string
  readonly text: string
  readonly observedBy: string
  readonly dispositionedAt: Date | null
  /** The Shift it was recorded on, if any — null for a Visit's own. */
  readonly shiftId: string | null
}

export async function loadObservationForEscalation(
  db: OrgScopedDatabase,
  observationId: string,
): Promise<ObservationForEscalation | null> {
  const [row] = await db
    .select({
      id: observations.id,
      text: observations.text,
      observedBy: observations.observedBy,
      dispositionedAt: observations.dispositionedAt,
      shiftId: attendance.shiftId,
    })
    .from(observations)
    .innerJoin(attendance, eq(attendance.id, observations.attendanceId))
    .where(eq(observations.id, observationId))
    .limit(1)
  return row ?? null
}

export interface NewEscalation {
  readonly observationId: string
  readonly scope: DomainScope
  readonly framing: string
}

/**
 * Escalates an Observation to exactly one Domain Scope: Shift Authority over
 * the Shift it was recorded on, or a holder of `scope` adopting it into their
 * own (ADR 0014). One Observation may carry many Escalations, to the same
 * Scope twice or to different ones, and they share no state with each other.
 */
export async function escalateObservation(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actor: Actor,
  about: NewEscalation,
): Promise<Recorded<{ id: string; observedBy: string; observationText: string }>> {
  const framing = about.framing.trim()
  if (framing === '') return refused('framing_required')

  const observation = await loadObservationForEscalation(db, about.observationId)
  if (observation === null) return refused('observation_not_found')

  const overTheShift =
    observation.shiftId !== null && (await holdsShiftAuthority(orgId, actor, observation.shiftId))
  const holdsScope = actor.domainScopes.includes(about.scope)
  if (!overTheShift && !holdsScope) return refused('not_authorized_to_escalate')

  const id = uuidv7()
  const at = timestampOf(now())
  await db.insert(escalations).values({
    id,
    orgId,
    observationId: about.observationId,
    scope: about.scope,
    framing,
    escalatedBy: actor.volunteerId,
    escalatedAt: at,
  })

  // The first Escalation an Observation ever receives dispositions it, from
  // whichever door it came through — the Visit's own recorder, or a Scope
  // holder adopting a raw one. A second Escalation, to a different Scope,
  // never overwrites who dispositioned it first (ADR 0014).
  if (observation.dispositionedAt === null) {
    await db
      .update(observations)
      .set({ dispositionedAt: at, dispositionedBy: actor.volunteerId, disposition: 'escalated' })
      .where(eq(observations.id, about.observationId))
  }

  return recorded({ id, observedBy: observation.observedBy, observationText: observation.text })
}

export interface NewComment {
  readonly escalationId: string
  readonly text: string
}

/**
 * Appends to an Escalation's thread — the fourth scope-free write ADR 0010
 * gains from ADR 0014. Anyone signed in, before close and after: closing
 * still needs the Scope, commenting never has.
 */
export async function addEscalationComment(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: NewComment,
): Promise<Recorded<{ id: string; scope: DomainScope; observedBy: string }>> {
  const text = about.text.trim()
  if (text === '') return refused('text_required')

  const [row] = await db
    .select({
      id: escalations.id,
      scope: escalations.scope,
      observationId: escalations.observationId,
    })
    .from(escalations)
    .where(eq(escalations.id, about.escalationId))
    .limit(1)
  if (row === undefined) return refused('escalation_not_found')

  const observation = await loadObservationForEscalation(db, row.observationId)

  const id = uuidv7()
  await db.insert(escalationComments).values({
    id,
    orgId,
    escalationId: about.escalationId,
    text,
    authoredBy: actorVolunteerId,
    authoredAt: timestampOf(now()),
  })

  const scope = (DOMAIN_SCOPES as readonly string[]).includes(row.scope)
    ? (row.scope as DomainScope)
    : 'roster'
  return recorded({ id, scope, observedBy: observation?.observedBy ?? actorVolunteerId })
}

export interface CloseEscalation {
  readonly escalationId: string
  readonly note: string
}

/**
 * Closes an Escalation: a holder of the addressed Scope, and a note — never
 * the escalator, never the reporter, and never a reopen (ADR 0014).
 */
export async function closeEscalation(
  db: OrgScopedDatabase,
  actor: Actor,
  about: CloseEscalation,
): Promise<Recorded<{ observedBy: string }>> {
  const note = about.note.trim()
  if (note === '') return refused('note_required')

  const [row] = await db
    .select({
      id: escalations.id,
      scope: escalations.scope,
      closedAt: escalations.closedAt,
      observationId: escalations.observationId,
    })
    .from(escalations)
    .where(eq(escalations.id, about.escalationId))
    .limit(1)
  if (row === undefined) return refused('escalation_not_found')
  if (!actor.domainScopes.includes(row.scope as DomainScope))
    return refused('not_the_addressed_scope')
  if (row.closedAt !== null) return refused('escalation_already_closed')

  await db
    .update(escalations)
    .set({ closedAt: timestampOf(now()), closedBy: actor.volunteerId, closingNote: note })
    .where(eq(escalations.id, about.escalationId))

  const observation = await loadObservationForEscalation(db, row.observationId)
  return recorded({ observedBy: observation?.observedBy ?? actor.volunteerId })
}
