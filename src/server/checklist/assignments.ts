/**
 * Task Assignments: publishing a version, and reading what is currently in
 * force (`CONTEXT.md`'s Task Assignment; ADR 0013's generalization of the
 * `GROOM` column; ADR 0015's tri-state, reused rather than reinvented).
 *
 * **Editing publishes a version; it never updates a row**, the discipline
 * `publishThreshold` follows for its own three-valued record — and, like it,
 * **no audit entry**: a versioned-tier change *is* a version (ADR 0003).
 *
 * A Subject is a horse, a Space, or the rescue — `horseId` and `spaceId` are
 * both null for the rescue and exactly one is set otherwise, checked here
 * against the Task's own `subjectKind` so a Task Assignment can never name a
 * Subject its Task does not have.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { horses, spaces, taskAssignments, tasks } from '../../db/schema'
import type { ShiftType } from '../../shared/feed-schedule'
import {
  isTaskAssignmentStance,
  isTaskPeriod,
  isTaskPriority,
  isTaskSubjectKind,
  type TaskAssignmentStance,
  type TaskPeriod,
  type TaskPriority,
  type TaskSubjectKind,
} from '../../shared/materialization'
import { isConditionName, type ConditionName } from '../../shared/weather'
import { dayString, type DayString } from '../../shared/time'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

export interface TaskRecord {
  readonly id: string
  readonly subjectKind: TaskSubjectKind
  readonly priority: TaskPriority
  readonly period: TaskPeriod
  readonly requiresMedicationAuthority: boolean
  readonly conditionName: ConditionName | null
  readonly prepForShiftType: ShiftType | null
  readonly toleranceCount: number | null
  readonly closing: boolean
  readonly instructionText: string
}

/** The whole catalogue, in a stable order for a screen to render. */
export async function taskList(db: OrgScopedDatabase): Promise<readonly TaskRecord[]> {
  const rows = await db
    .select({
      id: tasks.id,
      subjectKind: tasks.subjectKind,
      priority: tasks.priority,
      period: tasks.period,
      requiresMedicationAuthority: tasks.requiresMedicationAuthority,
      conditionName: tasks.conditionName,
      prepForShiftType: tasks.prepForShiftType,
      toleranceCount: tasks.toleranceCount,
      closing: tasks.closing,
      instructionText: tasks.instructionText,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .orderBy(tasks.createdAt)

  return rows.flatMap((row): TaskRecord[] => {
    if (!isTaskSubjectKind(row.subjectKind) || !isTaskPriority(row.priority)) return []
    if (!isTaskPeriod(row.period)) return []
    if (row.conditionName !== null && !isConditionName(row.conditionName)) return []
    return [
      {
        id: row.id,
        subjectKind: row.subjectKind,
        priority: row.priority,
        period: row.period,
        requiresMedicationAuthority: row.requiresMedicationAuthority,
        conditionName: row.conditionName as ConditionName | null,
        prepForShiftType: row.prepForShiftType as ShiftType | null,
        toleranceCount: row.toleranceCount,
        closing: row.closing,
        instructionText: row.instructionText,
      },
    ]
  })
}

export interface NewTaskAssignment {
  readonly taskId: string
  readonly horseId: string | null
  readonly spaceId: string | null
  readonly stance: TaskAssignmentStance
  readonly shiftType: ShiftType | null
  readonly instructionText?: string | null
  readonly validFrom: DayString
}

/**
 * Publishes a Task Assignment version.
 *
 * The two refusals are both *this will not become true by retrying*: a
 * Subject that does not match this Task's `subjectKind`, and `assigned` naming
 * no Shift Type.
 */
export async function publishTaskAssignment(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: NewTaskAssignment,
): Promise<Recorded<{ id: string }>> {
  const [task] = await db
    .select({ subjectKind: tasks.subjectKind })
    .from(tasks)
    .where(eq(tasks.id, about.taskId))
    .limit(1)
  if (task === undefined) return refused('task_not_found')

  const subjectKind = isTaskSubjectKind(task.subjectKind) ? task.subjectKind : null
  const namesHorse = about.horseId !== null
  const namesSpace = about.spaceId !== null
  const matchesSubject =
    (subjectKind === 'horse' && namesHorse && !namesSpace) ||
    (subjectKind === 'space' && namesSpace && !namesHorse) ||
    (subjectKind === 'rescue' && !namesHorse && !namesSpace)
  if (!matchesSubject) return refused('subject_kind_mismatch')

  if (about.horseId !== null) {
    const [horse] = await db
      .select({ id: horses.id })
      .from(horses)
      .where(eq(horses.id, about.horseId))
      .limit(1)
    if (horse === undefined) return refused('horse_not_found')
  }
  if (about.spaceId !== null) {
    const [space] = await db
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.id, about.spaceId))
      .limit(1)
    if (space === undefined) return refused('space_not_found')
  }

  if (about.stance === 'assigned' && about.shiftType === null) return refused('shift_type_required')

  const id = uuidv7()
  await db.insert(taskAssignments).values({
    id,
    orgId,
    taskId: about.taskId,
    horseId: about.horseId,
    spaceId: about.spaceId,
    stance: about.stance,
    shiftType: about.stance === 'assigned' ? about.shiftType : null,
    instructionText: normalised(about.instructionText),
    validFrom: about.validFrom,
    createdBy: actorVolunteerId,
  })

  return recorded({ id })
}

function normalised(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export interface TaskAssignmentRow {
  readonly taskId: string
  readonly horseId: string | null
  readonly spaceId: string | null
  readonly stance: TaskAssignmentStance
  readonly shiftType: ShiftType | null
  readonly instructionText: string | null
  readonly validFrom: DayString
}

/**
 * Every Task Assignment in force on `today` — the same latest-by-`validFrom`
 * resolution `currentThresholds` and `currentFeedSchedulesByHorse` both make,
 * generalized from one Subject column to two.
 */
export async function currentTaskAssignments(
  db: OrgScopedDatabase,
  today: DayString,
): Promise<readonly TaskAssignmentRow[]> {
  const rows = await db
    .select({
      taskId: taskAssignments.taskId,
      horseId: taskAssignments.horseId,
      spaceId: taskAssignments.spaceId,
      stance: taskAssignments.stance,
      shiftType: taskAssignments.shiftType,
      instructionText: taskAssignments.instructionText,
      validFrom: taskAssignments.validFrom,
      createdAt: taskAssignments.createdAt,
    })
    .from(taskAssignments)

  interface Row {
    readonly taskId: string
    readonly horseId: string | null
    readonly spaceId: string | null
    readonly stance: TaskAssignmentStance
    readonly shiftType: string | null
    readonly instructionText: string | null
    readonly validFrom: string
    readonly createdAt: Date
  }

  const latest = new Map<string, Row>()
  for (const row of rows) {
    if (!isTaskAssignmentStance(row.stance)) continue
    if (row.validFrom > today) continue

    const at = `${row.taskId}:${row.horseId ?? 'none'}:${row.spaceId ?? 'none'}`
    const held = latest.get(at)
    if (
      held === undefined ||
      row.validFrom > held.validFrom ||
      (row.validFrom === held.validFrom && row.createdAt > held.createdAt)
    ) {
      latest.set(at, { ...row, stance: row.stance })
    }
  }

  return [...latest.values()].map((row) => ({
    taskId: row.taskId,
    horseId: row.horseId,
    spaceId: row.spaceId,
    stance: row.stance,
    shiftType: row.shiftType as ShiftType | null,
    instructionText: row.instructionText,
    validFrom: dayString(row.validFrom),
  }))
}

/** Every Subject a Task's `subjectKind` names, for the admin screen's owed-decisions list. */
export async function subjectsFor(
  db: OrgScopedDatabase,
  subjectKind: TaskSubjectKind,
): Promise<
  readonly {
    readonly horseId: string | null
    readonly spaceId: string | null
    readonly name: string
  }[]
> {
  switch (subjectKind) {
    case 'horse': {
      const rows = await db
        .select({ id: horses.id, name: horses.name })
        .from(horses)
        .where(and(isNull(horses.departedOn)))
        .orderBy(horses.name)
      return rows.map((row) => ({ horseId: row.id, spaceId: null, name: row.name }))
    }
    case 'space': {
      const rows = await db
        .select({ id: spaces.id, name: spaces.name })
        .from(spaces)
        .orderBy(spaces.name)
      return rows.map((row) => ({ horseId: null, spaceId: row.id, name: row.name }))
    }
    case 'rescue':
      return [{ horseId: null, spaceId: null, name: 'The rescue' }]
  }
}
