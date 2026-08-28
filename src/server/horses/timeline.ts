/**
 * A horse's Timeline, and the list of horses with something going on (#74).
 *
 * The rescue's Facebook group is where somebody goes to ask *what is going on
 * with Storm*. The app already holds the answer and holds it scattered across
 * four screens, none of which is the horse. This module is the join, and it is
 * **a read and nothing else** — nothing is authored here, nothing is stored,
 * and a record reached through it is the same record reached anywhere else.
 *
 * **Composed server-side, in one read**, on `/board`'s and `/home`'s own
 * precedent: a second call the profile fires alongside the rest leaves the
 * horse looking eventless whenever it is slow, which is exactly the half-loaded
 * screen #60 refused on the Board.
 *
 * **The Alerts are handed in rather than read again.** `horseById` has already
 * fetched them for the profile's own two lists, and `/horses/:horseId` is the
 * only caller — reading them a second time would be two extra round trips on
 * every profile load for rows the request is already holding.
 *
 * **Two of the five kinds need their own select and three do not.** An
 * Observation comes from `observationsAboutHorse` and an Alert from
 * `alertsForHorse`, both of which already carry the actor's name and the
 * moment. A measurement and a Feed Schedule version do not: `measurementsFor`
 * answers a *series* — oldest first, no `recordedAt`, no name — and
 * `currentFeedSchedulesFor` answers only what is current, which is the opposite
 * of what a Timeline wants. Widening either to serve this would make the horse
 * profile's own reads pay for a section they do not show, so this module reads
 * those two rows itself.
 *
 * **There is no `has_issues` column and no `watching` table.** The list of
 * horses with something going on is derived on every read from the two facts
 * that already stand — an open Escalation and a standing Alert — so closing the
 * one or ending the other drops her out with nothing to remember to update.
 */
import { desc, eq, inArray, isNull } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import {
  alerts,
  feedScheduleVersions,
  horseMeasurements,
  horses,
  volunteers,
} from '../../db/schema'
import { isAlertKind, type AlertKind } from '../../shared/alerts'
import { isShiftType, type ShiftType } from '../../shared/feed-schedule'
import { isMeasurementKind, type MeasurementKind } from '../../shared/measurements'
import { compareTimeline, type TimelineKind } from '../../shared/timeline'
import { dayString, instant, type DayString, type Instant } from '../../shared/time'
import {
  newestOpenEscalationByHorse,
  observationsAboutHorse,
  type HorseEscalation,
} from '../observations/list'
import { dayOf, instantOfTimestamp } from '../time'
import { type Alert } from './alerts'

/**
 * What every entry carries, whatever kind it is: an id unique across the whole
 * Timeline, when it was **recorded**, and who recorded it.
 *
 * The id is prefixed with the kind because one Alert produces two entries — it
 * was raised and it was ended — and `compareTimeline` breaks a tie on the id.
 * Two entries sharing one would be two records the sort cannot separate.
 */
interface Entry {
  readonly id: string
  readonly kind: TimelineKind
  readonly at: Instant
  /** The same moment as the organisation's own day, resolved here (ADR 0007). */
  readonly on: DayString
  /** Null where the column is: a measurement predating the actor column, say. */
  readonly by: string | null
  readonly byName: string | null
}

export interface ObservationEntry extends Entry {
  readonly kind: 'observation'
  readonly text: string
  readonly subjectLabel: string | null
  readonly escalations: readonly HorseEscalation[]
}

export interface AlertRaisedEntry extends Entry {
  readonly kind: 'alert_raised'
  readonly alertKind: AlertKind
  readonly text: string
}

export interface AlertEndedEntry extends Entry {
  readonly kind: 'alert_ended'
  readonly alertKind: AlertKind
  readonly text: string
  /**
   * Required at the door (ADR 0024) and nullable here, because only the reason
   * answers *why the biting Alert is gone* and this is the surface #74 exists
   * to put that sentence on.
   */
  readonly reason: string | null
}

export interface MeasurementEntry extends Entry {
  readonly kind: 'measurement'
  readonly measurementKind: MeasurementKind
  readonly value: number
  readonly method: string | null
  /** The day it was taken, which is not the day it was written down. */
  readonly takenOn: DayString
}

export interface FeedScheduleEntry extends Entry {
  readonly kind: 'feed_schedule'
  readonly shiftType: ShiftType
  readonly validFrom: DayString
}

export type TimelineEntry =
  ObservationEntry | AlertRaisedEntry | AlertEndedEntry | MeasurementEntry | FeedScheduleEntry

/**
 * One horse's Timeline, newest first.
 *
 * A **Departed** horse keeps hers in full: the profile stays reachable so the
 * history never goes with the horse leaving (#35), and nothing here filters on
 * `departedOn`.
 */
export interface HorseAlerts {
  readonly standing: readonly Alert[]
  readonly ended: readonly Alert[]
}

export async function horseTimeline(
  db: OrgScopedDatabase,
  horseId: string,
  timeZone: string,
  alerts: HorseAlerts,
): Promise<readonly TimelineEntry[]> {
  const [observed, measured, published] = await Promise.all([
    observationsAboutHorse(db, horseId),
    measurementEntries(db, horseId, timeZone),
    feedScheduleEntries(db, horseId, timeZone),
  ])

  const entries: TimelineEntry[] = [...measured, ...published]

  for (const one of observed) {
    entries.push({
      id: `observation:${one.id}`,
      kind: 'observation',
      at: one.recordedAt,
      on: dayOf(one.recordedAt, timeZone),
      by: one.observedBy,
      byName: one.observedByName,
      text: one.text,
      subjectLabel: one.subjectLabel,
      escalations: one.escalations,
    })
  }

  // Raised and ended, both — *the biting alert was ended in March and here is
  // why* is exactly what a Timeline is for, and ADR 0024 keeps ended Alerts on
  // the profile alone.
  for (const one of [...alerts.standing, ...alerts.ended]) {
    if (!isAlertKind(one.kind)) continue
    entries.push({
      id: `alert_raised:${one.id}`,
      kind: 'alert_raised',
      at: instant(one.raisedAt),
      on: dayOf(instant(one.raisedAt), timeZone),
      by: one.raisedBy,
      byName: one.raisedByName,
      alertKind: one.kind,
      text: one.text,
    })
    if (one.endedAt === null) continue
    entries.push({
      id: `alert_ended:${one.id}`,
      kind: 'alert_ended',
      at: instant(one.endedAt),
      on: dayOf(instant(one.endedAt), timeZone),
      by: one.endedBy,
      byName: one.endedByName,
      alertKind: one.kind,
      text: one.text,
      reason: one.endingReason,
    })
  }

  return entries.sort(compareTimeline)
}

/**
 * A horse with something going on, and the newest sentence against her name.
 *
 * Two facts qualify and no third: an **open Escalation** and a **standing
 * Alert**. Both are already stated somewhere else, which is what makes this
 * derivable rather than a flag somebody has to remember to clear.
 */
export interface HorseAttention {
  readonly horseId: string
  readonly horseName: string
  /** Which of the two facts produced the sentence below. */
  readonly because: 'alert' | 'escalation'
  readonly text: string
  readonly at: Instant
}

/**
 * Every horse with an open Escalation or a standing Alert, newest sentence
 * first.
 *
 * **Departed horses leave the list** and keep their Timeline. A list of horses
 * needing something is a work surface, and a horse who is gone is not work —
 * which is the same reason `boardGrid` drops her from the Board while
 * `/horses/:horseId` still answers (#35, ADR 0022).
 */
export async function horsesNeedingAttention(
  db: OrgScopedDatabase,
): Promise<readonly HorseAttention[]> {
  const [here, standing, escalated] = await Promise.all([
    db.select({ id: horses.id, name: horses.name }).from(horses).where(isNull(horses.departedOn)),
    standingAlertSentences(db),
    newestOpenEscalationByHorse(db),
  ])

  const listed: HorseAttention[] = []
  for (const horse of here) {
    const alert = standing.get(horse.id) ?? null
    const escalation = escalated.get(horse.id) ?? null
    if (alert === null && escalation === null) continue

    // The newest of the two, because the question the list answers is *what is
    // going on with Storm* and the answer is the most recent thing anybody
    // said. Which of the two it came from travels with it, so the screen can
    // say whether it is a standing warning or an open report.
    const newest =
      escalation === null || (alert !== null && alert.at >= escalation.at)
        ? alert === null
          ? null
          : { because: 'alert' as const, text: alert.text, at: alert.at }
        : { because: 'escalation' as const, text: escalation.framing, at: escalation.at }
    if (newest === null) continue

    listed.push({ horseId: horse.id, horseName: horse.name, ...newest })
  }

  return listed.sort((left, right) =>
    left.at === right.at ? left.horseName.localeCompare(right.horseName) : right.at - left.at,
  )
}

/** The newest standing Alert on each horse, as a sentence and a moment. */
async function standingAlertSentences(
  db: OrgScopedDatabase,
): Promise<ReadonlyMap<string, { readonly text: string; readonly at: Instant }>> {
  const rows = await db
    .select({
      id: alerts.id,
      horseId: alerts.horseId,
      text: alerts.text,
      raisedAt: alerts.raisedAt,
    })
    .from(alerts)
    .where(isNull(alerts.endedAt))
    // The id breaks the tie, for `compareTimeline`'s own reason: two Alerts
    // raised in one act share a millisecond, and without it the database
    // decides which sentence the horse shows — differently on two reads.
    .orderBy(desc(alerts.raisedAt), desc(alerts.id))

  const newest = new Map<string, { text: string; at: Instant }>()
  for (const row of rows) {
    // Newest first above, so the first row for a horse wins and an older one
    // does not overwrite it.
    if (newest.has(row.horseId)) continue
    newest.set(row.horseId, { text: row.text, at: instantOfTimestamp(row.raisedAt) })
  }
  return newest
}

/** Every measurement this horse has, as Timeline entries. */
async function measurementEntries(
  db: OrgScopedDatabase,
  horseId: string,
  timeZone: string,
): Promise<readonly MeasurementEntry[]> {
  const rows = await db
    .select({
      id: horseMeasurements.id,
      kind: horseMeasurements.kind,
      value: horseMeasurements.value,
      method: horseMeasurements.method,
      takenOn: horseMeasurements.takenOn,
      recordedBy: horseMeasurements.recordedBy,
      recordedAt: horseMeasurements.recordedAt,
    })
    .from(horseMeasurements)
    .where(eq(horseMeasurements.horseId, horseId))

  const names = await namesOf(
    db,
    rows.map((row) => row.recordedBy),
  )
  return rows
    .filter((row) => isMeasurementKind(row.kind))
    .map((row) => ({
      id: `measurement:${row.id}`,
      kind: 'measurement' as const,
      at: instantOfTimestamp(row.recordedAt),
      on: dayOf(instantOfTimestamp(row.recordedAt), timeZone),
      by: row.recordedBy,
      byName: row.recordedBy === null ? null : (names.get(row.recordedBy) ?? null),
      measurementKind: row.kind as MeasurementKind,
      value: row.value,
      method: row.method,
      takenOn: dayString(row.takenOn),
    }))
}

/**
 * Every Feed Schedule version published for this horse, as Timeline entries.
 *
 * **Every version, not the current one.** ADR 0003's versioned tier stores the
 * change as a dated record with an actor precisely so *why is she on this now*
 * has an answer, and a Timeline showing only what is current would throw away
 * the question it exists to answer.
 */
async function feedScheduleEntries(
  db: OrgScopedDatabase,
  horseId: string,
  timeZone: string,
): Promise<readonly FeedScheduleEntry[]> {
  const rows = await db
    .select({
      id: feedScheduleVersions.id,
      shiftType: feedScheduleVersions.shiftType,
      validFrom: feedScheduleVersions.validFrom,
      createdBy: feedScheduleVersions.createdBy,
      createdAt: feedScheduleVersions.createdAt,
    })
    .from(feedScheduleVersions)
    .where(eq(feedScheduleVersions.horseId, horseId))

  const names = await namesOf(
    db,
    rows.map((row) => row.createdBy),
  )
  return rows
    .filter((row) => isShiftType(row.shiftType))
    .map((row) => ({
      id: `feed_schedule:${row.id}`,
      kind: 'feed_schedule' as const,
      at: instantOfTimestamp(row.createdAt),
      on: dayOf(instantOfTimestamp(row.createdAt), timeZone),
      by: row.createdBy,
      byName: row.createdBy === null ? null : (names.get(row.createdBy) ?? null),
      shiftType: row.shiftType as ShiftType,
      validFrom: dayString(row.validFrom),
    }))
}

/** Names for a set of possibly-null actor columns, in one read. */
async function namesOf(
  db: OrgScopedDatabase,
  ids: readonly (string | null)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))]
  if (wanted.length === 0) return new Map()
  const rows = await db
    .select({ id: volunteers.id, name: volunteers.name })
    .from(volunteers)
    .where(inArray(volunteers.id, wanted))
  return new Map(rows.map((row) => [row.id, row.name]))
}
