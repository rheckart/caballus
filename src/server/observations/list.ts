/**
 * The two reads this ticket answers: one Attendance's own Observations, and
 * every Escalation — both on ADR 0010's floor. Nothing about an Observation
 * or an Escalation is the two carve-outs' business (contact details, the
 * audit log), so both are `readEverything()` in `src/server/api/app.ts`.
 *
 * `/escalations` answers the whole table rather than a holder's own slice:
 * "everyone reads everything," and the home section that shows only a
 * holder's *open* ones is the phone filtering this same read, not a second
 * one (ADR 0014).
 *
 * Names are resolved with a second, batched query rather than a repeated
 * join against `volunteers` — this application has no table-aliasing
 * convention, and `src/server/attendance/list.ts` sets the precedent for
 * resolving several id columns against one table in a single follow-up read.
 */
import { desc, eq, inArray } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import { escalationComments, escalations, observations, volunteers } from '../../db/schema'
import { DOMAIN_SCOPES, type DomainScope } from '../../shared/domain-scopes'
import {
  isObservationDisposition,
  isObservationSubjectKind,
  type ObservationDisposition,
  type ObservationSubjectKind,
} from '../../shared/observations'
import type { Instant } from '../../shared/time'
import { instantOfTimestamp } from '../time'

async function namesOf(
  db: OrgScopedDatabase,
  ids: ReadonlySet<string>,
): Promise<Map<string, string>> {
  if (ids.size === 0) return new Map()
  const rows = await db
    .select({ id: volunteers.id, name: volunteers.name })
    .from(volunteers)
    .where(inArray(volunteers.id, [...ids]))
  return new Map(rows.map((row) => [row.id, row.name]))
}

export interface ObservationEntry {
  readonly id: string
  readonly attendanceId: string
  readonly text: string
  readonly subjectKind: ObservationSubjectKind | null
  readonly subjectId: string | null
  readonly subjectLabel: string | null
  readonly recordedBy: string
  readonly recordedByName: string
  readonly observedBy: string
  readonly observedByName: string
  readonly recordedAt: Instant
  readonly dispositionedAt: Instant | null
  readonly disposition: ObservationDisposition | null
  readonly escalatedScopes: readonly DomainScope[]
}

/** One Attendance's own Observations, newest first. */
export async function observationsFor(
  db: OrgScopedDatabase,
  attendanceId: string,
): Promise<readonly ObservationEntry[]> {
  const rows = await db
    .select({
      id: observations.id,
      attendanceId: observations.attendanceId,
      text: observations.text,
      subjectKind: observations.subjectKind,
      subjectId: observations.subjectId,
      subjectLabel: observations.subjectLabel,
      recordedBy: observations.recordedBy,
      observedBy: observations.observedBy,
      recordedAt: observations.recordedAt,
      dispositionedAt: observations.dispositionedAt,
      disposition: observations.disposition,
    })
    .from(observations)
    .where(eq(observations.attendanceId, attendanceId))
    .orderBy(desc(observations.recordedAt))

  const who = new Set<string>()
  for (const row of rows) {
    who.add(row.recordedBy)
    who.add(row.observedBy)
  }
  const names = await namesOf(db, who)
  const scopesByObservation = await escalatedScopesFor(
    db,
    rows.map((row) => row.id),
  )

  return rows.map((row) => ({
    id: row.id,
    attendanceId: row.attendanceId,
    text: row.text,
    subjectKind:
      row.subjectKind !== null && isObservationSubjectKind(row.subjectKind)
        ? row.subjectKind
        : null,
    subjectId: row.subjectId,
    subjectLabel: row.subjectLabel,
    recordedBy: row.recordedBy,
    recordedByName: names.get(row.recordedBy) ?? row.recordedBy,
    observedBy: row.observedBy,
    observedByName: names.get(row.observedBy) ?? row.observedBy,
    recordedAt: instantOfTimestamp(row.recordedAt),
    dispositionedAt: row.dispositionedAt === null ? null : instantOfTimestamp(row.dispositionedAt),
    disposition:
      row.disposition !== null && isObservationDisposition(row.disposition)
        ? row.disposition
        : null,
    escalatedScopes: scopesByObservation.get(row.id) ?? [],
  }))
}

async function escalatedScopesFor(
  db: OrgScopedDatabase,
  observationIds: readonly string[],
): Promise<Map<string, readonly DomainScope[]>> {
  const byObservation = new Map<string, DomainScope[]>()
  if (observationIds.length === 0) return byObservation

  const wanted = new Set(observationIds)
  const rows = await db
    .select({ observationId: escalations.observationId, scope: escalations.scope })
    .from(escalations)

  for (const row of rows) {
    if (!wanted.has(row.observationId)) continue
    if (!(DOMAIN_SCOPES as readonly string[]).includes(row.scope)) continue
    const list = byObservation.get(row.observationId) ?? []
    list.push(row.scope as DomainScope)
    byObservation.set(row.observationId, list)
  }
  return byObservation
}

export interface EscalationComment {
  readonly id: string
  readonly text: string
  readonly authoredBy: string
  readonly authoredByName: string
  readonly authoredAt: Instant
}

export interface EscalationEntry {
  readonly id: string
  readonly observationId: string
  readonly observationText: string
  readonly observationSubjectLabel: string | null
  readonly scope: DomainScope
  readonly framing: string
  readonly escalatedBy: string
  readonly escalatedByName: string
  readonly escalatedAt: Instant
  readonly closedAt: Instant | null
  readonly closedBy: string | null
  readonly closedByName: string | null
  readonly closingNote: string | null
  readonly comments: readonly EscalationComment[]
}

/** Every Escalation, newest first, with its own thread carried whole (ADR 0014). */
export async function escalationList(db: OrgScopedDatabase): Promise<readonly EscalationEntry[]> {
  const rows = await db
    .select({
      id: escalations.id,
      observationId: escalations.observationId,
      observationText: observations.text,
      observationSubjectLabel: observations.subjectLabel,
      scope: escalations.scope,
      framing: escalations.framing,
      escalatedBy: escalations.escalatedBy,
      escalatedAt: escalations.escalatedAt,
      closedAt: escalations.closedAt,
      closedBy: escalations.closedBy,
      closingNote: escalations.closingNote,
    })
    .from(escalations)
    .innerJoin(observations, eq(observations.id, escalations.observationId))
    .orderBy(desc(escalations.escalatedAt))

  const comments = await db
    .select({
      id: escalationComments.id,
      escalationId: escalationComments.escalationId,
      text: escalationComments.text,
      authoredBy: escalationComments.authoredBy,
      authoredAt: escalationComments.authoredAt,
    })
    .from(escalationComments)
    .orderBy(escalationComments.authoredAt)

  const who = new Set<string>()
  for (const row of rows) {
    who.add(row.escalatedBy)
    if (row.closedBy !== null) who.add(row.closedBy)
  }
  for (const comment of comments) who.add(comment.authoredBy)
  const names = await namesOf(db, who)

  const commentsByEscalation = new Map<string, EscalationComment[]>()
  for (const comment of comments) {
    const list = commentsByEscalation.get(comment.escalationId) ?? []
    list.push({
      id: comment.id,
      text: comment.text,
      authoredBy: comment.authoredBy,
      authoredByName: names.get(comment.authoredBy) ?? comment.authoredBy,
      authoredAt: instantOfTimestamp(comment.authoredAt),
    })
    commentsByEscalation.set(comment.escalationId, list)
  }

  return rows.map((row) => ({
    id: row.id,
    observationId: row.observationId,
    observationText: row.observationText,
    observationSubjectLabel: row.observationSubjectLabel,
    scope: (DOMAIN_SCOPES as readonly string[]).includes(row.scope)
      ? (row.scope as DomainScope)
      : 'roster',
    framing: row.framing,
    escalatedBy: row.escalatedBy,
    escalatedByName: names.get(row.escalatedBy) ?? row.escalatedBy,
    escalatedAt: instantOfTimestamp(row.escalatedAt),
    closedAt: row.closedAt === null ? null : instantOfTimestamp(row.closedAt),
    closedBy: row.closedBy,
    closedByName: row.closedBy === null ? null : (names.get(row.closedBy) ?? row.closedBy),
    closingNote: row.closingNote,
    comments: commentsByEscalation.get(row.id) ?? [],
  }))
}

/** An Observation's own reporter (`observedBy`)'s email, for the two messages that name one. */
export async function reporterEmail(
  db: OrgScopedDatabase,
  volunteerId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ email: volunteers.email })
    .from(volunteers)
    .where(eq(volunteers.id, volunteerId))
    .limit(1)
  return row?.email ?? null
}
