/**
 * The Task catalogue and Task Assignments (ADR 0013; `CONTEXT.md`'s Task and
 * Task Assignment).
 *
 * **What a Task may carry is fixed** — subject kind, priority, period,
 * whether it needs Medication Authority, an optional Condition gate, an
 * optional Prep target, a nullable tolerance, the closing flag, and
 * instruction text — this screen offers exactly those and nothing else, the
 * same fence `/admin/products` keeps around a Product.
 *
 * **Task Assignment is the tri-state ADR 0015 gave Thresholds, generalized**:
 * a Subject is assigned to a Shift Type, deliberately assigned to none, or
 * not yet decided — and the third state is said out loud as a question
 * somebody owes an answer to, never as agreement or as no work.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { client } from '../../shared/api-client'
import type { ShiftType } from '../../shared/feed-schedule'
import { SHIFT_TYPES } from '../../shared/feed-schedule'
import { refusalText } from '../../shared/refusals'
import { TASK_PERIODS, TASK_PRIORITIES, TASK_SUBJECT_KINDS } from '../../shared/materialization'
import type { Answers, contract } from '../../shared/api-contract'

export const Route = createFileRoute('/admin/tasks')({
  component: Tasks,
})

type TaskList = Answers<typeof contract, '/tasks'>
type Task = TaskList['tasks'][number]
type AssignmentList = Answers<typeof contract, '/task-assignments'>
type AssignmentsForTask = AssignmentList['tasks'][number]
type UndecidedSubject = AssignmentsForTask['undecided'][number]

const SUBJECT_KIND_LABEL: Record<Task['subjectKind'], string> = {
  horse: 'a horse',
  space: 'a Space',
  rescue: 'the rescue',
}

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  essential: 'Essential',
  discretionary: 'Discretionary',
}

const PERIOD_LABEL: Record<Task['period'], string> = {
  shift: 'per Shift',
  day: 'per day',
}

const SHIFT_TYPE_LABEL: Record<ShiftType, string> = {
  feed_am: 'Feed AM',
  feed_pm: 'Feed PM',
  lunch: 'Lunch',
}

/** A Subject encoded onto one `<option>` value, and decoded back off it. */
function subjectKey(subject: { horseId: string | null; spaceId: string | null }): string {
  return `${subject.horseId ?? ''}:${subject.spaceId ?? ''}`
}

function subjectOf(key: string): { horseId: string | null; spaceId: string | null } {
  const [horseId, spaceId] = key.split(':')
  return { horseId: horseId === '' ? null : (horseId ?? null), spaceId: spaceId === '' ? null : (spaceId ?? null) }
}

function Tasks() {
  const [tasks, setTasks] = useState<TaskList | null>(null)
  const [assignments, setAssignments] = useState<AssignmentList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [listedTasks, listedAssignments] = await Promise.all([
      client.get('/tasks'),
      client.get('/task-assignments'),
    ])
    setTasks(listedTasks)
    setAssignments(listedAssignments)
  }, [])

  useEffect(() => {
    void load().catch((error: unknown) => {
      setProblem(refusalText(error))
    })
  }, [load])

  const act = useCallback(
    async (work: () => Promise<unknown>): Promise<boolean> => {
      setProblem(null)
      try {
        await work()
        await load()
        return true
      } catch (error: unknown) {
        setProblem(refusalText(error))
        return false
      }
    },
    [load],
  )

  return (
    <main>
      <h1>Tasks and Task Assignments</h1>
      <p>
        A Task is one line of the checklist — what it is, who it is about, and whether it is
        Essential. A Task Assignment says which Shift Type normally does it for a horse or a
        Space, the same way the whiteboard's <em>GROOM</em> column did.
      </p>

      {problem !== null && <p role="alert">{problem}</p>}

      <section>
        <h2>The catalogue</h2>
        {tasks === null ? (
          <p>One moment…</p>
        ) : tasks.tasks.length === 0 ? (
          <p>No Tasks yet.</p>
        ) : (
          <table>
            <caption>Every Task</caption>
            <thead>
              <tr>
                <th scope="col">Instruction</th>
                <th scope="col">About</th>
                <th scope="col">Priority</th>
                <th scope="col">Period</th>
                <th scope="col">Medication</th>
              </tr>
            </thead>
            <tbody>
              {tasks.tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.instructionText}</td>
                  <td>{SUBJECT_KIND_LABEL[task.subjectKind]}</td>
                  <td>{PRIORITY_LABEL[task.priority]}</td>
                  <td>{PERIOD_LABEL[task.period]}</td>
                  <td>{task.requiresMedicationAuthority ? 'Needs Medication Authority' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = event.currentTarget
            const data = new FormData(form)
            void act(() =>
              client.post('/tasks', {
                subjectKind: data.get('subjectKind') as Task['subjectKind'],
                priority: data.get('priority') as Task['priority'],
                period: data.get('period') as Task['period'],
                requiresMedicationAuthority: data.get('requiresMedicationAuthority') === 'on',
                closing: data.get('closing') === 'on',
                instructionText: String(data.get('instructionText') ?? ''),
              }),
            ).then((landed) => {
              if (landed) form.reset()
            })
          }}
        >
          <h3>Add a Task</h3>
          <label htmlFor="new-task-subject">About</label>
          <select id="new-task-subject" name="subjectKind" defaultValue="horse">
            {TASK_SUBJECT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {SUBJECT_KIND_LABEL[kind]}
              </option>
            ))}
          </select>
          <label htmlFor="new-task-priority">Priority</label>
          <select id="new-task-priority" name="priority" defaultValue="essential">
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABEL[priority]}
              </option>
            ))}
          </select>
          <label htmlFor="new-task-period">Period</label>
          <select id="new-task-period" name="period" defaultValue="shift">
            {TASK_PERIODS.map((period) => (
              <option key={period} value={period}>
                {PERIOD_LABEL[period]}
              </option>
            ))}
          </select>
          <label htmlFor="new-task-medication">Needs Medication Authority</label>
          <input id="new-task-medication" name="requiresMedicationAuthority" type="checkbox" />
          <label htmlFor="new-task-closing">Closing checklist</label>
          <input id="new-task-closing" name="closing" type="checkbox" />
          <label htmlFor="new-task-instruction">Instruction</label>
          <input
            id="new-task-instruction"
            name="instructionText"
            required
            maxLength={2000}
            placeholder="Muck the stalls."
          />
          <button type="submit">Add</button>
        </form>
      </section>

      <section>
        <h2>Task Assignments</h2>
        {tasks === null || assignments === null ? (
          <p>One moment…</p>
        ) : (
          tasks.tasks.map((task) => {
            const forTask = assignments.tasks.find((each) => each.taskId === task.id)
            return (
              <TaskAssignments
                key={task.id}
                task={task}
                forTask={forTask}
                today={assignments.today}
                act={act}
              />
            )
          })
        )}
      </section>
    </main>
  )
}

function TaskAssignments({
  task,
  forTask,
  today,
  act,
}: {
  task: Task
  forTask: AssignmentsForTask | undefined
  today: AssignmentList['today']
  act: (work: () => Promise<unknown>) => Promise<boolean>
}) {
  const assignments = forTask?.assignments ?? []
  const undecided = forTask?.undecided ?? []

  return (
    <article>
      <h3>{task.instructionText}</h3>
      {assignments.length === 0 ? (
        <p>No decisions recorded yet.</p>
      ) : (
        <ul>
          {assignments.map((assignment) => (
            <li key={subjectKey(assignment)}>
              {assignment.name} —{' '}
              {assignment.stance === 'assigned' && assignment.shiftType !== null ? (
                <>normally {SHIFT_TYPE_LABEL[assignment.shiftType]}'s</>
              ) : (
                <>deliberately none</>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* The unanswered question, said out loud rather than read as no work (ADR 0013, ADR 0015). */}
      {undecided.length > 0 && (
        <p>
          Not yet decided: {undecided.map((subject) => subject.name).join(', ')} — Essential work
          still shows on the checklist while this is unanswered.
        </p>
      )}

      {undecided.length > 0 && (
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = event.currentTarget
            const data = new FormData(form)
            const subject = subjectOf(String(data.get('subject') ?? ''))
            const stance = data.get('stance') === 'deliberately_none' ? 'deliberately_none' : 'assigned'
            void act(() =>
              client.post('/task-assignments', {
                taskId: task.id,
                horseId: subject.horseId,
                spaceId: subject.spaceId,
                stance,
                shiftType: stance === 'assigned' ? (data.get('shiftType') as ShiftType) : null,
                validFrom: today,
              }),
            )
          }}
        >
          <label htmlFor={`subject-${task.id}`}>Subject</label>
          <select id={`subject-${task.id}`} name="subject" defaultValue={subjectKey(undecided[0] as UndecidedSubject)}>
            {undecided.map((subject) => (
              <option key={subjectKey(subject)} value={subjectKey(subject)}>
                {subject.name}
              </option>
            ))}
          </select>

          <label htmlFor={`stance-${task.id}`}>Decision</label>
          <select id={`stance-${task.id}`} name="stance" defaultValue="assigned">
            <option value="assigned">Assigned to a Shift Type</option>
            <option value="deliberately_none">Deliberately none</option>
          </select>

          <label htmlFor={`shift-type-${task.id}`}>Shift Type</label>
          <select id={`shift-type-${task.id}`} name="shiftType" defaultValue="feed_am">
            {SHIFT_TYPES.map((shiftType) => (
              <option key={shiftType} value={shiftType}>
                {SHIFT_TYPE_LABEL[shiftType]}
              </option>
            ))}
          </select>

          <button type="submit">Publish</button>
        </form>
      )}
    </article>
  )
}
