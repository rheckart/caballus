/**
 * Alerts on a horse: the reads the three surfaces ride on, and the three acts
 * a `horse_care` holder performs on one (`CONTEXT.md`'s Alert; ADR 0024, #60).
 *
 * The reads live here beside the writes rather than in `list.ts`, because an
 * Alert is a domain of its own — `list.ts` reads a horse and its Spaces, and
 * three surfaces reading Alerts through one module is what keeps the profile,
 * the Board and the Work Surface from ordering the same two warnings
 * differently. The order itself is `compareAlerts`, pure and shared.
 *
 * The writes take the scoped transaction `mutation` opened rather than opening
 * one, so the effect and its audit entry commit together (ADR 0020), and every
 * refusal is a named outcome rather than a thrown error — the same discipline
 * `records.ts` beside it follows and the reasons it gives for both.
 *
 * **Nothing here ends an Alert on its own.** There is no review date, no
 * scheduled job, and a horse departing ends nothing: she is gone rather than
 * cured, and an app writing an ending with no reason is exactly the row ADR
 * 0024 required a reason to prevent.
 */
import { eq, inArray, isNull, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { alerts, horses, volunteers } from '../../db/schema'
import { compareAlerts, isAlertKind, type AlertKind } from '../../shared/alerts'
import { groupBy } from '../../shared/group-by'
import { log } from '../observability'
import { audit, type AuditEntry } from '../roster/audit'
import { recorded, refused, type Recorded } from './outcome'

/** One Alert, as every surface carries it — in full text, never as a count (ADR 0024). */
export interface Alert {
  readonly id: string
  readonly horseId: string
  readonly kind: AlertKind
  readonly text: string
  readonly raisedBy: string
  readonly raisedByName: string
  /** Epoch milliseconds. */
  readonly raisedAt: number
  /** Epoch milliseconds, or null while standing. */
  readonly endedAt: number | null
  readonly endedBy: string | null
  readonly endedByName: string | null
  readonly endingReason: string | null
}

interface AlertRow {
  readonly id: string
  readonly horseId: string
  readonly kind: string
  readonly text: string
  readonly raisedBy: string
  readonly raisedByName: string | null
  readonly raisedAt: Date
  readonly endedAt: Date | null
  readonly endedBy: string | null
  readonly endedByName: string | null
  readonly endingReason: string | null
}

/**
 * A stored kind this build cannot name is left off, the same call `spaceList`
 * makes about a Space kind and `ITEM_FOR_PRODUCT_KIND` makes about a Product's
 * (#58): the alternative is guessing, and a mis-kinded safety fact is worse
 * than an absent one, which is ADR 0023's own first rule.
 *
 * **It is logged rather than dropped quietly**, which is where this departs
 * from those two. Only a rollback past a build that added a fourth kind can
 * produce such a row, and dropping a *placement* in that window is a horse in
 * the wrong stall where dropping a *warning* is a volunteer walking in
 * uninformed. The line in the log is what makes the window visible.
 */
function alertsOf(rows: readonly AlertRow[]): Alert[] {
  for (const row of rows) {
    if (!isAlertKind(row.kind)) {
      log('warn', 'alert_kind_unknown', { alertId: row.id, horseId: row.horseId, kind: row.kind })
    }
  }

  return rows
    .filter((row) => isAlertKind(row.kind))
    .map((row) => ({
      id: row.id,
      horseId: row.horseId,
      // Filtered above, so this build's own vocabulary is what is left.
      kind: row.kind as AlertKind,
      text: row.text,
      raisedBy: row.raisedBy,
      raisedByName: row.raisedByName ?? 'somebody no longer here',
      raisedAt: row.raisedAt.getTime(),
      endedAt: row.endedAt === null ? null : row.endedAt.getTime(),
      endedBy: row.endedBy,
      endedByName: row.endedBy === null ? null : (row.endedByName ?? 'somebody no longer here'),
      endingReason: row.endingReason,
    }))
}

/** The one shape every read here answers with, minus the ending actor's name. */
function selection(db: OrgScopedDatabase) {
  return db
    .select({
      id: alerts.id,
      horseId: alerts.horseId,
      kind: alerts.kind,
      text: alerts.text,
      raisedBy: alerts.raisedBy,
      raisedByName: volunteers.name,
      raisedAt: alerts.raisedAt,
      endedAt: alerts.endedAt,
      endedBy: alerts.endedBy,
      endingReason: alerts.endingReason,
    })
    .from(alerts)
    .leftJoin(volunteers, eq(volunteers.id, alerts.raisedBy))
}

/**
 * Every standing Alert, grouped by horse and ordered the way every surface
 * shows them. One read for the whole list, because the Board and the horse
 * list each want all sixty horses' warnings at once and sixty reads on a
 * tablet's minute-by-minute poll is the shape #36 argued against.
 */
export async function standingAlertsByHorse(db: OrgScopedDatabase): Promise<Map<string, Alert[]>> {
  // Standing means the three ending columns are all null, so there is no
  // ending actor to resolve here and `withEnderNames` is not called: a read
  // that could only ever return nothing is a read worth not making.
  const rows = await selection(db).where(isNull(alerts.endedAt))
  const standing = alertsOf(rows.map((row) => ({ ...row, endedByName: null })))

  const grouped = groupBy(standing, (entry) => entry.horseId)
  for (const held of grouped.values()) held.sort(compareAlerts)
  return grouped
}

/**
 * One horse's Alerts, standing and ended.
 *
 * Ended ones come back newest ending first — the opposite of standing, and
 * deliberately: a standing list is a thing to read top to bottom before
 * touching the horse, and an ended list is a history, where the last thing
 * that changed is the thing being looked for.
 */
export async function alertsForHorse(
  db: OrgScopedDatabase,
  horseId: string,
): Promise<{ standing: Alert[]; ended: Alert[] }> {
  // No `orderBy`: both lists below are sorted here, in the order each surface
  // shows them, and a database order two JS sorts then discard is a promise
  // about the answer that nothing keeps.
  const rows = await selection(db).where(eq(alerts.horseId, horseId))
  const entries = alertsOf(await withEnderNames(db, rows))

  return {
    standing: entries.filter((entry) => entry.endedAt === null).sort(compareAlerts),
    ended: entries
      .filter((entry) => entry.endedAt !== null)
      .sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0)),
  }
}

/**
 * Resolves the ending actor's name for whichever rows carry one.
 *
 * A second small read rather than a second `leftJoin` on the same table: two
 * joins against `volunteers` in one statement need an alias, and the alias
 * would be there to serve the rows that mostly do not have an ender at all.
 * The set is the handful of people who have ever ended an Alert.
 */
async function withEnderNames(
  db: OrgScopedDatabase,
  rows: readonly Omit<AlertRow, 'endedByName'>[],
): Promise<AlertRow[]> {
  const wanted = [...new Set(rows.map((row) => row.endedBy).filter((id) => id !== null))]
  const names =
    wanted.length === 0
      ? []
      : await db
          .select({ id: volunteers.id, name: volunteers.name })
          .from(volunteers)
          .where(inArray(volunteers.id, wanted))
  const by = new Map(names.map((row) => [row.id, row.name]))

  return rows.map((row) => ({
    ...row,
    endedByName: row.endedBy === null ? null : (by.get(row.endedBy) ?? null),
  }))
}

/**
 * Raises an Alert. `horse_care` and nobody else — the check is on the route,
 * because unlike an Escalation's it depends on no data (ADR 0024).
 */
export async function raiseAlert(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  details: { readonly horseId: string; readonly kind: AlertKind; readonly text: string },
): Promise<Recorded<{ id: string }>> {
  const [horse] = await db
    .select({ id: horses.id })
    .from(horses)
    .where(eq(horses.id, details.horseId))
    .limit(1)
  if (horse === undefined) return refused('horse_not_found')

  const id = uuidv7()
  const text = details.text.trim()
  await db.insert(alerts).values({
    id,
    orgId,
    horseId: details.horseId,
    kind: details.kind,
    text,
    raisedBy: actorVolunteerId,
  })

  await audit(db, orgId, actorVolunteerId, [{ entity: 'alert', entityId: id, after: text }])

  return recorded({ id })
}

/**
 * Edits an Alert's text and kind in place, auditing only what actually
 * changed (ADR 0003) — the same before/after discipline `editHorseAttributes`
 * follows.
 *
 * An ended Alert is refused rather than edited: it is history, and rewriting
 * what a warning said after the rescue stopped saying it would make the ended
 * section describe a warning nobody was ever shown.
 */
export async function editAlert(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: { readonly alertId: string; readonly kind: AlertKind; readonly text: string },
): Promise<Recorded> {
  const [existing] = await db
    .select({ kind: alerts.kind, text: alerts.text, endedAt: alerts.endedAt })
    .from(alerts)
    .where(eq(alerts.id, about.alertId))
    .limit(1)
  if (existing === undefined) return refused('alert_not_found')
  if (existing.endedAt !== null) return refused('alert_already_ended')

  const text = about.text.trim()
  const entries: AuditEntry[] = []
  if (existing.kind !== about.kind) {
    entries.push({
      entity: 'alert',
      entityId: about.alertId,
      field: 'kind',
      before: existing.kind,
      after: about.kind,
    })
  }
  if (existing.text !== text) {
    entries.push({
      entity: 'alert',
      entityId: about.alertId,
      field: 'text',
      before: existing.text,
      after: text,
    })
  }

  if (entries.length > 0) {
    await db.update(alerts).set({ kind: about.kind, text }).where(eq(alerts.id, about.alertId))
  }
  await audit(db, orgId, actorVolunteerId, entries)

  return recorded(null)
}

/**
 * Ends an Alert: an instant, an actor and a **required** reason, never a
 * delete (ADR 0024). The row stays, and it stays readable in the profile's
 * ended section on the read-everything floor — the history must not leave with
 * the record (ADR 0002's own argument).
 *
 * There is no un-ending. A warning that is true again is a new Alert, which is
 * where the new reason to raise it gets said.
 */
export async function endAlert(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: { readonly alertId: string; readonly reason: string },
): Promise<Recorded> {
  const [existing] = await db
    .select({ text: alerts.text, endedAt: alerts.endedAt })
    .from(alerts)
    .where(eq(alerts.id, about.alertId))
    .limit(1)
  if (existing === undefined) return refused('alert_not_found')
  if (existing.endedAt !== null) return refused('alert_already_ended')

  // The instant comes from the database rather than this process, the same as
  // every other `now()` here: an application clock a minute off would put the
  // ending and the audit entry recording it at two different times.
  const [ended] = await db
    .update(alerts)
    .set({ endedAt: sql`now()`, endedBy: actorVolunteerId, endingReason: about.reason.trim() })
    .where(eq(alerts.id, about.alertId))
    .returning({ endedAt: alerts.endedAt })

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'alert',
      entityId: about.alertId,
      field: 'ended_at',
      before: null,
      after: ended?.endedAt?.toISOString() ?? null,
      reason: about.reason.trim(),
    },
  ])

  return recorded(null)
}
