/**
 * The horse profile, and navigating to it from the list — driving the real
 * route components the way a volunteer's tap does (#32's testing decisions).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../../test/api-stub'
import { renderRoutes } from '../../test/route-harness'
import HorseProfile from './$horseId'
import HorseList from './index'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Renders the profile route already navigated to a real horse id, the way a tap would. */
function renderProfileAt(horseId: string) {
  return renderRoutes([{ path: '/horses/$horseId', component: HorseProfile }], `/horses/${horseId}`)
}

const PROFILE = {
  id: 'apollo-1',
  name: 'Apollo',
  halterColour: 'blue',
  blanketSize: '80',
  height: '15.2 hh',
  photoUrl: null,
  departedOn: null,
  spaces: { stall: { id: 'stall-4', name: 'Stall 4' }, pasture: null, paddock: null, barn: null },
  alerts: [],
  feedSchedules: [],
  measurements: { weights: [], bodyConditions: [] },
  endedAlerts: [],
}

describe('the horse profile', () => {
  it('says so plainly when a horse carries no Alert', async () => {
    stubApi({ '/horses/apollo-1': PROFILE })
    renderProfileAt('apollo-1')

    const alerts = await screen.findByRole('heading', { name: 'Alerts' })
    expect(alerts).toBeTruthy()
    expect(screen.getByText('No alerts recorded.')).toBeTruthy()
  })

  it('shows a standing Alert in full words, never a count (ADR 0024)', async () => {
    stubApi({
      '/horses/apollo-1': {
        ...PROFILE,
        alerts: [
          {
            id: 'alert-1',
            horseId: 'apollo-1',
            kind: 'prohibition',
            text: 'No treats by hand — she bites.',
            raisedBy: 'priya-1',
            raisedByName: 'Priya Chandra',
            raisedAt: 1_755_000_000_000,
            endedAt: null,
            endedBy: null,
            endedByName: null,
            endingReason: null,
          },
        ],
      },
    })
    renderProfileAt('apollo-1')

    expect(await screen.findByText('No treats by hand — she bites.')).toBeTruthy()
    expect(screen.queryByText('No alerts recorded.')).toBeNull()
  })

  it('keeps an ended Alert as history, with the reason it ended', async () => {
    stubApi({
      '/horses/apollo-1': {
        ...PROFILE,
        endedAlerts: [
          {
            id: 'alert-2',
            horseId: 'apollo-1',
            kind: 'prohibition',
            text: 'No treats by hand — she bites.',
            raisedBy: 'priya-1',
            raisedByName: 'Priya Chandra',
            raisedAt: 1_700_000_000_000,
            endedAt: 1_755_000_000_000,
            endedBy: 'priya-1',
            endedByName: 'Priya Chandra',
            endingReason: 'Six months without an incident; the vet agrees.',
          },
        ],
      },
    })
    renderProfileAt('apollo-1')

    expect(await screen.findByRole('heading', { name: 'Alerts that have ended' })).toBeTruthy()
    // The reason is the only place the answer to *why is it gone* lives.
    expect(screen.getByText(/Six months without an incident/)).toBeTruthy()
    // And it is not standing: the section above still reads as empty.
    expect(screen.getByText('No alerts recorded.')).toBeTruthy()
  })

  it('shows the attributes and Space assignments', async () => {
    stubApi({ '/horses/apollo-1': PROFILE })
    renderProfileAt('apollo-1')

    expect(await screen.findByText('Halter colour: blue')).toBeTruthy()
    expect(screen.getByText('Stall: Stall 4')).toBeTruthy()
    expect(screen.getByText('Pasture: not assigned')).toBeTruthy()
    expect(screen.getByText('Paddock: not assigned')).toBeTruthy()
  })

  it('marks a Departed horse without hiding its record', async () => {
    stubApi({ '/horses/apollo-1': { ...PROFILE, departedOn: '2020-06-01' } })
    renderProfileAt('apollo-1')

    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Departed 2020-06-01')
  })

  it('is reached by tapping a horse in the list', async () => {
    stubApi({
      '/horses': {
        horses: [
          {
            id: 'apollo-1',
            name: 'Apollo',
            halterColour: 'blue',
            blanketSize: null,
            height: null,
            photoUrl: null,
            departedOn: null,
            spaces: {
              stall: { id: 'stall-4', name: 'Stall 4' },
              pasture: null,
              paddock: null,
              barn: null,
            },
          },
        ],
      },
      '/horses/apollo-1': PROFILE,
    })
    renderRoutes(
      [
        { path: '/horses/', component: HorseList },
        { path: '/horses/$horseId', component: HorseProfile },
      ],
      '/horses/',
    )

    const link = await screen.findByText('Apollo — Stall 4')
    fireEvent.click(link)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Apollo' })).toBeTruthy()
    })
  })

  it('shows the current feeding per Shift Type, with the New marker on a recently changed one', async () => {
    stubApi({
      '/horses/apollo-1': {
        ...PROFILE,
        feedSchedules: [
          {
            shiftType: 'feed_am',
            validFrom: '2024-01-01',
            isNew: false,
            lines: [
              {
                productId: 'senior-1',
                productName: 'Senior',
                productKind: 'feed',
                amount: '2 scoops',
                route: 'in_feed',
              },
              {
                productId: 'bute-1',
                productName: 'Bute',
                productKind: 'medication',
                amount: '1 dose',
                route: 'oral_syringe',
              },
            ],
          },
          { shiftType: 'lunch', validFrom: '2024-06-01', isNew: true, lines: [] },
        ],
      },
    })
    renderProfileAt('apollo-1')

    expect(await screen.findByRole('heading', { name: 'Feed AM' })).toBeTruthy()
    expect(screen.getByText('2 scoops of Senior — in feed')).toBeTruthy()
    // A syringe medication is visibly not in-feed.
    expect(screen.getByText('1 dose of Bute — oral syringe')).toBeTruthy()

    const lunch = screen.getByRole('heading', { name: /Lunch/ })
    expect(lunch.textContent).toContain('New')
    const feedAm = screen.getByRole('heading', { name: 'Feed AM' })
    expect(feedAm.textContent).not.toContain('New')
  })

  it('shows no feed schedule for a Shift Type this horse has never had one for', async () => {
    stubApi({ '/horses/apollo-1': PROFILE })
    renderProfileAt('apollo-1')

    expect(await screen.findByText('No feed schedule recorded.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Lunch' })).toBeNull()
  })

  it('renders the weight and body-condition series', async () => {
    stubApi({
      '/horses/apollo-1': {
        ...PROFILE,
        measurements: {
          weights: [
            { id: 'w1', value: 950, method: 'tape', takenOn: '2024-01-01', recordedBy: 'v1' },
            { id: 'w2', value: 973, method: null, takenOn: '2024-02-01', recordedBy: 'v1' },
          ],
          bodyConditions: [{ id: 'b1', value: 5, takenOn: '2024-01-01', recordedBy: 'v1' }],
        },
      },
    })
    renderProfileAt('apollo-1')

    expect(await screen.findByText('950 lb (tape) — 2024-01-01')).toBeTruthy()
    expect(screen.getByText('973 lb — 2024-02-01')).toBeTruthy()
    expect(screen.getByText('5 — 2024-01-01')).toBeTruthy()
  })
})
