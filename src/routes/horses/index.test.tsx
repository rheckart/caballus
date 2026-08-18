/**
 * The horse list, through Testing Library — the UI seam #32's testing
 * decisions add: a real route component, a real router, and fetch stubbed at
 * the network boundary so the real typed client and contract parsing
 * participate.
 */
import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../../test/api-stub'
import { renderRoute } from '../../test/route-harness'
import { HorseList } from './index'

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
      spaces: { stall: { id: 'stall-4', name: 'Stall 4' }, field: null, barn: null },
    },
    {
      id: 'gone-1',
      name: 'Old Timer',
      halterColour: null,
      blanketSize: null,
      height: null,
      photoUrl: null,
      departedOn: '2020-01-01',
      spaces: { stall: null, field: null, barn: null },
    },
  ],
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

  it('shows the refusal text when the read fails', async () => {
    stubApi({})
    renderRoute('/horses', HorseList)

    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
