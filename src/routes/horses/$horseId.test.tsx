/**
 * The horse profile, and navigating to it from the list — driving the real
 * route components the way a volunteer's tap does (#32's testing decisions).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../../test/api-stub'
import { renderRoutes } from '../../test/route-harness'
import { HorseProfile } from './$horseId'
import { HorseList } from './index'

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
  spaces: { stall: { id: 'stall-4', name: 'Stall 4' }, field: null, barn: null },
}

describe('the horse profile', () => {
  it('shows Alerts first, with nothing under it yet', async () => {
    stubApi({ '/horses/apollo-1': PROFILE })
    renderProfileAt('apollo-1')

    const alerts = await screen.findByRole('heading', { name: 'Alerts' })
    expect(alerts).toBeTruthy()
    expect(screen.getByText('No alerts recorded.')).toBeTruthy()
  })

  it('shows the attributes and Space assignments', async () => {
    stubApi({ '/horses/apollo-1': PROFILE })
    renderProfileAt('apollo-1')

    expect(await screen.findByText('Halter colour: blue')).toBeTruthy()
    expect(screen.getByText('Stall: Stall 4')).toBeTruthy()
    expect(screen.getByText('Field: not assigned')).toBeTruthy()
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
            spaces: { stall: { id: 'stall-4', name: 'Stall 4' }, field: null, barn: null },
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
})
