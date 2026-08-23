/**
 * The Tasks screen at the UI seam: the real route component, the real typed
 * client, and only `fetch` stubbed (#32's testing decisions, #41).
 *
 * One claim, and it is the ticket's: **"not yet decided" reads as an
 * unanswered question**, the same discipline `/admin/thresholds`' own test
 * asserts for its own tri-state (ADR 0013, ADR 0015).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../../test/api-stub'
import { renderRoutes } from '../../test/route-harness'
import { Route } from './tasks'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderTasks() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoutes([{ path: '/admin/tasks', component }], '/admin/tasks')
}

const TASKS = {
  tasks: [
    {
      id: 'muck',
      subjectKind: 'space',
      priority: 'essential',
      period: 'day',
      requiresMedicationAuthority: false,
      conditionName: null,
      prepForShiftType: null,
      toleranceCount: null,
      closing: false,
      instructionText: 'Muck the stalls.',
    },
  ],
}

const ASSIGNMENTS = {
  today: '2026-08-18',
  tasks: [
    {
      taskId: 'muck',
      assignments: [
        {
          horseId: null,
          spaceId: 'field-c',
          name: 'Field C',
          stance: 'assigned',
          shiftType: 'feed_am',
          instructionText: null,
          validFrom: '2026-08-01',
        },
      ],
      undecided: [{ horseId: null, spaceId: 'field-d', name: 'Field D' }],
    },
  ],
}

describe('the Tasks screen', () => {
  it('lists the catalogue', async () => {
    stubApi({ '/tasks': TASKS, '/task-assignments': ASSIGNMENTS })
    renderTasks()

    expect((await screen.findAllByText('Muck the stalls.')).length).toBeGreaterThan(0)
  })

  it('renders a decided Subject as what was decided', async () => {
    stubApi({ '/tasks': TASKS, '/task-assignments': ASSIGNMENTS })
    renderTasks()

    expect(await screen.findByText(/Field C —/)).toBeTruthy()
    expect(screen.getByText(/normally Feed AM's/)).toBeTruthy()
  })

  it('renders a Subject nobody has decided for as an unanswered question, never as no work', async () => {
    stubApi({ '/tasks': TASKS, '/task-assignments': ASSIGNMENTS })
    renderTasks()

    const owed = await screen.findByText(/Not yet decided/)
    expect(owed.textContent).toContain('Field D')
    expect(owed.textContent).toContain('still shows on the checklist')
  })

  it('publishes a Task Assignment for the undecided Subject', async () => {
    const posted: unknown[] = []
    stubApi({
      '/tasks': TASKS,
      '/task-assignments': (init: RequestInit) => {
        if (init.method !== 'POST') return ASSIGNMENTS
        posted.push(JSON.parse(String(init.body)) as unknown)
        return { taskAssignmentId: 'new-one' }
      },
    })
    renderTasks()

    await screen.findAllByText(/Field D/)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(posted.length).toBe(1)
    })
    expect(posted[0]).toMatchObject({
      taskId: 'muck',
      spaceId: 'field-d',
      horseId: null,
      stance: 'assigned',
    })
  })

  it('adds a Task with exactly the fields the rescue may choose among', async () => {
    const posted: unknown[] = []
    stubApi({
      '/tasks': (init: RequestInit) => {
        if (init.method !== 'POST') return TASKS
        posted.push(JSON.parse(String(init.body)) as unknown)
        return { taskId: 'new-task' }
      },
      '/task-assignments': ASSIGNMENTS,
    })
    renderTasks()

    await screen.findAllByText('Muck the stalls.')
    // The catalogue is what this screen is for, so the form that adds to it
    // opens in a sheet rather than sitting under the list pushing it down.
    fireEvent.click(screen.getByRole('button', { name: 'Add a Task' }))
    fireEvent.change(screen.getByLabelText('Instruction'), {
      target: { value: 'Sweep the barn.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(posted.length).toBe(1)
    })
    expect(posted[0]).toMatchObject({
      instructionText: 'Sweep the barn.',
      subjectKind: 'horse',
      priority: 'essential',
      period: 'shift',
      requiresMedicationAuthority: false,
      closing: false,
    })
  })
})
