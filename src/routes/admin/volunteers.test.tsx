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
import { chooseOption, renderRoutes } from '../../test/route-harness'
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
    smsConsentAt: null,
    smsStoppedAt: null,
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

  /**
   * Clearing a recorded STOP (#82, ADR 0028). The carrier never tells us the
   * volunteer texted START, so a person has to say so — and the button exists
   * only where there is one to clear, because a button against an already-null
   * column is a Coordinator wondering what it did.
   */
  it('offers to clear a recorded STOP, and names the volunteer it is about', async () => {
    const user = userEvent.setup()
    let posted: unknown = null
    stubDesk({
      '/volunteers': {
        people: [
          { ...joy, behindRoster: { ...joy.behindRoster, smsStoppedAt: 1_772_000_000_000 } },
        ],
        today: '2026-08-23',
        unstaffedScopes: [],
      },
      '/volunteers/sms-stop-clearance': (init: RequestInit) => {
        posted = JSON.parse(String(init.body)) as unknown
        return undefined
      },
    })
    renderDesk()

    const dialog = await openRecord(user)
    expect(within(dialog).getByText(/They replied STOP/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Clear the recorded STOP' }))

    expect(posted).toMatchObject({ volunteerId: 'v1' })
  })

  it('offers nothing to clear when no STOP is recorded', async () => {
    const user = userEvent.setup()
    stubDesk()
    renderDesk()

    const dialog = await openRecord(user)
    expect(within(dialog).queryByRole('button', { name: 'Clear the recorded STOP' })).toBeNull()
    // Withdrawing consent is a different sentence in a different column, and
    // writing a STOP from here stays impossible.
    expect(within(dialog).getByRole('button', { name: 'Record consent to text' })).toBeTruthy()
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

describe('a class is one act (#100)', () => {
  const kai = { ...joy, id: 'v2', name: 'Kai', state: 'candidate', behindRoster: null }
  const lee = { ...joy, id: 'v3', name: 'Lee', state: 'candidate', behindRoster: null }

  function stubClass(extra: Record<string, unknown | ((init: RequestInit) => unknown)> = {}) {
    stubDesk({
      '/volunteers': { people: [joy, kai, lee], today: '2026-09-20', unstaffedScopes: [] },
      '/release-versions': {
        versions: [
          // Published ahead of its valid-from: newest, but not current yet.
          { id: 'rv3', label: 'Updated 2027', validFrom: '2027-01-01', obsoletesPrior: true },
          { id: 'rv2', label: 'Updated 2026', validFrom: '2026-01-01', obsoletesPrior: true },
          { id: 'rv1', label: 'Updated 2020', validFrom: '2020-01-01', obsoletesPrior: false },
        ],
      },
      ...extra,
    })
  }

  it('orients the ticked on one date, reviewing the names first and naming the skipped after', async () => {
    const user = userEvent.setup()
    const posted: unknown[] = []
    stubClass({
      '/volunteers/orientation/batch': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)))
        return { done: ['v2', 'v3'], skipped: [{ volunteerId: 'v1', because: 'already_oriented' }] }
      },
    })
    renderDesk()

    await user.click(await screen.findByRole('checkbox', { name: 'Select all showing' }))
    const bar = await screen.findByRole('region', { name: 'With the ticked' })
    expect(within(bar).getByText('3 people ticked')).toBeTruthy()
    // Orientation is the default act, dated today.
    expect((within(bar).getByLabelText('Oriented on') as HTMLInputElement).value).toBe('2026-09-20')
    await user.click(within(bar).getByRole('button', { name: 'Review' }))

    const review = await screen.findByRole('dialog')
    for (const name of ['Joy', 'Kai', 'Lee']) expect(within(review).getByText(name)).toBeTruthy()
    await user.click(within(review).getByRole('button', { name: 'Confirm for 3' }))

    expect(await within(review).findByText('Done for 2 of 3.')).toBeTruthy()
    expect(within(review).getByText('Joy — already oriented')).toBeTruthy()
    expect(posted[0]).toMatchObject({ volunteerIds: ['v1', 'v2', 'v3'], orientedOn: '2026-09-20' })
  })

  it('selects only the people the search is showing', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 9 }, (_, index) => ({
      ...joy,
      id: `m${String(index)}`,
      name: index < 2 ? `Morgan ${String(index)}` : `Pat ${String(index)}`,
    }))
    stubClass({ '/volunteers': { people: many, today: '2026-09-20', unstaffedScopes: [] } })
    renderDesk()

    await user.type(await screen.findByLabelText('Find somebody'), 'Morgan')
    await user.click(screen.getByRole('checkbox', { name: 'Select all showing' }))
    const bar = await screen.findByRole('region', { name: 'With the ticked' })
    expect(within(bar).getByText('2 people ticked')).toBeTruthy()
  })

  it('records a Release against the current Version by default, sending no byParent', async () => {
    const user = userEvent.setup()
    const posted: Record<string, unknown>[] = []
    stubClass({
      '/volunteers/release/batch': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return { done: ['v2'], skipped: [] }
      },
    })
    renderDesk()

    await user.click(await screen.findByRole('checkbox', { name: 'Select Kai' }))
    await chooseOption('Act', 'Record a Release')
    expect(screen.getByRole('combobox', { name: 'Release Version' }).textContent).toContain(
      'Updated 2026',
    )
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm for 1' }))

    await within(await screen.findByRole('dialog')).findByText('Done for 1 of 1.')
    expect(posted[0]).toMatchObject({
      volunteerIds: ['v2'],
      releaseVersionId: 'rv2',
      signedOn: '2026-09-20',
    })
    expect(posted[0]).not.toHaveProperty('byParent')
  })

  it('grants one Role to the ticked with one reason', async () => {
    const user = userEvent.setup()
    const posted: unknown[] = []
    stubClass({
      '/volunteers/roles/batch': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)))
        return { done: ['v2', 'v3'], skipped: [] }
      },
    })
    renderDesk()

    await user.click(await screen.findByRole('checkbox', { name: 'Select Kai' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Lee' }))
    await chooseOption('Act', 'Grant a Role')
    await chooseOption('Role', 'Event Coordinator')
    await user.type(screen.getByLabelText(/Reason/), 'Runs the October open house')
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm for 2' }))

    await within(await screen.findByRole('dialog')).findByText('Done for 2 of 2.')
    expect(posted[0]).toMatchObject({
      volunteerIds: ['v2', 'v3'],
      role: 'event_coordinator',
      reason: 'Runs the October open house',
    })
  })

  it('offers texts off in bulk and never texts on', async () => {
    const user = userEvent.setup()
    const posted: unknown[] = []
    stubClass({
      '/volunteers/sms-consent/batch': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)))
        return { done: ['v1'], skipped: [] }
      },
    })
    renderDesk()

    await user.click(await screen.findByRole('checkbox', { name: 'Select Joy' }))
    await user.click(screen.getByRole('combobox', { name: 'Act' }))
    const acts = await screen.findByRole('listbox')
    expect(within(acts).queryByRole('option', { name: /texts on/i })).toBeNull()
    await user.click(within(acts).getByRole('option', { name: 'Turn texts off' }))
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm for 1' }))

    await within(await screen.findByRole('dialog')).findByText('Done for 1 of 1.')
    expect(posted[0]).toMatchObject({ volunteerIds: ['v1'], consented: false })
  })
})
