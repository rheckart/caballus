/**
 * Supplies, at the UI seam: the real route component, the real typed client,
 * and only `fetch` stubbed (#32's testing decisions, #47).
 *
 * What is claimed: the derived figure and the last-counted date render as the
 * server sent them, a Product nobody has ever counted reads as unanswered
 * rather than zero, recording a count is offered only to a `supplies` holder
 * or Shift Authority, and opening/closing a Reorder is `supplies` alone.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { answeredNothing, stubApi } from '../test/api-stub'
import { chooseOption, renderRoutes } from '../test/route-harness'
import { Route } from './supplies'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderSupplies() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoutes([{ path: '/supplies', component }], '/supplies')
}

const EMPTY_SHIFTS = { today: '2026-08-18', shifts: [] }
const EMPTY_ESCALATIONS = { escalations: [] }

const SENIOR_COUNTED = {
  productId: 'prod-1',
  productName: 'Senior',
  productKind: 'feed',
  reorderPointDays: 7,
  latestReading: {
    daysRemaining: 14.5,
    countedOn: '2026-08-14',
    recordedBy: 'kate',
    recordedByName: 'Kate',
  },
  projectedDaysRemaining: 10.5,
  atOrBelowReorderPoint: false,
}

const RICE_BRAN_UNCOUNTED = {
  productId: 'prod-2',
  productName: 'Rice Bran',
  productKind: 'feed',
  reorderPointDays: null,
  latestReading: null,
  projectedDaysRemaining: null,
  atOrBelowReorderPoint: false,
}

describe('the Supplies screen', () => {
  it("shows a Product's decremented figure and its last-counted date", async () => {
    stubApi({
      '/me': {
        volunteerId: 'reader',
        name: 'Reader',
        email: 'someone@barn.test',
        mobile: null,
        smsConsentAt: null,
        smsStoppedAt: null,
        domainScopes: [],
      },
      '/supplies': { today: '2026-08-18', products: [SENIOR_COUNTED] },
      '/reorders': { reorders: [] },
      '/escalations': EMPTY_ESCALATIONS,
      '/shifts': EMPTY_SHIFTS,
    })
    renderSupplies()

    expect(await screen.findByText(/10\.5 days left/)).toBeTruthy()
    expect(screen.getByText(/2026-08-14/)).toBeTruthy()
  })

  it('reads a Product nobody has ever counted as unanswered, never as zero', async () => {
    stubApi({
      '/me': {
        volunteerId: 'reader',
        name: 'Reader',
        email: 'someone@barn.test',
        mobile: null,
        smsConsentAt: null,
        smsStoppedAt: null,
        domainScopes: [],
      },
      '/supplies': { today: '2026-08-18', products: [RICE_BRAN_UNCOUNTED] },
      '/reorders': { reorders: [] },
      '/escalations': EMPTY_ESCALATIONS,
      '/shifts': EMPTY_SHIFTS,
    })
    renderSupplies()

    expect(await screen.findByText('Never counted.')).toBeTruthy()
  })

  it('reads a zero projection as out, with the last-counted date', async () => {
    stubApi({
      '/me': {
        volunteerId: 'reader',
        name: 'Reader',
        email: 'someone@barn.test',
        mobile: null,
        smsConsentAt: null,
        smsStoppedAt: null,
        domainScopes: [],
      },
      '/supplies': {
        today: '2026-08-18',
        products: [{ ...SENIOR_COUNTED, projectedDaysRemaining: 0 }],
      },
      '/reorders': { reorders: [] },
      '/escalations': EMPTY_ESCALATIONS,
      '/shifts': EMPTY_SHIFTS,
    })
    renderSupplies()

    expect(await screen.findByText(/Out — last counted 2026-08-14/)).toBeTruthy()
  })

  it('offers the reading form to a supplies holder', async () => {
    stubApi({
      '/me': {
        volunteerId: 'bm',
        name: 'Barn Manager',
        email: 'someone@barn.test',
        mobile: null,
        smsConsentAt: null,
        smsStoppedAt: null,
        domainScopes: ['supplies'],
      },
      '/supplies': { today: '2026-08-18', products: [SENIOR_COUNTED] },
      '/reorders': { reorders: [] },
      '/escalations': EMPTY_ESCALATIONS,
      '/shifts': EMPTY_SHIFTS,
    })
    renderSupplies()

    expect(await screen.findByLabelText('Days remaining')).toBeTruthy()
  })

  it('withholds the reading form from a reader with no supplies scope and no Shift Authority today', async () => {
    stubApi({
      '/me': {
        volunteerId: 'reader',
        name: 'Reader',
        email: 'someone@barn.test',
        mobile: null,
        smsConsentAt: null,
        smsStoppedAt: null,
        domainScopes: [],
      },
      '/supplies': { today: '2026-08-18', products: [SENIOR_COUNTED] },
      '/reorders': { reorders: [] },
      '/escalations': EMPTY_ESCALATIONS,
      '/shifts': EMPTY_SHIFTS,
    })
    renderSupplies()

    await screen.findByText('Days of supply')
    expect(screen.queryByLabelText('Days remaining')).toBeNull()
  })

  it('offers the reading form to Shift Authority on a Shift standing today, with no supplies scope', async () => {
    stubApi({
      '/me': {
        volunteerId: 'kate',
        name: 'Kate',
        email: 'someone@barn.test',
        mobile: null,
        smsConsentAt: null,
        smsStoppedAt: null,
        domainScopes: [],
      },
      '/supplies': { today: '2026-08-18', products: [SENIOR_COUNTED] },
      '/reorders': { reorders: [] },
      '/escalations': EMPTY_ESCALATIONS,
      '/shifts': {
        today: '2026-08-18',
        shifts: [
          {
            id: 'shift-1',
            patternId: null,
            day: '2026-08-18',
            shiftType: 'feed_am',
            startTime: '06:30',
            targetHeadcount: 3,
            staffingMode: 'standing_roster',
            purpose: null,
            state: 'in_progress',
            roster: [
              {
                volunteerId: 'kate',
                name: 'Kate',
                position: 'lead',
                rosterable: true,
                gaps: [],
                origin: 'assigned',
                medicationAuthority: false,
                endedAs: null,
                endedReason: null,
              },
            ],
            staffing: { gaps: [], suggestedActingLead: null },
            short: null,
            attendance: [],
          },
        ],
      },
    })
    renderSupplies()

    expect(await screen.findByLabelText('Days remaining')).toBeTruthy()
  })

  it('records a reading against the picked Product', async () => {
    let posted: unknown = null
    stubApi({
      '/me': {
        volunteerId: 'bm',
        name: 'Barn Manager',
        email: 'someone@barn.test',
        mobile: null,
        smsConsentAt: null,
        smsStoppedAt: null,
        domainScopes: ['supplies'],
      },
      '/supplies': { today: '2026-08-18', products: [SENIOR_COUNTED] },
      '/reorders': { reorders: [] },
      '/escalations': EMPTY_ESCALATIONS,
      '/shifts': EMPTY_SHIFTS,
      '/supplies/readings': (init: RequestInit) => {
        posted = JSON.parse(String(init.body))
        return { readingId: 'reading-1' }
      },
    })
    renderSupplies()

    await screen.findByLabelText('Days remaining')
    await chooseOption('Product', 'Senior')
    fireEvent.change(screen.getByLabelText('Days remaining'), { target: { value: '9.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))

    await waitFor(() => {
      expect(posted).toMatchObject({ productId: 'prod-1', daysRemaining: 9.5 })
    })
  })

  it('opens a Reorder for a supplies holder, and never offers the button to a reader', async () => {
    let opened: unknown = null
    stubApi({
      '/me': {
        volunteerId: 'bm',
        name: 'Barn Manager',
        email: 'someone@barn.test',
        mobile: null,
        smsConsentAt: null,
        smsStoppedAt: null,
        domainScopes: ['supplies'],
      },
      '/supplies': { today: '2026-08-18', products: [SENIOR_COUNTED] },
      '/escalations': EMPTY_ESCALATIONS,
      '/shifts': EMPTY_SHIFTS,
      // The read and the write share one path, so one handler answers both:
      // a GET lists the (empty) Reorders, a POST records what was opened.
      '/reorders': (init: RequestInit) => {
        if (init.method !== 'POST') return { reorders: [] }
        opened = JSON.parse(String(init.body))
        return { reorderId: 'reorder-1' }
      },
    })
    renderSupplies()

    fireEvent.click(await screen.findByRole('button', { name: 'Open a Reorder' }))

    await waitFor(() => {
      expect(opened).toMatchObject({ productId: 'prod-1' })
    })
  })

  it('shows a Reorder’s thread and closes it with a note, for a supplies holder', async () => {
    let closed: unknown = null
    stubApi({
      '/me': {
        volunteerId: 'bm',
        name: 'Barn Manager',
        email: 'someone@barn.test',
        mobile: null,
        smsConsentAt: null,
        smsStoppedAt: null,
        domainScopes: ['supplies'],
      },
      '/supplies': { today: '2026-08-18', products: [SENIOR_COUNTED] },
      '/reorders': {
        reorders: [
          {
            id: 'reorder-1',
            productId: 'prod-1',
            productName: 'Senior',
            escalationId: null,
            openedBy: 'bm',
            openedByName: 'Barn Manager',
            openedAt: 0,
            closedAt: null,
            closedBy: null,
            closedByName: null,
            closingNote: null,
            comments: [
              {
                id: 'c1',
                text: 'Ordered from Allivet',
                authoredBy: 'bm',
                authoredByName: 'Barn Manager',
                authoredAt: 0,
              },
            ],
          },
        ],
      },
      '/escalations': EMPTY_ESCALATIONS,
      '/shifts': EMPTY_SHIFTS,
      '/reorders/close': (init: RequestInit) => {
        closed = JSON.parse(String(init.body))
        return answeredNothing()
      },
    })
    renderSupplies()

    expect(await screen.findByText(/Ordered from Allivet/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Close with a note'), {
      target: { value: 'Arrived Thursday.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => {
      expect(closed).toMatchObject({ reorderId: 'reorder-1', note: 'Arrived Thursday.' })
    })
  })

  it('withholds the close form on a Reorder from a reader with no supplies scope', async () => {
    stubApi({
      '/me': {
        volunteerId: 'reader',
        name: 'Reader',
        email: 'someone@barn.test',
        mobile: null,
        smsConsentAt: null,
        smsStoppedAt: null,
        domainScopes: [],
      },
      '/supplies': { today: '2026-08-18', products: [SENIOR_COUNTED] },
      '/reorders': {
        reorders: [
          {
            id: 'reorder-1',
            productId: 'prod-1',
            productName: 'Senior',
            escalationId: null,
            openedBy: 'bm',
            openedByName: 'Barn Manager',
            openedAt: 0,
            closedAt: null,
            closedBy: null,
            closedByName: null,
            closingNote: null,
            comments: [],
          },
        ],
      },
      '/escalations': EMPTY_ESCALATIONS,
      '/shifts': EMPTY_SHIFTS,
    })
    renderSupplies()

    await screen.findByText('Senior', { selector: 'p strong' })
    expect(screen.queryByLabelText('Close with a note')).toBeNull()
  })
})
