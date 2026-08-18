/**
 * A volunteer's own Shifts at the UI seam: the real route component, the real
 * typed client, and only `fetch` stubbed (#32's testing decisions, #39).
 *
 * What is claimed here: that *mine* means a roster row that still stands, that
 * Drop and Cover are the two actions a volunteer has and both are their own,
 * and that a Cover which does not reach the server **says so** — because it is
 * an online-only write and the commitment does not exist until it arrives
 * (ADR 0011, ADR 0018).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../test/api-stub'
import { renderRoutes } from '../test/route-harness'
import { Route } from './shifts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const component = Route.options.component

function renderShifts() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoutes([{ path: '/shifts', component }], '/shifts')
}

const ME = { volunteerId: 'beth', name: 'Beth Ann', domainScopes: [] }

function member(
  volunteerId: string,
  extra: Partial<{
    name: string
    position: string
    origin: string
    endedAs: string | null
    endedReason: string | null
  }> = {},
) {
  return {
    volunteerId,
    name: extra.name ?? 'Beth Ann',
    position: extra.position ?? 'volunteer',
    rosterable: true,
    gaps: [],
    origin: extra.origin ?? 'standing_roster',
    endedAs: extra.endedAs ?? null,
    endedReason: extra.endedReason ?? null,
  }
}

function shift(
  id: string,
  extra: Partial<{
    day: string
    shiftType: string
    startTime: string
    staffingMode: string
    purpose: string | null
    state: string
    roster: unknown[]
  }> = {},
) {
  return {
    id,
    patternId: extra.staffingMode === 'sign_up' ? null : 'tuesday-am',
    day: extra.day ?? '2026-08-18',
    shiftType: extra.shiftType ?? 'feed_am',
    startTime: extra.startTime ?? '06:30',
    targetHeadcount: 3,
    staffingMode: extra.staffingMode ?? 'standing_roster',
    purpose: extra.purpose ?? null,
    state: extra.state ?? 'scheduled',
    roster: extra.roster ?? [],
  }
}

const SCHEDULE = {
  today: '2026-08-18',
  shifts: [
    shift('mine', { roster: [member('beth')] }),
    shift('somebody-elses', {
      day: '2026-08-19',
      roster: [member('valerie', { name: 'Valerie' })],
    }),
    shift('open', {
      day: '2026-08-20',
      shiftType: 'pop_up',
      staffingMode: 'sign_up',
      purpose: 'Hose the horses down',
      roster: [],
    }),
  ],
}

/** Stubs both reads and keeps what was posted, the way the real endpoints pair. */
function watchPosts(schedule: unknown = SCHEDULE): { path: string; body: unknown }[] {
  const posted: { path: string; body: unknown }[] = []
  stubApi({
    '/shifts': (init: RequestInit) => {
      if (init.method !== 'POST') return schedule
      posted.push({ path: '/shifts', body: JSON.parse(String(init.body)) as unknown })
      return {}
    },
    '/me': ME,
    '/shifts/drop': (init: RequestInit) => {
      posted.push({ path: '/shifts/drop', body: JSON.parse(String(init.body)) as unknown })
      return {}
    },
    '/shifts/cover': (init: RequestInit) => {
      posted.push({ path: '/shifts/cover', body: JSON.parse(String(init.body)) as unknown })
      return { rosterId: 'covered' }
    },
  })
  return posted
}

describe('a volunteer’s own Shifts', () => {
  it('shows the Shifts they are on and not the ones they are not', async () => {
    watchPosts()
    renderShifts()

    // Hers is on the screen…
    expect(await screen.findByText('2026-08-18')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Drop' })).toBeTruthy()
    // …and Valerie's Tuesday, which she is not on, is not — the phone is a
    // volunteer's own list, not the Coordinator's fortnight.
    expect(screen.queryByText('2026-08-19')).toBeNull()
  })

  it('offers Cover on a Shift open to sign-up, and says how many are on it', async () => {
    watchPosts()
    renderShifts()

    expect(await screen.findByText(/Hose the horses down/)).toBeTruthy()
    expect(screen.getByText(/0 of 3 so far/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cover this' })).toBeTruthy()
  })

  it('drops with the reason somebody gave, and only from that Shift', async () => {
    const posted = watchPosts()
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('away that week'))
    renderShifts()

    fireEvent.click(await screen.findByRole('button', { name: 'Drop' }))

    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]).toMatchObject({
      path: '/shifts/drop',
      body: { shiftId: 'mine', reason: 'away that week' },
    })
  })

  it('drops with no reason at all, because a required one collects the word “personal”', async () => {
    const posted = watchPosts()
    vi.stubGlobal('prompt', vi.fn().mockReturnValue(''))
    renderShifts()

    fireEvent.click(await screen.findByRole('button', { name: 'Drop' }))
    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]?.body).toMatchObject({ shiftId: 'mine', reason: null })
  })

  it('does not drop when the volunteer changed their mind at the prompt', async () => {
    const posted = watchPosts()
    vi.stubGlobal('prompt', vi.fn().mockReturnValue(null))
    renderShifts()

    fireEvent.click(await screen.findByRole('button', { name: 'Drop' }))
    // Nothing to wait for: the claim is that nothing was sent.
    await Promise.resolve()
    expect(posted).toHaveLength(0)
  })

  it('covers a Shift, crediting nobody but the person tapping', async () => {
    const posted = watchPosts()
    renderShifts()

    fireEvent.click(await screen.findByRole('button', { name: 'Cover this' }))
    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    // No volunteer id travels: a commitment made for you is not a commitment.
    expect(posted[0]).toMatchObject({ path: '/shifts/cover', body: { shiftId: 'open' } })
    expect(posted[0]?.body).not.toHaveProperty('volunteerId')
  })

  it('says plainly when a Cover did not reach the server', async () => {
    // The whole reason this write does not queue: an Unsent Cover is two
    // volunteers each believing they have Thursday (ADR 0011).
    stubApi({
      '/shifts': (init: RequestInit) => {
        if (init.method !== 'POST') return SCHEDULE
        return {}
      },
      '/me': ME,
    })
    renderShifts()

    fireEvent.click(await screen.findByRole('button', { name: 'Cover this' }))
    // `stubApi` answers an unstubbed path with 404 not_found, which is what a
    // Cover meeting a server that cannot take it looks like from here.
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('treats a dropped row as not mine, and offers no second Drop', async () => {
    watchPosts({
      today: '2026-08-18',
      shifts: [
        shift('mine', {
          roster: [member('beth', { endedAs: 'dropped', endedReason: 'away that week' })],
        }),
      ],
    })
    renderShifts()

    expect(await screen.findByText('You are not on any Shift in the next fortnight.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Drop' })).toBeNull()
  })
})
