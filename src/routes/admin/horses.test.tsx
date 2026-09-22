/**
 * The horse record at the UI seam (#62, ADR 0025): a modal of five tabs, one
 * form per tab, and the rule the shape rests on — unsaved typing stops a tab
 * switch and asks. What is claimed here is the ticket's own acceptance list:
 * the dirty-tab block, a refusal rendered inline beside the button pressed,
 * and the Location tab saving in order and stopping at the first refusal.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { refused, stubApi } from '../../test/api-stub'
import { chooseOption, renderRoutes } from '../../test/route-harness'
import { Route } from './horses'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderDesk() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoutes([{ path: '/admin/horses', component }], '/admin/horses')
}

const maple = {
  id: 'h1',
  name: 'Maple',
  halterColour: 'Red',
  blanketSize: null,
  height: null,
  photoUrl: null,
  departedOn: null,
  spaces: {
    stall: { id: 's1', name: 'Stall 1' },
    pasture: null,
    paddock: null,
    barn: null,
  },
}

const spaces = [
  { id: 's1', kind: 'stall', name: 'Stall 1', occupants: [], retiredOn: null },
  { id: 's2', kind: 'stall', name: 'Stall 2', occupants: [], retiredOn: null },
  { id: 'p1', kind: 'pasture', name: 'North pasture', occupants: [], retiredOn: null },
  { id: 'b1', kind: 'barn', name: 'Main barn', occupants: [], retiredOn: null },
]

const profile = {
  ...maple,
  alerts: [],
  feedSchedules: [
    {
      shiftType: 'feed_am',
      validFrom: '2026-08-01',
      isNew: false,
      lines: [
        {
          productId: 'pr1',
          productName: 'Senior',
          productKind: 'feed',
          amount: '1 scoop',
          route: 'in_feed',
        },
      ],
    },
  ],
  measurements: { weights: [], bodyConditions: [] },
  endedAlerts: [],
  timeline: [],
}

function stubDesk(extra: Record<string, unknown | ((init: RequestInit) => unknown)> = {}) {
  stubApi({
    '/horses': { horses: [maple], attention: [] },
    '/spaces': { spaces },
    '/products': { products: [] },
    '/horses/h1': profile,
    ...extra,
  })
}

async function openRecord(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  return await screen.findByRole('dialog')
}

describe('the horse record', () => {
  it('blocks a tab switch while typing is unsaved, and Throw them away moves on', async () => {
    const user = userEvent.setup()
    stubDesk()
    renderDesk()

    const dialog = await openRecord(user)
    await user.type(within(dialog).getByLabelText('Name'), ' Tree')

    await user.click(within(dialog).getByRole('tab', { name: 'Location' }))
    expect(within(dialog).getByText('You have changes you haven’t saved.')).toBeTruthy()
    // The switch did not happen: the About form is still on screen.
    expect(within(dialog).getByLabelText('Name')).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Throw them away' }))
    // Now it did, and the typing went with it.
    expect(await within(dialog).findByRole('combobox', { name: 'Stall' })).toBeTruthy()
    expect(within(dialog).queryByText('You have changes you haven’t saved.')).toBeNull()

    await user.click(within(dialog).getByRole('tab', { name: 'Core Details' }))
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Maple')
  })

  it('saves the dirty tab from the ask, then completes the switch', async () => {
    const user = userEvent.setup()
    const posted: unknown[] = []
    stubDesk({
      '/horses/attributes': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)))
        return undefined
      },
    })
    renderDesk()

    const dialog = await openRecord(user)
    await user.type(within(dialog).getByLabelText('Name'), ' Tree')
    await user.click(within(dialog).getByRole('tab', { name: 'Location' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save them' }))

    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]).toMatchObject({ horseId: 'h1', name: 'Maple Tree' })
    expect(await within(dialog).findByRole('combobox', { name: 'Stall' })).toBeTruthy()
  })

  it('refuses to depart a horse from Save them, because that is confirmed in its own card', async () => {
    const user = userEvent.setup()
    const posted: unknown[] = []
    stubDesk({
      '/horses/departure': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)))
        return undefined
      },
    })
    renderDesk()

    const dialog = await openRecord(user)
    await user.click(within(dialog).getByRole('tab', { name: 'Departure' }))
    await user.type(within(dialog).getByLabelText(/^Reason/), 'thinking about it')

    await user.click(within(dialog).getByRole('tab', { name: 'Core Details' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save them' }))

    // #62 keeps a destructive act's confirmation inside its own card — *I
    // recorded her orientation* must not share a button with *she is gone* —
    // and the unsaved-changes prompt is that shared button under another name.
    // Somebody who typed a reason and thought better of it reads *Save them* as
    // *keep my typing*, so it says where the real button is instead.
    expect(posted).toEqual([])
    expect(await within(dialog).findByText(/confirmed here, not from Save them/i)).toBeTruthy()
    // And the switch did not happen either: the typing is still there to
    // confirm or to throw away.
    await user.click(within(dialog).getByRole('tab', { name: 'Departure' }))
    expect((within(dialog).getByLabelText(/^Reason/) as HTMLInputElement).value).toBe(
      'thinking about it',
    )
  })

  it('renders a refusal inline, beside the button that was pressed', async () => {
    const user = userEvent.setup()
    stubDesk({
      '/horses/attributes': () => refused('horse_not_found'),
    })
    renderDesk()

    const dialog = await openRecord(user)
    await user.type(within(dialog).getByLabelText('Name'), ' Tree')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    // The message lands inside the record's own form, not at the top of the
    // page behind the modal.
    expect(await within(dialog).findByText('That horse is not here any more.')).toBeTruthy()
  })

  it('saves Location in order and stops at the first refusal', async () => {
    const user = userEvent.setup()
    const writes: { kind: string; spaceId: string | null }[] = []
    stubDesk({
      '/horses/space': (init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { kind: string; spaceId: string | null }
        writes.push({ kind: body.kind, spaceId: body.spaceId })
        if (body.kind === 'pasture') return refused('space_occupied')
        return undefined
      },
    })
    renderDesk()

    const dialog = await openRecord(user)
    await user.click(within(dialog).getByRole('tab', { name: 'Location' }))
    await within(dialog).findByRole('combobox', { name: 'Stall' })

    // Three changes: the stall saves, the pasture is refused, the barn —
    // later in the order — must never be posted.
    await chooseOption('Stall', 'Stall 2')
    await chooseOption('Pasture', 'North pasture')
    await chooseOption('Barn', 'Main barn')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(
        within(dialog).getByText('A horse still holds that Space. Clear it first.'),
      ).toBeTruthy()
    })
    expect(writes).toEqual([
      { kind: 'stall', spaceId: 's2' },
      { kind: 'pasture', spaceId: 'p1' },
    ])
  })
  it('says so inside the record when the profile read fails, and retries', async () => {
    const user = userEvent.setup()
    let answering = false
    stubDesk({
      '/horses/h1': () => (answering ? profile : refused('horse_not_found')),
    })
    renderDesk()

    const dialog = await openRecord(user)
    await user.click(within(dialog).getByRole('tab', { name: 'Feeding' }))

    // Not *Loading the schedule…* forever behind a modal nothing can see past.
    expect(await within(dialog).findByText('That horse is not here any more.')).toBeTruthy()

    answering = true
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))
    expect(await within(dialog).findByText('Senior', { exact: false })).toBeTruthy()
  })

  it('retires one Shift Type by publishing a version with no lines', async () => {
    const user = userEvent.setup()
    const posted: unknown[] = []
    stubDesk({
      '/feed-schedules': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)))
        return { id: 'fs2' }
      },
    })
    renderDesk()

    const dialog = await openRecord(user)
    await user.click(within(dialog).getByRole('tab', { name: 'Feeding' }))
    await user.click(await within(dialog).findByRole('button', { name: 'Retire this feeding' }))

    await user.type(within(dialog).getByLabelText('Stopping on'), '2026-09-01')
    await user.click(within(dialog).getByRole('button', { name: 'Yes — retire this feeding' }))

    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]).toMatchObject({
      horseId: 'h1',
      shiftType: 'feed_am',
      validFrom: '2026-09-01',
      lines: [],
    })
  })
})

describe('a herd moved in one act (#99)', () => {
  const birch = { ...maple, id: 'h2', name: 'Birch', spaces: { ...maple.spaces, stall: null } }
  const cedar = { ...maple, id: 'h3', name: 'Cedar', departedOn: '2026-01-01' }

  function me(domainScopes: string[]) {
    return {
      volunteerId: 'v1',
      name: 'Priya',
      email: 'priya@barn.test',
      mobile: null,
      smsConsentAt: null,
      smsStoppedAt: null,
      domainScopes,
    }
  }

  it('ticks horses, picks a Pasture, reviews the names, and lists the one skipped', async () => {
    const user = userEvent.setup()
    const posted: unknown[] = []
    stubDesk({
      '/horses': { horses: [maple, birch, cedar], attention: [] },
      '/me': me(['horse_care']),
      '/horses/space/batch': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)))
        return { assigned: ['h1', 'h2'], skipped: [{ horseId: 'h3', because: 'horse_departed' }] }
      },
    })
    renderDesk()

    await user.click(await screen.findByRole('checkbox', { name: 'Select all showing' }))
    const bar = await screen.findByRole('region', { name: 'With the ticked' })
    expect(within(bar).getByText('3 horses ticked')).toBeTruthy()
    // Only the kinds that hold a herd: twelve horses into one stall is a mistake.
    await user.click(within(bar).getByRole('combobox', { name: 'Kind' }))
    const kinds = await screen.findByRole('listbox')
    expect(within(kinds).queryByRole('option', { name: 'Stall' })).toBeNull()
    await user.click(within(kinds).getByRole('option', { name: 'Pasture' }))
    await chooseOption('Move them to', 'North pasture')
    await user.click(within(bar).getByRole('button', { name: 'Review' }))

    const review = await screen.findByRole('dialog')
    for (const name of ['Maple', 'Birch', 'Cedar']) {
      expect(within(review).getByText(name)).toBeTruthy()
    }
    expect(posted).toHaveLength(0)
    await user.click(within(review).getByRole('button', { name: 'Confirm for 3' }))

    expect(await within(review).findByText('Done for 2 of 3.')).toBeTruthy()
    expect(within(review).getByText('Cedar — has Departed')).toBeTruthy()
    expect(posted[0]).toMatchObject({
      horseIds: ['h1', 'h2', 'h3'],
      kind: 'pasture',
      spaceId: 'p1',
    })
  })

  it('sends spaceId null for None, which brings the herd in', async () => {
    const user = userEvent.setup()
    const posted: unknown[] = []
    stubDesk({
      '/horses': { horses: [maple, birch], attention: [] },
      '/me': me(['horse_care']),
      '/horses/space/batch': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)))
        return { assigned: ['h1'], skipped: [] }
      },
    })
    renderDesk()

    await user.click(await screen.findByRole('checkbox', { name: 'Select Maple' }))
    await chooseOption('Kind', 'Pasture')
    await chooseOption('Move them to', 'None')
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm for 1' }))

    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]).toMatchObject({ horseIds: ['h1'], kind: 'pasture', spaceId: null })
  })

  it('offers no ticking at all to somebody without horse_care', async () => {
    stubDesk({ '/me': me(['roster']) })
    renderDesk()

    expect(await screen.findByText('Maple')).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Select all showing' })).toBeNull()
  })
})
