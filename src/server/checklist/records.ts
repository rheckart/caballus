/**
 * The Task catalogue: creating and editing a Task (`CONTEXT.md`'s Task; ADR
 * 0013).
 *
 * **What the rescue may choose among is fixed** — subject kind, priority,
 * period, whether it needs Medication Authority, an optional Condition gate,
 * an optional Prep target, a nullable tolerance, the closing flag, and
 * instruction text — and this module writes exactly those fields and nothing
 * the rescue invented, the same discipline `createProduct` follows for its own
 * catalogue.
 *
 * Current state plus an audit entry (ADR 0003): a Task is edited in place, and
 * a mistyped instruction is a correction rather than a new plan somebody
 * executed under the old one.
 */
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { tasks } from '../../db/schema'
import type { ShiftType } from '../../shared/feed-schedule'
import type { TaskPeriod, TaskPriority, TaskSubjectKind } from '../../shared/materialization'
import type { ConditionName } from '../../shared/weather'
import { audit, type AuditEntry } from '../roster/audit'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

export interface NewTask {
  readonly subjectKind: TaskSubjectKind
  readonly priority: TaskPriority
  readonly period: TaskPeriod
  readonly requiresMedicationAuthority: boolean
  readonly conditionName?: ConditionName | null
  readonly prepForShiftType?: ShiftType | null
  readonly toleranceCount?: number | null
  readonly closing: boolean
  readonly instructionText: string
}

/** Creates a Task. */
export async function createTask(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  details: NewTask,
): Promise<Recorded<{ id: string }>> {
  const id = uuidv7()
  const instructionText = details.instructionText.trim()
  await db.insert(tasks).values({
    id,
    orgId,
    subjectKind: details.subjectKind,
    priority: details.priority,
    period: details.period,
    requiresMedicationAuthority: details.requiresMedicationAuthority,
    conditionName: details.conditionName ?? null,
    prepForShiftType: details.prepForShiftType ?? null,
    toleranceCount: details.toleranceCount ?? null,
    closing: details.closing,
    instructionText,
    createdBy: actorVolunteerId,
  })

  await audit(db, orgId, actorVolunteerId, [
    { entity: 'task', entityId: id, after: instructionText },
  ])

  return recorded({ id })
}

interface TaskEdit {
  readonly taskId: string
  readonly priority?: TaskPriority
  readonly requiresMedicationAuthority?: boolean
  readonly conditionName?: ConditionName | null
  readonly prepForShiftType?: ShiftType | null
  readonly toleranceCount?: number | null
  readonly closing?: boolean
  readonly instructionText?: string
  readonly reason?: string | null
}

/**
 * Edits a Task in place, auditing only the fields actually sent and actually
 * changed — the same before/after discipline `editProduct` follows.
 *
 * `subjectKind` and `period` are not editable here: either changes what every
 * Item this Task has already produced meant, which is a bigger act than a
 * catalogue correction and is left to retiring the Task and creating another.
 */
export async function editTask(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: TaskEdit,
): Promise<Recorded> {
  const [existing] = await db
    .select({
      priority: tasks.priority,
      requiresMedicationAuthority: tasks.requiresMedicationAuthority,
      conditionName: tasks.conditionName,
      prepForShiftType: tasks.prepForShiftType,
      toleranceCount: tasks.toleranceCount,
      closing: tasks.closing,
      instructionText: tasks.instructionText,
    })
    .from(tasks)
    .where(eq(tasks.id, about.taskId))
    .limit(1)
  if (existing === undefined) return refused('task_not_found')

  const before = existing
  const after = {
    priority: about.priority ?? before.priority,
    requiresMedicationAuthority:
      about.requiresMedicationAuthority ?? before.requiresMedicationAuthority,
    conditionName: 'conditionName' in about ? (about.conditionName ?? null) : before.conditionName,
    prepForShiftType:
      'prepForShiftType' in about ? (about.prepForShiftType ?? null) : before.prepForShiftType,
    toleranceCount:
      'toleranceCount' in about ? (about.toleranceCount ?? null) : before.toleranceCount,
    closing: about.closing ?? before.closing,
    instructionText:
      about.instructionText !== undefined ? about.instructionText.trim() : before.instructionText,
  }

  const next: Record<string, string | number | boolean | null> = {}
  const entries: AuditEntry[] = []
  const fields: readonly (readonly [string, keyof typeof after])[] = [
    ['priority', 'priority'],
    ['requires_medication_authority', 'requiresMedicationAuthority'],
    ['condition_name', 'conditionName'],
    ['prep_for_shift_type', 'prepForShiftType'],
    ['tolerance_count', 'toleranceCount'],
    ['closing', 'closing'],
    ['instruction_text', 'instructionText'],
  ]
  for (const [field, column] of fields) {
    if (after[column] === before[column]) continue
    next[column] = after[column]
    entries.push({
      entity: 'task',
      entityId: about.taskId,
      field,
      before: before[column] === null ? null : String(before[column]),
      after: after[column] === null ? null : String(after[column]),
      reason: about.reason ?? null,
    })
  }

  if (Object.keys(next).length > 0) {
    await db.update(tasks).set(next).where(eq(tasks.id, about.taskId))
  }
  await audit(db, orgId, actorVolunteerId, entries)

  return recorded(null)
}
