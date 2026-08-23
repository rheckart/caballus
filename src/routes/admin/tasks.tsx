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

import {
  Actions,
  AddButton,
  Choice,
  Empty,
  Field,
  Fields,
  Loading,
  SaveButton,
  Saved,
  Sheet,
  useSaving,
} from '../../components/forms'
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
  return {
    horseId: horseId === '' ? null : (horseId ?? null),
    spaceId: spaceId === '' ? null : (spaceId ?? null),
  }
}

function Tasks() {
  const [tasks, setTasks] = useState<TaskList | null>(null)
  const [assignments, setAssignments] = useState<AssignmentList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

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
      <p className="lede">
        A Task is one line of the checklist: what it is, who it is about, and whether it is
        Essential. A Task Assignment says which Shift Type normally does it for a horse or a Space,
        the same way the whiteboard&rsquo;s <em>GROOM</em> column did.
      </p>

      {problem !== null && <p role="alert">{problem}</p>}

      <div className="list-head">
        <h2>The catalogue</h2>
        <AddButton
          onClick={() => {
            setAdding(true)
          }}
        >
          Add a Task
        </AddButton>
      </div>

      <section>
        {tasks === null ? (
          <Loading what="the catalogue" />
        ) : tasks.tasks.length === 0 ? (
          <Empty>No Tasks yet. A Task is one line of the checklist.</Empty>
        ) : (
          <table>
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
                  <td>
                    <span
                      className={
                        task.priority === 'essential' ? 'badge badge-orange' : 'badge badge-purple'
                      }
                    >
                      {PRIORITY_LABEL[task.priority]}
                    </span>
                  </td>
                  <td>{PERIOD_LABEL[task.period]}</td>
                  <td>{task.requiresMedicationAuthority ? 'Needs Medication Authority' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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

      {adding && (
        <Sheet
          title="Add a Task"
          description="What a Task may carry is fixed. These are the whole of the decisions."
          onClose={() => {
            setAdding(false)
          }}
        >
          <NewTask
            act={act}
            onSaved={() => {
              setAdding(false)
            }}
          />
        </Sheet>
      )}
    </main>
  )
}

/**
 * The Task form. Three closed lists of two or three options each, which is
 * exactly where a segmented control beats a native picker: the whole decision
 * is visible without a tap.
 */
function NewTask({
  act,
  onSaved,
}: {
  act: (work: () => Promise<unknown>) => Promise<boolean>
  onSaved: () => void
}) {
  const { pending, saved, save } = useSaving()

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        void save(() =>
          act(() =>
            client.post('/tasks', {
              subjectKind: data.get('subjectKind') as Task['subjectKind'],
              priority: data.get('priority') as Task['priority'],
              period: data.get('period') as Task['period'],
              requiresMedicationAuthority: data.get('requiresMedicationAuthority') === 'on',
              closing: data.get('closing') === 'on',
              instructionText: String(data.get('instructionText') ?? ''),
            }),
          ).then((landed) => {
            if (landed) {
              form.reset()
              onSaved()
            }
          }),
        )
      }}
    >
      <Fields>
        <div className="field-wide">
          <Field label="Instruction" htmlFor="new-task-instruction">
            <input
              id="new-task-instruction"
              name="instructionText"
              required
              maxLength={2000}
              placeholder="Muck the stalls."
              autoFocus
            />
          </Field>
        </div>
        <div className="field-wide">
          <Choice
            legend="About"
            name="subjectKind"
            defaultValue="horse"
            options={TASK_SUBJECT_KINDS.map((kind) => ({
              value: kind,
              label: SUBJECT_KIND_LABEL[kind],
            }))}
          />
        </div>
        <div className="field">
          <Choice
            legend="Priority"
            name="priority"
            defaultValue="essential"
            options={TASK_PRIORITIES.map((priority) => ({
              value: priority,
              label: PRIORITY_LABEL[priority],
            }))}
          />
        </div>
        <div className="field">
          <Choice
            legend="Period"
            name="period"
            defaultValue="shift"
            options={TASK_PERIODS.map((period) => ({
              value: period,
              label: PERIOD_LABEL[period],
            }))}
          />
        </div>
        <div className="field-wide">
          <label htmlFor="new-task-medication">
            <input id="new-task-medication" name="requiresMedicationAuthority" type="checkbox" />
            Needs Medication Authority
          </label>
          <label htmlFor="new-task-closing">
            <input id="new-task-closing" name="closing" type="checkbox" />
            Closing checklist
          </label>
        </div>
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Add</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
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
  // Controlled, because *deliberately none* has no Shift Type and showing the
  // picker anyway asks a question whose answer is about to be thrown away.
  const [stance, setStance] = useState<'assigned' | 'deliberately_none'>('assigned')
  const { pending, saved, save } = useSaving()

  return (
    <article>
      <h3>{task.instructionText}</h3>
      {assignments.length === 0 ? (
        <p className="field-hint">No decisions recorded yet.</p>
      ) : (
        <ul>
          {assignments.map((assignment) => (
            <li key={subjectKey(assignment)}>
              {assignment.name} &mdash;{' '}
              {assignment.stance === 'assigned' && assignment.shiftType !== null ? (
                <>normally {SHIFT_TYPE_LABEL[assignment.shiftType]}&apos;s</>
              ) : (
                <>deliberately none</>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* The unanswered question, said out loud rather than read as no work (ADR 0013, ADR 0015). */}
      {undecided.length > 0 && (
        <p className="owed" role="status">
          Not yet decided: {undecided.map((subject) => subject.name).join(', ')} &mdash; Essential
          work still shows on the checklist while this is unanswered.
        </p>
      )}

      {undecided.length > 0 && (
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            const subject = subjectOf(String(data.get('subject') ?? ''))
            void save(() =>
              act(() =>
                client.post('/task-assignments', {
                  taskId: task.id,
                  horseId: subject.horseId,
                  spaceId: subject.spaceId,
                  stance,
                  shiftType: stance === 'assigned' ? (data.get('shiftType') as ShiftType) : null,
                  validFrom: today,
                }),
              ),
            )
          }}
        >
          <Fields>
            <Field label="Subject" htmlFor={`subject-${task.id}`}>
              <select
                id={`subject-${task.id}`}
                name="subject"
                defaultValue={subjectKey(undecided[0] as UndecidedSubject)}
              >
                {undecided.map((subject) => (
                  <option key={subjectKey(subject)} value={subjectKey(subject)}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="field">
              <Choice
                legend="Decision"
                name="stance"
                value={stance}
                onChange={setStance}
                options={[
                  { value: 'assigned', label: 'A Shift Type does it' },
                  { value: 'deliberately_none', label: 'Deliberately none' },
                ]}
              />
            </div>
            {stance === 'assigned' && (
              <div className="field">
                <Choice
                  legend="Shift Type"
                  name="shiftType"
                  defaultValue="feed_am"
                  options={SHIFT_TYPES.map((shiftType) => ({
                    value: shiftType,
                    label: SHIFT_TYPE_LABEL[shiftType],
                  }))}
                />
              </div>
            )}
          </Fields>

          <Actions>
            <SaveButton pending={pending} pendingLabel="Publishing…">
              Publish
            </SaveButton>
            <Saved saved={saved} what="Published" />
          </Actions>
        </form>
      )}
    </article>
  )
}
