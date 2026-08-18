/**
 * Opening a Shift, at the UI seam: the real route component, the real typed
 * client, and only `fetch` stubbed (#32's testing decisions, #41).
 *
 * The claims under test are the ticket's: the checklist groups per horse and
 * per Space, blanks render as blanks (a Shift whose day nothing has
 * materialized shows that fact rather than an empty list), and an
 * undecided Task Assignment reads as an unanswered question rather than as
 * no work.
 */
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
    ...overrides,
  }
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
  })
})
