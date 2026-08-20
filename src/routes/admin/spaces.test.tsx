/**
 * The Spaces desk at the UI seam, and specifically the run: *how many stalls
 * do you have* (#49).
 *
 * What is claimed here is the promise the preview makes — **the names on the
 * screen are the names that are sent**. The numbering is a pure function
 * (`src/shared/spaces.test.ts` covers it exhaustively); what this covers is
 * that nothing between the box and the wire re-derives it, and that a name the
 * rescue already has is shown as one this will leave alone before anybody
 * presses the button.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../../test/api-stub'
import { renderRoute } from '../../test/route-harness'
import { Route } from './spaces'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderSpaces() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoute('/admin/spaces', component)
}

function space(name: string, kind = 'stall') {
  // `retiredOn` is not optional on the wire: the client parses every answer
  // against the contract, so a fixture missing it fails to parse and the screen
  // sees no Spaces at all rather than a type error.
  return { id: name, kind, name, occupants: [], retiredOn: null }
}

describe('adding several Spaces', () => {
  it('previews every name it is about to create', async () => {
    stubApi({ '/spaces': { spaces: [] } })
    renderSpaces()

    fireEvent.click(await screen.findByRole('button', { name: 'Add several' }))
    fireEvent.change(screen.getByLabelText('How many?'), { target: { value: '3' } })

    expect(screen.getByText('Stall 1')).toBeTruthy()
    expect(screen.getByText('Stall 2')).toBeTruthy()
    expect(screen.getByText('Stall 3')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add 3 Spaces' })).toBeTruthy()
  })

  it('sends exactly the names it previewed', async () => {
    const posted: unknown[] = []
    stubApi({
      '/spaces': (init: RequestInit) => {
        if (init.method !== 'POST') return { spaces: [] }
        return { spaces: [] }
      },
      '/spaces/batch': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)) as unknown)
        return { spaceIds: ['a', 'b'], skipped: [] }
      },
    })
    renderSpaces()

    fireEvent.click(await screen.findByRole('button', { name: 'Add several' }))
    fireEvent.change(screen.getByLabelText('How many?'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Starting at'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 Spaces' }))

    await waitFor(() => {
      expect(posted.length).toBe(1)
    })
    // The key is the client's own, added on the way out (ADR 0020); what this
    // claims is that the names crossed the wire exactly as previewed.
    expect(posted[0]).toMatchObject({ kind: 'stall', names: ['Stall 7', 'Stall 8'] })
  })

  it('marks a name the rescue already carries, and does not count it', async () => {
    stubApi({ '/spaces': { spaces: [space('Stall 1'), space('Stall 2')] } })
    renderSpaces()

    fireEvent.click(await screen.findByRole('button', { name: 'Add several' }))
    fireEvent.change(screen.getByLabelText('How many?'), { target: { value: '3' } })

    // Scoped to the preview: the table behind the sheet says "Stall 1" too,
    // which is the whole reason the preview has to mark it.
    const preview = within(screen.getByRole('list', { name: 'The names to be added' }))
    expect(screen.getByText(/2 names are already taken/)).toBeTruthy()
    expect(preview.getByText('Stall 1').dataset.held).toBe('true')
    expect(preview.getByText('Stall 3').dataset.held).toBe('false')
    expect(screen.getByRole('button', { name: 'Add 1 Space' })).toBeTruthy()
  })

  it('letters a run of pastures, since that is how a barn names them', async () => {
    stubApi({ '/spaces': { spaces: [] } })
    renderSpaces()

    fireEvent.click(await screen.findByRole('button', { name: 'Add several' }))
    fireEvent.click(screen.getByLabelText('Pasture'))
    fireEvent.change(screen.getByLabelText('How many?'), { target: { value: '2' } })

    expect(screen.getByText('Pasture A')).toBeTruthy()
    expect(screen.getByText('Pasture B')).toBeTruthy()
  })

  it('offers nothing to press when the whole run already exists', async () => {
    stubApi({ '/spaces': { spaces: [space('Stall 1')] } })
    renderSpaces()

    fireEvent.click(await screen.findByRole('button', { name: 'Add several' }))
    fireEvent.change(screen.getByLabelText('How many?'), { target: { value: '1' } })

    expect(screen.getByText(/Nothing to add/)).toBeTruthy()
  })
})
