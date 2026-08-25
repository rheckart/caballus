/**
 * The volunteer record at the UI seam: the same modal of tabs the horse
 * record is (#62, ADR 0025), reached from an Edit button on the row. What is
 * claimed here is the shape rather than every write — the tabs are there, a
 * refusal lands inline beside the button pressed, and unsaved typing stops a
 * tab switch and asks.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { refused, stubApi } from '../../test/api-stub'
import { renderRoutes } from '../../test/route-harness'
import { Route } from './volunteers'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderDesk() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoutes([{ path: '/admin/volunteers', component }], '/admin/volunteers')
}

const joy = {
  id: 'v1',
  name: 'Joy',
  state: 'volunteer',
  rosterable: true,
  gaps: [],
  roles: [],
  medicationAuthority: false,
  isMinor: false,
  birthday: { month: 4, day: 2 },
  domainScopes: [],
  hasAccount: true,
  consentIsHistorical: false,
  behindRoster: {
    email: 'joy@example.com',
    mobile: null,
    dateOfBirth: '1990-04-02',
    dateOfBirthProvenance: 'photo_id',
    age: 36,
    turnsEighteenOn: null,
    orientedOn: '2026-01-04',
    consentedOn: null,
    parentName: null,
    signatures: [],
  },
}

function stubDesk(extra: Record<string, unknown | ((init: RequestInit) => unknown)> = {}) {
  stubApi({
    '/volunteers': { people: [joy], today: '2026-08-23', unstaffedScopes: [] },
    '/release-versions': { versions: [] },
    ...extra,
  })
}

async function openRecord(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  return await screen.findByRole('dialog')
}

describe('the volunteer record', () => {
  it('opens from Edit as a modal of four tabs', async () => {
    const user = userEvent.setup()
    stubDesk()
    renderDesk()

    const dialog = await openRecord(user)
    for (const label of ['Core Details', 'Paperwork', 'Roles', 'Departure']) {
      expect(within(dialog).getByRole('tab', { name: label })).toBeTruthy()
    }
    expect(within(dialog).getByText('joy@example.com', { exact: false })).toBeTruthy()
  })

  it('blocks a tab switch while typing is unsaved, and Throw them away moves on', async () => {
    const user = userEvent.setup()
    stubDesk()
    renderDesk()

    const dialog = await openRecord(user)
    await user.type(within(dialog).getByLabelText(/Reason/), 'wrong year on the paper')

    await user.click(within(dialog).getByRole('tab', { name: 'Roles' }))
    expect(within(dialog).getByText('You have changes you haven’t saved.')).toBeTruthy()
    expect(within(dialog).getByLabelText(/Reason/)).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Throw them away' }))
    expect(await within(dialog).findByText('Medication Authority')).toBeTruthy()
  })

  it('does not remove somebody because Enter was pressed in the reason field', async () => {
    const user = userEvent.setup()
    const posted: unknown[] = []
    stubDesk({
      '/volunteers/removal': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)))
        return undefined
      },
    })
    renderDesk()

    const dialog = await openRecord(user)
    await user.click(within(dialog).getByRole('tab', { name: 'Departure' }))
    await user.type(within(dialog).getByLabelText(/^Reason/), 'moved to Virginia{Enter}')

    // Before the confirmation is on screen this card renders no submit button
    // and holds exactly one text field, which is the shape HTML submits on
    // Enter — so the reflex that commits a field would otherwise remove
    // somebody from the rescue with nothing asked (#62's rule that a
    // destructive act confirms inline, in its own card).
    expect(posted).toEqual([])
    expect(within(dialog).queryByRole('button', { name: 'Yes — they have left' })).toBeNull()
  })

  it('puts a refused write beside the button that was pressed', async () => {
    const user = userEvent.setup()
    stubDesk({
      '/volunteers/date-of-birth': () => refused('volunteer_not_found'),
    })
    renderDesk()

    const dialog = await openRecord(user)
    await user.click(within(dialog).getByRole('button', { name: 'Record' }))
    expect(await within(dialog).findByText('That volunteer is not here any more.')).toBeTruthy()
  })
})
