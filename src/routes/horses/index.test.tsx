/**
 * The horse list, through Testing Library — the UI seam #32's testing
 * decisions add: a real route component, a real router, and fetch stubbed at
 * the network boundary so the real typed client and contract parsing
 * participate.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../../test/api-stub'
import { renderRoute } from '../../test/route-harness'
import HorseList from './index'

afterEach(() => {
  vi.unstubAllGlobals()
})

const HORSES = {
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
    {
      id: 'gone-1',
      name: 'Old Timer',
      halterColour: null,
      blanketSize: null,
      height: null,
      photoUrl: null,
      departedOn: '2020-01-01',
      spaces: { stall: null, pasture: null, paddock: null, barn: null },
    },
  ],
  attention: [],
}

describe('the horse list', () => {
  it('shows a horse at the rescue, with its Space', async () => {
    stubApi({ '/horses': HORSES })
    renderRoute('/horses', HorseList)

    expect(await screen.findByText('Apollo — Stall 4')).toBeTruthy()
  })

  it('hides a Departed horse from the work surface', async () => {
    stubApi({ '/horses': HORSES })
    renderRoute('/horses', HorseList)

    await waitFor(() => {
      expect(screen.queryByText('Apollo — Stall 4')).toBeTruthy()
    })
    expect(screen.queryByText(/Old Timer/)).toBeNull()
  })

  it('lists a horse with something going on, with the newest sentence against her name', async () => {
    stubApi({
      '/horses': {
        ...HORSES,
        attention: [
          {
            horseId: 'apollo-1',
            horseName: 'Apollo',
            because: 'alert',
            text: 'No treats by hand — she bites.',
            at: 1_772_000_000_000,
          },
        ],
      },
    })
    renderRoute('/horses', HorseList)

    // The directory opens first: *find Storm* is the common errand.
    expect(await screen.findByText('Apollo — Stall 4')).toBeTruthy()

    await userEvent.setup().click(screen.getByRole('tab', { name: /Something going on/ }))
    await waitFor(() => {
      expect(screen.getByText(/Standing alert — No treats by hand/)).toBeTruthy()
    })
  })

  it('names an open report as a report rather than as an alert', async () => {
    stubApi({
      '/horses': {
        ...HORSES,
        attention: [
          {
            horseId: 'apollo-1',
            horseName: 'Apollo',
            because: 'escalation',
            text: 'She needs the farrier this week.',
            at: 1_772_000_000_000,
          },
        ],
      },
    })
    renderRoute('/horses', HorseList)

    await userEvent.setup().click(await screen.findByRole('tab', { name: /Something going on/ }))
    await waitFor(() => {
      expect(screen.getByText(/Open report — She needs the farrier this week\./)).toBeTruthy()
    })
  })

  it('says nothing is going on rather than showing an empty list', async () => {
    stubApi({ '/horses': HORSES })
    renderRoute('/horses', HorseList)

    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Something going on' }))
    await waitFor(() => {
      expect(screen.getByText('Nothing going on with anybody right now.')).toBeTruthy()
    })
  })

  it('carries no Alert on a directory row — #60 decided that deliberately', async () => {
    stubApi({
      '/horses': {
        ...HORSES,
        attention: [
          {
            horseId: 'apollo-1',
            horseName: 'Apollo',
            because: 'alert',
            text: 'No treats by hand — she bites.',
            at: 1_772_000_000_000,
          },
        ],
      },
    })
    renderRoute('/horses', HorseList)

    await screen.findByText('Apollo — Stall 4')
    // On the other tab, not beside the name in the directory.
    expect(screen.queryByText(/No treats by hand/)).toBeNull()
  })

  it('shows the refusal text when the read fails', async () => {
    stubApi({})
    renderRoute('/horses', HorseList)

    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
