/**
 * Materialization, run server-side: gathers what the catalogue, the Feed
 * Schedules, the Task Assignments and the day's Reading say, hands it to the
 * pure `materializeDay` and writes down what it decided (`CONTEXT.md`'s Item;
 * ADR 0013).
 *
 * **Idempotency is decided in the pure module and enforced by the unique
 * index on `materializationKey`**, the same pairing `shiftsToGenerate` and
 * `shifts_occurrence` make for generation (#39): this reads what already
 * exists is irrelevant, because `onConflictDoNothing` on that index is what
 * makes a second run create nothing twice, whether this or a concurrent call
 * runs it.
 *
 * **A Condition is evaluated per Shift against that Shift's own window, at
 * materialization** (ADR 0013, ADR 0015) — not reused from the day-level
 * resolution `/weather/readings` stores, which stands in for a Shift with a
 * day's window until a Shift exists to give it one. This is that Shift.
 */
import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import {
  horses,
  horseSpaceAssignments,
  itemOutcomes,
  items,
  shifts,
  spaces,
  volunteers,
} from '../../db/schema'
import { currentFeedSchedulesByHorse } from '../horses/feed-schedules'
import { resolveConditions, windowFor, type HourReading } from '../../shared/conditions'
import { isShiftType, type ShiftType } from '../../shared/feed-schedule'
import {
  materializeDay,
  type ConditionAnswer,
  type FeedLine,
  type MaterializedItem,
  type ShiftOccurrence,
  type TaskCatalog,
} from '../../shared/materialization'
import { instant, type DayString, type Instant } from '../../shared/time'
import { conditionsScoped, isConditionName, type ConditionName } from '../../shared/weather'
import { currentTaskAssignments, taskList, type TaskAssignmentRow } from './assignments'
import { addDays, dayBounds, instantOfTimestamp, startOfShift } from '../time'
import { currentThresholds } from '../weather/thresholds'
import { readingFor } from '../weather/readings'

/** The day's regular Shift occurrences — Pop-ups author their own list and are never materialized against (ADR 0013). */
async function shiftsOfDay(
  db: OrgScopedDatabase,
  day: DayString,
): Promise<
  readonly { readonly id: string; readonly shiftType: ShiftType; readonly startTime: string }[]
> {
  const rows = await db
    .select({ id: shifts.id, shiftType: shifts.shiftType, startTime: shifts.startTime })
    .from(shifts)
    .where(eq(shifts.day, day))
    .orderBy(shifts.startTime)

  return rows.flatMap((row) =>
    isShiftType(row.shiftType) ? [{ ...row, shiftType: row.shiftType }] : [],
  )
}

/**
 * The Condition answers materialization gates on: the day's shared answers,
 * and one row per Shift for a shift-scoped Condition — evaluated against that
 * Shift's own window, from its start until the next Shift begins or the day
 * ends (`windowFor`, ADR 0015).
 *
 * `null` where nothing has fixed the day's weather yet: an Item gated on a
 * Condition simply does not materialize, which is the same honest degrade
 * `resolveConditions` gives an unresolved answer.
 */
async function conditionAnswersForDay(
  db: OrgScopedDatabase,
  day: DayString,
  timeZone: string,
  shiftRows: readonly { readonly id: string; readonly startTime: string }[],
  horseIds: readonly string[],
): Promise<readonly ConditionAnswer[]> {
  const reading = await readingFor(db, day)
  if (reading === null) return []

  const thresholds = await currentThresholds(db, day)
  const here = horseIds.map((id) => ({ id }))
  const hours: readonly HourReading[] = reading.hours.map((hour) => ({
    at: instant(hour.at),
    day: hour.day,
    hour: hour.hour,
    airTempF: hour.airTempF,
    apparentTempF: hour.apparentTempF,
    precipitation: hour.precipitation,
  }))

  const bounds = dayBounds(day, timeZone)
  const dayWindow = { from: bounds.start, to: bounds.end }

  const answers: ConditionAnswer[] = resolveConditions({
    conditions: conditionsScoped('day'),
    hours,
    window: windowFor('day', { day: dayWindow }),
    thresholds: thresholds.set,
    horses: here,
  }).map((resolution) => ({
    condition: resolution.condition,
    horseId: resolution.horseId,
    shiftId: null,
    holds: resolution.holds,
    readingId: reading.id,
  }))

  const starts = shiftRows
    .map((row) => ({ id: row.id, startsAt: startOfShift(day, row.startTime, timeZone) }))
    .sort((left, right) => left.startsAt - right.startsAt)

  for (const [index, shift] of starts.entries()) {
    const nextStartsAt = starts[index + 1]?.startsAt ?? null
    const window = windowFor('shift', {
      day: dayWindow,
      shift: { startsAt: shift.startsAt, nextStartsAt },
    })
    const resolved = resolveConditions({
      conditions: conditionsScoped('shift'),
      hours,
      window,
      thresholds: thresholds.set,
      horses: here,
    })
    for (const resolution of resolved) {
      answers.push({
        condition: resolution.condition,
        horseId: resolution.horseId,
        shiftId: shift.id,
        holds: resolution.holds,
        readingId: reading.id,
      })
    }
  }

  return answers
}

export interface MaterializationResult {
  readonly day: DayString
  readonly created: number
}

/**
 * Materializes every Item the day's Shifts want, and writes down the ones
 * that do not already exist.
 *
 * Deliberate and safe to repeat (ADR 0013, the same discipline `/shifts/
 * generation` and `/weather/readings` follow): the pure `materializeDay`
 * decides the full set from scratch every time, and `onConflictDoNothing` on
 * `materializationKey` is what makes writing it down twice a no-op rather
 * than a duplicate.
 */
export async function materializeDayFor(
  db: OrgScopedDatabase,
  orgId: OrgId,
  day: DayString,
  timeZone: string,
): Promise<MaterializationResult> {
  const [shiftRows, taskRows, assignmentRows, horseRows, spaceRows, feedByHorse] =
    await Promise.all([
      shiftsOfDay(db, day),
      taskList(db),
      currentTaskAssignments(db, day),
      db.select({ id: horses.id }).from(horses).where(isNull(horses.departedOn)),
      db.select({ id: spaces.id }).from(spaces),
      currentFeedSchedulesByHorse(db, day),
    ])

  const shiftOccurrences: readonly ShiftOccurrence[] = shiftRows.map((row) => ({
    id: row.id,
    shiftType: row.shiftType,
  }))

  const feedLines: FeedLine[] = []
  for (const [horseId, schedules] of feedByHorse) {
    for (const schedule of schedules) {
      for (const line of schedule.lines) {
        feedLines.push({ horseId, shiftType: schedule.shiftType, productKind: line.productKind })
      }
    }
  }

  const tasks: readonly TaskCatalog[] = taskRows

  const assignments: TaskAssignmentRow[] = [...assignmentRows]

  const conditionAnswers = await conditionAnswersForDay(
    db,
    day,
    timeZone,
    shiftRows,
    horseRows.map((row) => row.id),
  )

  const materialized = materializeDay({
    day,
    shifts: shiftOccurrences,
    tasks,
    assignments,
    horses: horseRows,
    spaces: spaceRows,
    feedLines,
    conditionAnswers,
  })

  if (materialized.length === 0) return { day, created: 0 }

  const inserted = await db
    .insert(items)
    .values(materialized.map((item) => rowOf(orgId, item)))
    .onConflictDoNothing({ target: [items.orgId, items.materializationKey] })
    .returning({ id: items.id })

  return { day, created: inserted.length }
}

function rowOf(orgId: OrgId, item: MaterializedItem) {
  return {
    id: uuidv7(),
    orgId,
    day: item.day,
    shiftId: item.shiftId,
    kind: item.kind,
    taskId: item.taskId,
    subjectKind: item.subjectKind,
    horseId: item.horseId,
    spaceId: item.spaceId,
    priority: item.priority,
    requiresMedicationAuthority: item.requiresMedicationAuthority,
    instructionText: item.instructionText,
    assignedShiftType: item.assignedShiftType,
    assignmentUndecided: item.assignmentUndecided,
    prepForShiftType: item.prepForShiftType,
    closing: item.closing,
    conditionName: item.conditionName,
    conditionReadingId: item.conditionReadingId,
    materializationKey: item.key,
  }
}

export interface ChecklistItem {
  readonly id: string
  readonly kind: 'feed' | 'medicate' | 'task'
  readonly subjectKind: 'horse' | 'space' | 'rescue'
  readonly horseId: string | null
  readonly horseName: string | null
  /** The horse's own stall, where it has one — what a card sorts by (#42). */
  readonly horseStallName: string | null
  readonly spaceId: string | null
  readonly spaceName: string | null
  readonly priority: 'essential' | 'discretionary'
  readonly requiresMedicationAuthority: boolean
  readonly instructionText: string
  readonly assignedShiftType: ShiftType | null
  readonly assignmentUndecided: boolean
  readonly prepForShiftType: ShiftType | null
  readonly closing: boolean
  readonly conditionName: ConditionName | null
  /** Whether the latest claim against this Item is `done` (ADR 0013, #42). */
  readonly done: boolean
  readonly doneAt: Instant | null
  readonly doneByName: string | null
}

export interface Checklist {
  readonly materialized: boolean
  readonly items: readonly ChecklistItem[]
  /** Prep Items owed to this Shift's own Shift Type, from earlier Shifts today or the day before. */
  readonly prepOwed: readonly ChecklistItem[]
}

/**
 * The checklist a Shift shows on opening: its own Items, plus the day's
 * per-Day ones — either Shift satisfies those, so they are not duplicated per
 * Shift (ADR 0013) — grouped by Subject at the read rather than left to every
 * screen to regroup.
 *
 * `materialized: false` with an empty list is the honest answer for a Shift
 * whose day nothing has materialized yet, rather than a live preview this
 * ticket does not build — the same kind of deferral ADR 0017 records for the
 * gate that is not armed.
 */
export async function checklistForShift(
  db: OrgScopedDatabase,
  shift: { readonly id: string; readonly day: DayString; readonly shiftType: ShiftType },
  timeZone: string,
): Promise<Checklist> {
  // Prep crosses midnight (feed cans and bedding carts filled "for next
  // shift"), so the search reaches back one day rather than only today's —
  // and never past yesterday, which is as far back as a Shift Type's most
  // recent Prep could still be owed (ADR 0013).
  const yesterday = addDays(shift.day, -1, timeZone)

  const [ownRows, prepRows] = await Promise.all([
    db
      .select(SELECTED)
      .from(items)
      .leftJoin(horses, eq(horses.id, items.horseId))
      .leftJoin(spaces, eq(spaces.id, items.spaceId))
      .where(or(eq(items.shiftId, shift.id), and(isNull(items.shiftId), eq(items.day, shift.day)))),
    db
      .select(SELECTED)
      .from(items)
      .leftJoin(horses, eq(horses.id, items.horseId))
      .leftJoin(spaces, eq(spaces.id, items.spaceId))
      .where(
        and(
          eq(items.prepForShiftType, shift.shiftType),
          gte(items.day, yesterday),
          lte(items.day, shift.day),
        ),
      ),
  ])

  const [stallNames, outcomes] = await Promise.all([
    stallNamesFor(db),
    outcomesFor(
      db,
      [...ownRows, ...prepRows].map((row) => row.id),
    ),
  ])

  const materialized = ownRows.length > 0

  return {
    materialized,
    items: ownRows.map((row) => view(row, stallNames, outcomes)),
    prepOwed: prepRows.map((row) => view(row, stallNames, outcomes)),
  }
}

/** Every horse's own stall, by horse id — the Board's own `stall` kind (ADR 0002). */
async function stallNamesFor(db: OrgScopedDatabase): Promise<ReadonlyMap<string, string>> {
  const rows = await db
    .select({ horseId: horseSpaceAssignments.horseId, stallName: spaces.name })
    .from(horseSpaceAssignments)
    .innerJoin(spaces, eq(spaces.id, horseSpaceAssignments.spaceId))
    .where(eq(horseSpaceAssignments.kind, 'stall'))

  return new Map(rows.map((row) => [row.horseId, row.stallName]))
}

/**
 * The latest claim against each of `itemIds`, by id — "latest" because ADR
 * 0013 makes an Item's current outcome the newest of its append-only series,
 * never a value overwritten in place. Only `done` is ever written today
 * (#42), so this reads as *has anyone claimed it, and when, and who*.
 */
async function outcomesFor(
  db: OrgScopedDatabase,
  itemIds: readonly string[],
): Promise<
  ReadonlyMap<string, { readonly outcome: string; readonly at: Instant; readonly by: string }>
> {
  if (itemIds.length === 0) return new Map()

  const rows = await db
    .select({
      itemId: itemOutcomes.itemId,
      outcome: itemOutcomes.outcome,
      claimedAt: itemOutcomes.claimedAt,
      claimedByName: volunteers.name,
    })
    .from(itemOutcomes)
    .innerJoin(volunteers, eq(volunteers.id, itemOutcomes.claimedBy))
    .where(inArray(itemOutcomes.itemId, itemIds))
    .orderBy(itemOutcomes.claimedAt)

  // Ordered oldest first, so the last write for a given Item id in this loop
  // is the latest claim — no second pass to find a maximum.
  const by = new Map<string, { outcome: string; at: Instant; by: string }>()
  for (const row of rows) {
    by.set(row.itemId, {
      outcome: row.outcome,
      at: instantOfTimestamp(row.claimedAt),
      by: row.claimedByName,
    })
  }
  return by
}

const SELECTED = {
  id: items.id,
  kind: items.kind,
  subjectKind: items.subjectKind,
  horseId: items.horseId,
  horseName: horses.name,
  spaceId: items.spaceId,
  spaceName: spaces.name,
  priority: items.priority,
  requiresMedicationAuthority: items.requiresMedicationAuthority,
  instructionText: items.instructionText,
  assignedShiftType: items.assignedShiftType,
  assignmentUndecided: items.assignmentUndecided,
  prepForShiftType: items.prepForShiftType,
  closing: items.closing,
  conditionName: items.conditionName,
}

function view(
  row: {
    readonly id: string
    readonly kind: string
    readonly subjectKind: string
    readonly horseId: string | null
    readonly horseName: string | null
    readonly spaceId: string | null
    readonly spaceName: string | null
    readonly priority: string
    readonly requiresMedicationAuthority: boolean
    readonly instructionText: string
    readonly assignedShiftType: string | null
    readonly assignmentUndecided: boolean
    readonly prepForShiftType: string | null
    readonly closing: boolean
    readonly conditionName: string | null
  },
  stallNames: ReadonlyMap<string, string>,
  outcomes: ReadonlyMap<
    string,
    { readonly outcome: string; readonly at: Instant; readonly by: string }
  >,
): ChecklistItem {
  const latest = outcomes.get(row.id) ?? null

  return {
    id: row.id,
    kind: row.kind === 'feed' || row.kind === 'medicate' ? row.kind : 'task',
    subjectKind:
      row.subjectKind === 'horse' || row.subjectKind === 'space' ? row.subjectKind : 'rescue',
    horseId: row.horseId,
    horseName: row.horseName,
    horseStallName: row.horseId === null ? null : (stallNames.get(row.horseId) ?? null),
    spaceId: row.spaceId,
    spaceName: row.spaceName,
    priority: row.priority === 'discretionary' ? 'discretionary' : 'essential',
    requiresMedicationAuthority: row.requiresMedicationAuthority,
    instructionText: row.instructionText,
    assignedShiftType:
      row.assignedShiftType !== null && isShiftType(row.assignedShiftType)
        ? row.assignedShiftType
        : null,
    assignmentUndecided: row.assignmentUndecided,
    prepForShiftType:
      row.prepForShiftType !== null && isShiftType(row.prepForShiftType)
        ? row.prepForShiftType
        : null,
    closing: row.closing,
    conditionName:
      row.conditionName !== null && isConditionName(row.conditionName) ? row.conditionName : null,
    done: latest?.outcome === 'done',
    doneAt: latest === null ? null : latest.at,
    doneByName: latest === null ? null : latest.by,
  }
}
