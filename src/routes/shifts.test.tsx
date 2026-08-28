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

const ME = {
  volunteerId: 'beth',
  name: 'Beth Ann',
  email: 'someone@barn.test',
  mobile: null,
  domainScopes: [],
}

function member(
  volunteerId: string,
  extra: Partial<{
    name: string
    position: string
    origin: string
    endedAs: string | null
    endedReason: string | null
    medicationAuthority: boolean
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
    medicationAuthority: extra.medicationAuthority ?? false,
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
    gaps: string[]
    suggestedActingLead: string | null
    short: unknown
    attendance: unknown[]
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
    staffing: {
      gaps: extra.gaps ?? [],
      suggestedActingLead: extra.suggestedActingLead ?? null,
    },
    short: extra.short ?? null,
    attendance: extra.attendance ?? [],
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
    '/shifts/short': (init: RequestInit) => {
      posted.push({ path: '/shifts/short', body: JSON.parse(String(init.body)) as unknown })
      return {}
    },
    '/shifts/acting-lead': (init: RequestInit) => {
      posted.push({ path: '/shifts/acting-lead', body: JSON.parse(String(init.body)) as unknown })
      return { rosterId: 'acting' }
    },
    '/attendance/sign-in': (init: RequestInit) => {
      posted.push({ path: '/attendance/sign-in', body: JSON.parse(String(init.body)) as unknown })
      return { attendanceId: 'signed-in' }
    },
    '/attendance/sign-out': (init: RequestInit) => {
      posted.push({ path: '/attendance/sign-out', body: JSON.parse(String(init.body)) as unknown })
      return {}
    },
  })
  return posted
}

describe('what a Shift is missing, as a sentence rather than a category', () => {
  it('says the fact, and never the words “staffing gap”', async () => {
    watchPosts({
      today: '2026-08-18',
      shifts: [
        shift('open', {
          day: '2026-08-20',
          staffingMode: 'sign_up',
          gaps: ['no_lead', 'below_target_headcount', 'no_medication_authority'],
          roster: [member('valerie', { name: 'Valerie' })],
        }),
      ],
    })
    renderShifts()

    expect(
      await screen.findByText(/no Lead, 1 of 3 wanted, nobody who can give medication/),
    ).toBeTruthy()
    expect(screen.queryByText(/staffing gap/i)).toBeNull()
    // And the Cover button is still there: a Shift needing medication takes
    // somebody who cannot give it (ADR 0011).
    expect(screen.getByRole('button', { name: 'Cover this' })).toBeTruthy()
  })

  it('holds the facts back beyond roughly 48 hours, where nobody can act yet', async () => {
    watchPosts({
      today: '2026-08-18',
      shifts: [
        shift('open', {
          // Ten days out. ADR 0011 computes the gaps across the fortnight for
          // holders of `roster` and makes them prominent to everyone else only
          // inside roughly the next 48 hours — a fortnight of *no Lead* on a
          // phone is a screen people stop reading.
          day: '2026-08-28',
          staffingMode: 'sign_up',
          gaps: ['no_lead', 'below_target_headcount'],
          roster: [member('valerie', { name: 'Valerie' })],
        }),
      ],
    })
    renderShifts()

    // Still listed, still coverable, still counted.
    expect(await screen.findByText('2026-08-28')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cover this' })).toBeTruthy()
    expect(screen.getByText(/1 of 3 so far/)).toBeTruthy()
    expect(screen.queryByText(/no Lead/)).toBeNull()
  })

  it('names Short as somebody’s call rather than as another computed fact', async () => {
    watchPosts({
      today: '2026-08-18',
      shifts: [
        shift('mine', {
          // Ten days out, so the computed facts are held back — and Short is
          // shown anyway, because it is not arithmetic. A person decided it.
          day: '2026-08-28',
          roster: [member('beth')],
          gaps: ['below_target_headcount'],
          short: { declaredAt: 1_755_000_000_000, declaredBy: 'priya', urgentSentAt: null },
        }),
      ],
    })
    renderShifts()

    expect(await screen.findByText(/somebody has called this shift short/i)).toBeTruthy()
    expect(screen.queryByText(/wanted/)).toBeNull()
  })

  it('offers Short to a Lead on their own Shift, and to nobody else', async () => {
    const posted = watchPosts({
      today: '2026-08-18',
      shifts: [
        shift('led', { roster: [member('beth', { position: 'lead' })], gaps: [] }),
        shift('not-led', {
          day: '2026-08-19',
          roster: [member('beth', { position: 'volunteer' })],
          gaps: ['no_lead'],
        }),
      ],
    })
    renderShifts()

    // One button, on the Shift she leads. The server refuses anybody else, and
    // a button that is always there and always fails teaches people to distrust
    // the screen (ADR 0011).
    const buttons = await screen.findAllByRole('button', { name: 'Call it short' })
    expect(buttons).toHaveLength(1)

    fireEvent.click(buttons[0] as HTMLElement)
    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]).toMatchObject({
      path: '/shifts/short',
      body: { shiftId: 'led', short: true },
    })
  })
})

describe('the Acting Lead claim', () => {
  it('is offered on a leaderless Shift, and says when it is the suggestion', async () => {
    const posted = watchPosts({
      today: '2026-08-18',
      shifts: [
        shift('mine', {
          roster: [member('beth')],
          gaps: ['no_lead'],
          suggestedActingLead: 'beth',
        }),
      ],
    })
    renderShifts()

    const claim = await screen.findByRole('button', {
      name: 'Take charge as acting lead (suggested)',
    })
    fireEvent.click(claim)

    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]).toMatchObject({ path: '/shifts/acting-lead', body: { shiftId: 'mine' } })
  })

  it('is offered to somebody the app did not suggest, because it is not a restriction', async () => {
    watchPosts({
      today: '2026-08-18',
      shifts: [
        shift('mine', {
          roster: [member('beth'), member('valerie', { name: 'Valerie' })],
          gaps: ['no_lead'],
          suggestedActingLead: 'valerie',
        }),
      ],
    })
    renderShifts()

    expect(await screen.findByRole('button', { name: 'Take charge as acting lead' })).toBeTruthy()
  })

  it('is not offered where somebody already leads', async () => {
    watchPosts({
      today: '2026-08-18',
      shifts: [shift('mine', { roster: [member('beth', { position: 'lead' })], gaps: [] })],
    })
    renderShifts()

    expect(await screen.findByText('2026-08-18')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /acting lead/i })).toBeNull()
  })
})

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

describe('signing in and out, on the phone (ADR 0012)', () => {
  it('signs in against the Shift it is on, attributed to nobody but self', async () => {
    const posted = watchPosts()
    renderShifts()

    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]).toMatchObject({
      path: '/attendance/sign-in',
      body: { volunteerId: 'beth', shiftId: 'mine' },
    })
  })

  it('offers Sign out once the Shift shows an open arrival for this volunteer', async () => {
    watchPosts({
      today: '2026-08-18',
      shifts: [
        shift('mine', {
          roster: [member('beth')],
          attendance: [{ volunteerId: 'beth', arrivedAt: 1_700_000_000_000, departedAt: null }],
        }),
      ],
    })
    renderShifts()

    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
  })

  it('signs out with no Attendance id — the server resolves the open one', async () => {
    const posted = watchPosts({
      today: '2026-08-18',
      shifts: [
        shift('mine', {
          roster: [member('beth')],
          attendance: [{ volunteerId: 'beth', arrivedAt: 1_700_000_000_000, departedAt: null }],
        }),
      ],
    })
    renderShifts()

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]).toMatchObject({
      path: '/attendance/sign-out',
      body: { volunteerId: 'beth', shiftId: 'mine' },
    })
  })

  it('shows the fourth roster fact — rostered, absent, no Drop — to whoever carries Shift Authority', async () => {
    watchPosts({
      today: '2026-08-18',
      shifts: [
        shift('mine', {
          state: 'in_progress',
          roster: [member('beth', { position: 'lead' }), member('valerie', { name: 'Valerie' })],
          // Beth, the Lead reading this screen, has already signed herself in —
          // only Valerie is left unaccounted for.
          attendance: [{ volunteerId: 'beth', arrivedAt: 1_700_000_000_000, departedAt: null }],
        }),
      ],
    })
    renderShifts()

    expect(await screen.findByText('Rostered, not yet signed in: Valerie')).toBeTruthy()
  })

  it('says nothing once the missing name has signed in too', async () => {
    watchPosts({
      today: '2026-08-18',
      shifts: [
        shift('mine', {
          state: 'in_progress',
          roster: [member('beth', { position: 'lead' }), member('valerie', { name: 'Valerie' })],
          attendance: [
            { volunteerId: 'beth', arrivedAt: 1_700_000_000_000, departedAt: null },
            { volunteerId: 'valerie', arrivedAt: 1_700_000_000_000, departedAt: null },
          ],
        }),
      ],
    })
    renderShifts()

    await screen.findByRole('button', { name: 'Sign out' })
    expect(screen.queryByText(/Rostered, not yet signed in/)).toBeNull()
  })
})
