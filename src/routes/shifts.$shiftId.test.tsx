/**
 * Opening a Shift, at the UI seam: the real route component, the real typed
 * client, and only `fetch` stubbed (#32's testing decisions, #41, #42).
 *
 * The claims under test are the ticket's: the checklist groups per horse and
 * per Space, horse cards sort in stall order, blanks render as blanks (a
 * Shift whose day nothing has materialized shows that fact rather than an
 * empty list), an undecided Task Assignment reads as an unanswered question
 * rather than as no work, and a tick lands optimistically, shows Unsent while
 * it cannot reach the server, and reads Done only once the server has
 * confirmed it — never both at once (#42).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { API_BASE } from '../shared/api-client'
import { stubApi } from '../test/api-stub'
import { renderRoutes } from '../test/route-harness'
import { ShiftChecklist } from './shifts.$shiftId'

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderAt(shiftId: string) {
  return renderRoutes(
    [{ path: '/shifts/$shiftId', component: ShiftChecklist }],
    `/shifts/${shiftId}`,
  )
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    kind: 'feed',
    subjectKind: 'horse',
    horseId: 'apollo',
    horseName: 'Apollo',
    horseStallName: null,
    spaceId: null,
    spaceName: null,
    priority: 'essential',
    requiresMedicationAuthority: false,
    instructionText: 'Feed per the current Feed Schedule.',
    assignedShiftType: null,
    assignmentUndecided: false,
    prepForShiftType: null,
    closing: false,
    conditionName: null,
    done: false,
    doneAt: null,
    doneByName: null,
    ...overrides,
  }
}

/**
 * The other half of the network seam: a `fetch` stub that can answer one path
 * with something other than a flat 200 — a rejection for the "offline" tests,
 * or a status this file chooses — which `stubApi` deliberately cannot (#42).
 */
function stubApiWith(
  reads: Record<string, unknown>,
  overrides: Record<string, () => Promise<Response>> = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const requested = input instanceof Request ? input.url : String(input)
      const path = new URL(requested, 'http://barn.invalid').pathname.slice(API_BASE.length)

      const override = overrides[path]
      if (override !== undefined) return override()

      const handler = reads[path]
      if (handler === undefined) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'not_found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }
      const body = typeof handler === 'function' ? (handler as () => unknown)() : handler
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }),
  )
}

function jsonResponse(body: unknown, status: number): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('opening a Shift', () => {
  it('shows a Shift whose day nothing has materialized as unfixed, not as empty', async () => {
    stubApi({
      '/shifts/shift-1': {
        shiftId: 'shift-1',
        day: '2026-08-18',
        shiftType: 'feed_am',
        materialized: false,
        items: [],
        prepOwed: [],
      },
    })
    renderAt('shift-1')

    expect(await screen.findByText('The checklist has not been fixed for today yet.')).toBeTruthy()
  })

  it('groups Items per horse', async () => {
    stubApi({
      '/shifts/shift-1': {
        shiftId: 'shift-1',
        day: '2026-08-18',
        shiftType: 'feed_am',
        materialized: true,
        items: [
          item(),
          item({
            id: 'item-2',
            kind: 'medicate',
            instructionText: 'Medicate per the current Feed Schedule.',
            requiresMedicationAuthority: true,
          }),
        ],
        prepOwed: [],
      },
    })
    renderAt('shift-1')

    expect(await screen.findByRole('heading', { name: 'Apollo' })).toBeTruthy()
    expect(screen.getByText(/Feed per the current Feed Schedule\./)).toBeTruthy()
    expect(screen.getByText(/needs Medication Authority/)).toBeTruthy()
  })

  it('groups Items per Space', async () => {
    stubApi({
      '/shifts/shift-1': {
        shiftId: 'shift-1',
        day: '2026-08-18',
        shiftType: 'feed_am',
        materialized: true,
        items: [
          item({
            id: 'item-3',
            kind: 'task',
            subjectKind: 'space',
            horseId: null,
            horseName: null,
            spaceId: 'field-c',
            spaceName: 'Field C',
            instructionText: 'Muck the stalls.',
          }),
        ],
        prepOwed: [],
      },
    })
    renderAt('shift-1')

    expect(await screen.findByRole('heading', { name: 'Field C' })).toBeTruthy()
    expect(screen.getByText(/Muck the stalls\./)).toBeTruthy()
  })

  it('renders an undecided Task Assignment as an unanswered question, not as no work', async () => {
    stubApi({
      '/shifts/shift-1': {
        shiftId: 'shift-1',
        day: '2026-08-18',
        shiftType: 'feed_am',
        materialized: true,
        items: [
          item({
            id: 'item-4',
            kind: 'task',
            subjectKind: 'space',
            horseId: null,
            horseName: null,
            spaceId: 'field-d',
            spaceName: 'Field D',
            instructionText: 'Muck the stalls.',
            assignmentUndecided: true,
          }),
        ],
        prepOwed: [],
      },
    })
    renderAt('shift-1')

    expect(await screen.findByText(/not yet decided which Shift normally does this/)).toBeTruthy()
  })

  it('shows the Prep this Shift is owed', async () => {
    stubApi({
      '/shifts/shift-1': {
        shiftId: 'shift-1',
        day: '2026-08-18',
        shiftType: 'lunch',
        materialized: true,
        items: [],
        prepOwed: [
          item({
            id: 'prep-1',
            instructionText: 'Soak for lunch.',
            prepForShiftType: 'lunch',
          }),
        ],
      },
    })
    renderAt('shift-1')

    expect(await screen.findByRole('heading', { name: 'Prep owed to this Shift' })).toBeTruthy()
    expect(screen.getByText(/Soak for lunch\./)).toBeTruthy()
    // Read-only: it belongs to an earlier Shift and is never tickable from here (ADR 0013).
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('puts horse cards in stall order, "10" after "9"', async () => {
    stubApi({
      '/shifts/shift-1': {
        shiftId: 'shift-1',
        day: '2026-08-18',
        shiftType: 'feed_am',
        materialized: true,
        items: [
          item({ id: 'blue', horseId: 'blue', horseName: 'Blue', horseStallName: '10' }),
          item({ id: 'nora', horseId: 'nora', horseName: 'Nora', horseStallName: '9' }),
        ],
        prepOwed: [],
      },
    })
    renderAt('shift-1')

    const headings = await screen.findAllByRole('heading', { level: 2 })
    expect(headings.map((heading) => heading.textContent)).toEqual(['Nora', 'Blue'])
  })

  it('ticks an Item Done: lands optimistically, and reads Done only once the server confirms it', async () => {
    // Toggled by the POST handler rather than by a call count on the read: a
    // Shift re-read for reasons of its own (the queue settling with nothing
    // to send, say) must not be mistaken for the server confirming a tick.
    let posted = false
    stubApi({
      '/shifts/shift-1': () => ({
        shiftId: 'shift-1',
        day: '2026-08-18',
        shiftType: 'feed_am',
        materialized: true,
        items: [item({ done: posted, doneByName: posted ? 'Priya Chandra' : null })],
        prepOwed: [],
      }),
      '/items/done': () => {
        posted = true
        return { itemOutcomeId: 'outcome-1' }
      },
    })
    renderAt('shift-1')

    const checkbox = await screen.findByRole('checkbox')
    expect((checkbox as HTMLInputElement).checked).toBe(false)

    fireEvent.click(checkbox)

    await waitFor(() => {
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    })
    expect(await screen.findByText(/Done — Priya Chandra/)).toBeTruthy()
  })

  it('shows a tick as Unsent while it cannot reach the server, and never as Done', async () => {
    stubApiWith(
      {
        '/shifts/shift-1': {
          shiftId: 'shift-1',
          day: '2026-08-18',
          shiftType: 'feed_am',
          materialized: true,
          items: [item()],
          prepOwed: [],
        },
      },
      { '/items/done': () => Promise.reject(new TypeError('network unreachable')) },
    )
    renderAt('shift-1')

    const checkbox = await screen.findByRole('checkbox')
    fireEvent.click(checkbox)

    expect(await screen.findByText('Unsent')).toBeTruthy()
    expect(screen.queryByText(/^Done/)).toBeNull()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('refuses a Medicate Item explicitly when the actor holds no Medication Authority', async () => {
    stubApiWith(
      {
        '/shifts/shift-1': {
          shiftId: 'shift-1',
          day: '2026-08-18',
          shiftType: 'feed_am',
          materialized: true,
          items: [
            item({
              id: 'medicate-1',
              kind: 'medicate',
              requiresMedicationAuthority: true,
              instructionText: 'Give 1g Bute.',
            }),
          ],
          prepOwed: [],
        },
      },
      {
        '/items/done': () => jsonResponse({ error: 'medication_authority_required' }, 409),
      },
    )
    renderAt('shift-1')

    const checkbox = await screen.findByRole('checkbox')
    fireEvent.click(checkbox)

    expect(await screen.findByText(/Medication Authority/)).toBeTruthy()
    // Denied rather than left hanging: the checkbox goes back to untouched,
    // since a fresh tap is a genuine new attempt under a fresh key.
    await waitFor(() => {
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    })
  })
})
