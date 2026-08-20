/**
 * Materialization: which Items a day's Shifts get, and what each one carries
 * (`CONTEXT.md`'s Item; ADR 0013).
 *
 * Pure, for the reason `src/shared/conditions.ts` and `src/shared/generation.ts`
 * are: the database read answers *what does the catalogue say, what did the
 * rescue decide, what did the Reading resolve*, and everything past those
 * points is arithmetic a table of inputs can exercise directly.
 *
 * **Feed and Medicate bypass the Task Assignment mechanism entirely.** ADR
 * 0013 is explicit that the split is computed from a Feed Schedule line's
 * Product kind rather than declared, so this module derives them straight
 * from the current Feed Schedule lines the caller resolved — no Task record
 * stands behind either.
 *
 * **Every other Task routes through Task Assignment**, generalizing the
 * `GROOM` column: `assigned` names the Shift Type that normally does it,
 * `deliberately_none` is a real decision that no Item should exist, and the
 * absence of a row is **not yet decided** — which still produces an Item,
 * because ADR 0013 refuses to let an unanswered question read as no work.
 *
 * **Determinism is the whole of "run twice, nothing doubles".** This function
 * is a pure derivation of its inputs: the same Tasks, Assignments, Shifts,
 * Feed lines and Condition answers produce the same Items, identified by the
 * same `materializationKey` — and the caller's unique index on that key is
 * what holds when two runs overlap, the same pairing `shiftsToGenerate` and
 * the `shifts_occurrence` index make for generation.
 */
import type { ConditionName } from './weather'
import { CONDITION_SPECS } from './weather'
import type { ShiftType } from './feed-schedule'
import { ITEM_FOR_PRODUCT_KIND, isProductKind } from './products'
import type { DayString } from './time'

/** Who a Task or an Item is about (ADR 0013). */
export const TASK_SUBJECT_KINDS = ['horse', 'space', 'rescue'] as const

export type TaskSubjectKind = (typeof TASK_SUBJECT_KINDS)[number]

export function isTaskSubjectKind(stored: string): stored is TaskSubjectKind {
  return (TASK_SUBJECT_KINDS as readonly string[]).includes(stored)
}

/** Whether an Item may be Dropped at all — Discretionary only (ADR 0013). */
export const TASK_PRIORITIES = ['essential', 'discretionary'] as const

export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export function isTaskPriority(stored: string): stored is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(stored)
}

/** Whether a Task belongs to one Shift or to the whole day (ADR 0013). */
export const TASK_PERIODS = ['shift', 'day'] as const

export type TaskPeriod = (typeof TASK_PERIODS)[number]

export function isTaskPeriod(stored: string): stored is TaskPeriod {
  return (TASK_PERIODS as readonly string[]).includes(stored)
}

/** The three states a Task Assignment holds, the same shape a Threshold's stance does (ADR 0015). */
export const TASK_ASSIGNMENT_STANCES = ['assigned', 'deliberately_none'] as const

export type TaskAssignmentStance = (typeof TASK_ASSIGNMENT_STANCES)[number]

export function isTaskAssignmentStance(stored: string): stored is TaskAssignmentStance {
  return (TASK_ASSIGNMENT_STANCES as readonly string[]).includes(stored)
}

/** What kind of Item this is — the two Feed Schedule–derived kinds, or a catalogue Task. */
export const ITEM_KINDS = ['feed', 'medicate', 'task'] as const

export type ItemKind = (typeof ITEM_KINDS)[number]

/** A Subject, as the derivations below need to see one. `null` is the rescue. */
export interface Subject {
  readonly horseId: string | null
  readonly spaceId: string | null
}

const RESCUE_SUBJECT: Subject = { horseId: null, spaceId: null }

/** One Task from the catalogue, as materialization reads it. */
export interface TaskCatalog {
  readonly id: string
  readonly subjectKind: TaskSubjectKind
  readonly priority: TaskPriority
  readonly period: TaskPeriod
  readonly requiresMedicationAuthority: boolean
  readonly conditionName: ConditionName | null
  readonly prepForShiftType: ShiftType | null
  readonly closing: boolean
  /** Generic instruction text — shown first on every Item this Task produces. */
  readonly instructionText: string
}

/** The current Task Assignment for one (Task, Subject) pair, where one exists. */
export interface TaskAssignmentRecord {
  readonly taskId: string
  readonly horseId: string | null
  readonly spaceId: string | null
  readonly stance: TaskAssignmentStance
  /** Set exactly when `stance` is `assigned`. */
  readonly shiftType: ShiftType | null
  /** Subject-specific instruction text — shown second on the Item. */
  readonly instructionText: string | null
}

/** A Shift-occurrence of the day, as far as materialization needs to see one. */
export interface ShiftOccurrence {
  readonly id: string
  readonly shiftType: ShiftType
}

/** One current Feed Schedule line, resolved by the caller for one horse at one Shift Type. */
export interface FeedLine {
  readonly horseId: string
  readonly shiftType: ShiftType
  readonly productKind: string
}

/**
 * What a Reading resolved a Condition to for one Subject, carrying what to
 * cite.
 *
 * `shiftId` is `null` for a **day**-scoped Condition — one answer, shared by
 * every Shift of the day (`staying_in`) — and the specific Shift's id for a
 * **shift**-scoped one, evaluated against that Shift's own window and never
 * another's (ADR 0013, ADR 0015). The caller supplies one row per Shift for a
 * shift-scoped Condition, because AM and PM read different windows and may
 * answer differently.
 */
export interface ConditionAnswer {
  readonly condition: ConditionName
  /** The horse it is about, or `null` for the barn — `conditions.ts`'s own shape. */
  readonly horseId: string | null
  readonly shiftId: string | null
  readonly holds: boolean | null
  readonly readingId: string
}

export interface MaterializeInput {
  readonly day: DayString
  /** The day's Feed AM, Feed PM and Lunch occurrences — Pop-ups author their own list (ADR 0013) and are never passed here. */
  readonly shifts: readonly ShiftOccurrence[]
  readonly tasks: readonly TaskCatalog[]
  readonly assignments: readonly TaskAssignmentRecord[]
  readonly horses: readonly { readonly id: string }[]
  readonly spaces: readonly { readonly id: string }[]
  readonly feedLines: readonly FeedLine[]
  readonly conditionAnswers: readonly ConditionAnswer[]
}

/** One materialized Item — the frozen decision this module hands the caller to write down. */
export interface MaterializedItem {
  /** The deterministic identity that makes a second run create nothing twice. */
  readonly key: string
  readonly day: DayString
  /** `null` for a per-Day Item, which belongs to the day rather than to one Shift (ADR 0013). */
  readonly shiftId: string | null
  readonly kind: ItemKind
  /** `null` for `feed` and `medicate`, which are derived rather than declared. */
  readonly taskId: string | null
  readonly subjectKind: TaskSubjectKind
  readonly horseId: string | null
  readonly spaceId: string | null
  readonly priority: TaskPriority
  readonly requiresMedicationAuthority: boolean
  readonly instructionText: string
  readonly assignedShiftType: ShiftType | null
  /** True for a Horse or Space Subject with no Task Assignment row at all — an unanswered question, never no work. */
  readonly assignmentUndecided: boolean
  readonly prepForShiftType: ShiftType | null
  readonly closing: boolean
  readonly conditionName: ConditionName | null
  readonly conditionReadingId: string | null
}

/** Every Item the day's Shifts get, deterministically (ADR 0013). */
export function materializeDay(input: MaterializeInput): readonly MaterializedItem[] {
  const items: MaterializedItem[] = [...feedingItems(input), ...taskItems(input)]
  return items
}

function feedingItems(input: MaterializeInput): readonly MaterializedItem[] {
  const items: MaterializedItem[] = []

  for (const shift of input.shifts) {
    const byHorse = new Map<string, FeedLine[]>()
    for (const line of input.feedLines) {
      if (line.shiftType !== shift.shiftType) continue
      const held = byHorse.get(line.horseId) ?? []
      held.push(line)
      byHorse.set(line.horseId, held)
    }

    for (const [horseId, lines] of byHorse) {
      // A kind this build does not know generates nothing, the same call
      // `isProductKind` exists to let a read make: a row can outrun a deploy,
      // and guessing it into the Feed Item is how a horse is told to eat
      // something nobody here can name (#58).
      const itemFor = (line: FeedLine): 'feed' | 'medicate' | null =>
        isProductKind(line.productKind) ? ITEM_FOR_PRODUCT_KIND[line.productKind] : null
      const feeding = lines.filter((line) => itemFor(line) === 'feed')
      const medicating = lines.filter((line) => itemFor(line) === 'medicate')

      if (feeding.length > 0) {
        items.push(feedOrMedicateItem('feed', shift, horseId, false, input.day))
      }
      if (medicating.length > 0) {
        items.push(feedOrMedicateItem('medicate', shift, horseId, true, input.day))
      }
    }
  }

  return items
}

function feedOrMedicateItem(
  kind: 'feed' | 'medicate',
  shift: ShiftOccurrence,
  horseId: string,
  requiresMedicationAuthority: boolean,
  day: DayString,
): MaterializedItem {
  return {
    key: itemKey([day, shift.id, kind, 'none', horseId, 'none']),
    day,
    shiftId: shift.id,
    kind,
    taskId: null,
    subjectKind: 'horse',
    horseId,
    spaceId: null,
    priority: 'essential',
    requiresMedicationAuthority,
    instructionText:
      kind === 'feed'
        ? 'Feed per the current Feed Schedule.'
        : 'Medicate per the current Feed Schedule.',
    assignedShiftType: null,
    assignmentUndecided: false,
    prepForShiftType: null,
    closing: false,
    conditionName: null,
    conditionReadingId: null,
  }
}

function taskItems(input: MaterializeInput): readonly MaterializedItem[] {
  const items: MaterializedItem[] = []

  for (const task of input.tasks) {
    const subjects = subjectsFor(task.subjectKind, input.horses, input.spaces)

    if (task.period === 'shift') {
      for (const shift of input.shifts) {
        for (const subject of subjects) {
          const item = itemFor(task, subject, input, shift.id)
          if (item !== null) items.push(item)
        }
      }
    } else {
      for (const subject of subjects) {
        const item = itemFor(task, subject, input, null)
        if (item !== null) items.push(item)
      }
    }
  }

  return items
}

function subjectsFor(
  kind: TaskSubjectKind,
  horses: readonly { readonly id: string }[],
  spaces: readonly { readonly id: string }[],
): readonly Subject[] {
  switch (kind) {
    case 'horse':
      return horses.map((horse) => ({ horseId: horse.id, spaceId: null }))
    case 'space':
      return spaces.map((space) => ({ horseId: null, spaceId: space.id }))
    case 'rescue':
      return [RESCUE_SUBJECT]
  }
}

function itemFor(
  task: TaskCatalog,
  subject: Subject,
  input: MaterializeInput,
  shiftId: string | null,
): MaterializedItem | null {
  const assignment = input.assignments.find(
    (row) =>
      row.taskId === task.id && row.horseId === subject.horseId && row.spaceId === subject.spaceId,
  )

  // A real decision that this Task does not apply to this Subject — the
  // rescue said so, and that is not the same fact as nobody having answered
  // yet (ADR 0013, ADR 0015's tri-state).
  if (assignment?.stance === 'deliberately_none') return null

  let conditionReadingId: string | null = null
  if (task.conditionName !== null) {
    const answer = conditionAnswerFor(task.conditionName, task.subjectKind, subject, shiftId, input)
    // Unresolved is not false (ADR 0015): an Item whose Condition could not be
    // answered does not materialize, the same way a false one would not —
    // there is nothing yet to cite.
    if (answer === undefined || answer.holds !== true) return null
    conditionReadingId = answer.readingId
  }

  const instructionText =
    assignment?.instructionText != null && assignment.instructionText !== ''
      ? `${task.instructionText} ${assignment.instructionText}`
      : task.instructionText

  return {
    key: itemKey([
      input.day,
      shiftId ?? 'day',
      'task',
      task.id,
      subject.horseId ?? 'none',
      subject.spaceId ?? 'none',
    ]),
    day: input.day,
    shiftId,
    kind: 'task',
    taskId: task.id,
    subjectKind: task.subjectKind,
    horseId: subject.horseId,
    spaceId: subject.spaceId,
    priority: task.priority,
    requiresMedicationAuthority: task.requiresMedicationAuthority,
    instructionText,
    assignedShiftType: assignment?.stance === 'assigned' ? assignment.shiftType : null,
    assignmentUndecided: assignment === undefined,
    prepForShiftType: task.prepForShiftType,
    closing: task.closing,
    conditionName: task.conditionName,
    conditionReadingId,
  }
}

/**
 * The Condition answer this Item's gate reads.
 *
 * A rescue-scoped Condition (`staying_in`, `cold_and_wet`, `fly_sheet_weather`)
 * answers with the barn's own resolution — `horseId: null` — regardless of
 * whose Item is asking, which is what lets a horse-subject Task (the
 * staying-in hay plan) and a rescue-subject Task share one barn-wide answer.
 * A horse-scoped Condition (`sheet_weather`, `blanket_weather`) answers with
 * this Subject's own horse.
 *
 * **A day-scoped Condition answers once, shared by every Shift** (`shiftId:
 * null`); a **shift-scoped** one answers per Shift, evaluated against that
 * Shift's own window, so this only matches an answer carrying the Item's own
 * `shiftId` (ADR 0013, ADR 0015).
 */
function conditionAnswerFor(
  condition: ConditionName,
  subjectKind: TaskSubjectKind,
  subject: Subject,
  shiftId: string | null,
  input: MaterializeInput,
): ConditionAnswer | undefined {
  const spec = CONDITION_SPECS[condition]
  const relevantHorseId = spec.subject === 'rescue' ? null : subject.horseId
  if (spec.subject === 'horse' && subjectKind !== 'horse') return undefined
  const relevantShiftId = spec.scope === 'day' ? null : shiftId

  return input.conditionAnswers.find(
    (answer) =>
      answer.condition === condition &&
      answer.horseId === relevantHorseId &&
      answer.shiftId === relevantShiftId,
  )
}

function itemKey(parts: readonly string[]): string {
  return parts.join(':')
}
