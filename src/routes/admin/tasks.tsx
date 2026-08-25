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
  WideField,
  useSaving,
} from '../../components/forms'
import { Refusal } from '../../components/refusal'
import { Alert, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
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

/** A Subject encoded onto one Select item value, and decoded back off it. */
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
      <h1 className="text-foreground">Tasks and Task Assignments</h1>
      <p className="mb-5 max-w-[68ch] text-base leading-relaxed text-muted-foreground">
        A Task is one line of the checklist: what it is, who it is about, and whether it is
        Essential. A Task Assignment says which Shift Type normally does it for a horse or a Space,
        the same way the whiteboard&rsquo;s <em>GROOM</em> column did.
      </p>

      {problem !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </Alert>
      )}

      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-foreground">The catalogue</h2>
        <AddButton
          onClick={() => {
            setAdding(true)
          }}
        >
          Add a Task
        </AddButton>
      </div>

      {tasks === null ? (
        <Loading what="the catalogue" />
      ) : tasks.tasks.length === 0 ? (
        <Empty>No Tasks yet. A Task is one line of the checklist.</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Instruction</TableHead>
              <TableHead scope="col">About</TableHead>
              <TableHead scope="col">Priority</TableHead>
              <TableHead scope="col">Period</TableHead>
              <TableHead scope="col">Medication</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell>{task.instructionText}</TableCell>
                <TableCell>{SUBJECT_KIND_LABEL[task.subjectKind]}</TableCell>
                <TableCell>
                  <Badge variant={task.priority === 'essential' ? 'orange' : 'purple'}>
                    {PRIORITY_LABEL[task.priority]}
                  </Badge>
                </TableCell>
                <TableCell>{PERIOD_LABEL[task.period]}</TableCell>
                <TableCell>
                  {task.requiresMedicationAuthority ? 'Needs Medication Authority' : 'No'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <section className="mb-4 mt-6 rounded-lg border border-border bg-background p-4 sm:p-6">
        <h2 className="mt-0 text-foreground">Task Assignments</h2>
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
  // State rather than FormData reads, because Radix's Checkbox carries no
  // form name for a FormData read to find.
  const [requiresMedicationAuthority, setRequiresMedicationAuthority] = useState(false)
  const [closing, setClosing] = useState(false)

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
              requiresMedicationAuthority,
              closing,
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
        <WideField label="Instruction" htmlFor="new-task-instruction">
          <Input
            id="new-task-instruction"
            name="instructionText"
            required
            maxLength={2000}
            placeholder="Muck the stalls."
            autoFocus
          />
        </WideField>
        <div className="sm:col-span-2">
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
        <div className="min-w-0">
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
        <div className="min-w-0">
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
        <div className="flex flex-wrap gap-x-6 gap-y-1 sm:col-span-2">
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={requiresMedicationAuthority}
              onCheckedChange={(checked) => {
                setRequiresMedicationAuthority(checked === true)
              }}
            />
            Needs Medication Authority
          </label>
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={closing}
              onCheckedChange={(checked) => {
                setClosing(checked === true)
              }}
            />
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
  // The picked Subject, held here because Radix's Select carries no form name
  // for a FormData read to find. Falls back to the first undecided Subject
  // when nothing has been picked — or when what was picked has since been
  // decided and left the list.
  const [picked, setPicked] = useState<string | null>(null)
  const subject =
    picked !== null && undecided.some((each) => subjectKey(each) === picked)
      ? picked
      : undecided.length > 0
        ? subjectKey(undecided[0] as UndecidedSubject)
        : null
  const { pending, saved, save } = useSaving()

  return (
    <article className="mb-3 rounded-lg border border-border bg-background p-4 last:mb-0">
      <h3 className="mt-0">{task.instructionText}</h3>
      {assignments.length === 0 ? (
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
          No decisions recorded yet.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {assignments.map((assignment) => (
            <li
              key={subjectKey(assignment)}
              className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
            >
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
        <p
          className="my-3 rounded-md bg-card-tint-peach px-4 py-3 text-sm text-brand-orange-deep dark:border dark:border-card-tint-peach/40 dark:bg-transparent dark:text-card-tint-peach"
          role="status"
        >
          Not yet decided: {undecided.map((subject_) => subject_.name).join(', ')} &mdash; Essential
          work still shows on the checklist while this is unanswered.
        </p>
      )}

      {undecided.length > 0 && (
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            const chosen = subjectOf(subject ?? '')
            void save(() =>
              act(() =>
                client.post('/task-assignments', {
                  taskId: task.id,
                  horseId: chosen.horseId,
                  spaceId: chosen.spaceId,
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
              <Select value={subject ?? undefined} onValueChange={setPicked}>
                <SelectTrigger id={`subject-${task.id}`} aria-label="Subject">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {undecided.map((each) => (
                    <SelectItem key={subjectKey(each)} value={subjectKey(each)}>
                      {each.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="min-w-0">
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
              <div className="min-w-0">
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
