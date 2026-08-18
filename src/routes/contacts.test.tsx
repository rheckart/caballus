/**
 * Contacts, at the UI seam: the real route component, the real typed client,
 * and only `fetch` stubbed (#32's testing decisions, #46).
 *
 * What is claimed here: the screen is read-only — every posted number, its
 * hours and what it is for, plus the standing rules, and no form or button
 * anywhere on it (ADR 0014).
 */
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../test/api-stub'
import { renderRoutes } from '../test/route-harness'
import { Route } from './contacts'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderContacts() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoutes([{ path: '/contacts', component }], '/contacts')
}

describe('the Contacts screen', () => {
  it('shows every posted number, its hours and what it is for', async () => {
    stubApi({
      '/contacts': {
        contacts: [
          {
            id: 'c1',
            name: 'Wolf Creek Equine Clinic',
            number: '555-0100',
            hours: '9am–5pm M–F',
            purpose: 'Vet office',
          },
        ],
        standingRules: [],
      },
    })
    renderContacts()

    expect(await screen.findByText(/Wolf Creek Equine Clinic/)).toBeTruthy()
    expect(screen.getByText(/555-0100/)).toBeTruthy()
    expect(screen.getByText(/9am–5pm M–F/)).toBeTruthy()
    expect(screen.getByText(/Vet office/)).toBeTruthy()
  })

  it('shows the standing rules alongside the contacts', async () => {
    stubApi({
      '/contacts': {
        contacts: [],
        standingRules: [{ id: 'r1', text: 'No scissors in fields.' }],
      },
    })
    renderContacts()

    expect(await screen.findByText('No scissors in fields.')).toBeTruthy()
  })

  it('has no action anywhere on it — editing lives at /admin/contacts', async () => {
    stubApi({
      '/contacts': {
        contacts: [
          { id: 'c1', name: 'Terry H.', number: '555-0101', hours: null, purpose: 'Maintenance' },
        ],
        standingRules: [{ id: 'r1', text: 'Take turns wide.' }],
      },
    })
    renderContacts()

    await screen.findByText(/Terry H\./)
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.queryAllByRole('textbox')).toEqual([])
  })
})
