/**
 * The Contacts desk at the UI seam — and the proof screen for ADR 0025's
 * install (#61): the table, the shadcn Dialog the sheet became, and a write
 * posted through the real typed client, all rendered through the new
 * components.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../../test/api-stub'
import { renderRoutes } from '../../test/route-harness'
import { Route } from './contacts'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderDesk() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoutes([{ path: '/admin/contacts', component }], '/admin/contacts')
}

const page = {
  contacts: [
    { id: 'vet', name: 'Dr. Reyes', number: '410-555-0100', hours: null, purpose: 'The vet' },
  ],
  standingRules: [{ id: 'rule-1', text: 'No scissors in fields' }],
}

describe('the contacts desk', () => {
  it('renders the posted numbers and the standing rules', async () => {
    stubApi({ '/contacts': page })
    renderDesk()

    expect(await screen.findByText('Dr. Reyes')).toBeTruthy()
    expect(screen.getByText('Any time')).toBeTruthy()
    expect(screen.getByText('No scissors in fields')).toBeTruthy()
  })

  it('adds a contact through the sheet and posts the form as typed', async () => {
    const user = userEvent.setup()
    const posted: unknown[] = []
    stubApi({
      '/contacts': (init: RequestInit) => {
        if (init.method === 'POST') {
          posted.push(JSON.parse(String(init.body)))
          return { contactId: 'new' }
        }
        return page
      },
    })
    renderDesk()

    await user.click(await screen.findByRole('button', { name: 'Add a contact' }))
    // The sheet is shadcn's Dialog now: a real dialog role, in a portal.
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeTruthy()

    await user.type(screen.getByLabelText('Name'), 'Farrier')
    await user.type(screen.getByLabelText('Number'), '410-555-0199')
    await user.type(screen.getByLabelText('What it is for'), 'Hooves')
    await user.click(screen.getByRole('button', { name: 'Add the contact' }))

    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]).toMatchObject({
      name: 'Farrier',
      number: '410-555-0199',
      hours: null,
      purpose: 'Hooves',
    })
    // Saved closes the sheet.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('closes the sheet with Escape', async () => {
    const user = userEvent.setup()
    stubApi({ '/contacts': page })
    renderDesk()

    await user.click(await screen.findByRole('button', { name: 'Add a rule' }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})
