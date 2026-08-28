/**
 * Home, at the UI seam: the real route component, the real typed client, and
 * only `fetch` stubbed (#32's testing decisions, #67).
 *
 * What is claimed here. **One request** — `/home` is composed by the server, so
 * a screen opened cold on barn signal has one way to be half-loaded rather than
 * four (#60's argument on the Board, applied to the dashboard). **Every section
 * vanishes when it is empty**, all four of them, and four empty is one sentence
 * rather than four blank headings (ADR 0018). **What a Shift is missing is
 * spelled in the words `staffingFact` writes** — *no Lead*, *2 of 4 wanted* —
 * and the internal phrase *staffing gap* reaches no part of the document
 * (ADR 0011). **A signed-out visitor still gets an answer**, because `/home`'s
 * explicit 401 and a broken server are different facts. And the two claims #46
 * made about posting survive the rewrite: any single Domain Scope holder is
 * offered the form, somebody holding none is offered neither it nor an Edit.
 *
 * The old tile grid is gone with #66 — navigation carries every Destination
 * now — so its labels are asserted absent rather than merely dropped from the
 * fixtures, which is the difference between a claim and an omission.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi, refused } from '../test/api-stub'
import { renderRoutes } from '../test/route-harness'
import { API_BASE } from '../shared/api-client'
import { Route } from './index'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderHome() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoutes([{ path: '/', component }], '/')
}

/**
 * The day every fixture is anchored to. Dates are chosen against it rather
 * than taken from the clock, because the screen says *Today* and *Tomorrow*
 * for the first two days and the date after that — a fixture drifting past
 * that boundary would fail on a Wednesday and pass on a Thursday.
 */
const TODAY = '2026-08-18'
const TOMORROW = '2026-08-19'

/** A quiet morning: signed in, and nothing in any of the four sections. */
function page(overrides: Record<string, unknown> = {}) {
  return {
    today: TODAY,
    me: { volunteerId: 'beth', name: 'Beth Ann', domainScopes: [] },
    nextShift: null,
    announcements: [],
    cover: [],
    escalations: [],
    ...overrides,
  }
}

function me(domainScopes: readonly string[]) {
  return { volunteerId: 'beth', name: 'Beth Ann', domainScopes }
}

function announcement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    text: 'The hay comes Thursday.',
    expiresOn: '2026-08-25',
    authoredBy: 'lori',
    authoredByName: 'Lori',
    authoredAt: 1_768_366_800_000,
    lastEditedBy: null,
    lastEditedByName: null,
    lastEditedAt: null,
    urgentSentAt: null,
    ...overrides,
  }
}

/** One Shift short of people, with its gaps left to the test to name. */
function coverable(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shift-2',
    day: TOMORROW,
    shiftType: 'feed_pm',
    startTime: '16:00',
    targetHeadcount: 3,
    standing: 1,
    gaps: ['no_lead'],
    ...overrides,
  }
}

function escalation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'esc-1',
    scope: 'horse_care',
    framing: 'Dawson is favouring the near hind.',
    observationText: 'He would not put weight on it coming in.',
    observationSubjectLabel: 'Dawson',
    escalatedAt: 1_768_366_800_000,
    comments: 0,
    ...overrides,
  }
}

describe('the Home screen', () => {
  it('asks the server exactly once, for the composed page', async () => {
    stubApi({ '/home': page() })
    renderHome()

    await screen.findByText('Signed in as Beth Ann.')
    // Not "at most one /home": one call in total, because a second read the
    // phone could have composed this from is the thing #67 removed.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe(`${API_BASE}/home`)
  })

  it('drops all four sections on a morning with nothing in them, and says so in one sentence', async () => {
    stubApi({ '/home': page() })
    renderHome()

    expect(
      await screen.findByText(
        'Nothing needs you right now — no shift coming up, nothing posted, nothing short and nothing open.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('Announcements')).toBeNull()
    expect(screen.queryByText('Shifts needing cover')).toBeNull()
    expect(screen.queryByText('Your open escalations')).toBeNull()
  })

  it('leads with the Shift you are standing on next', async () => {
    stubApi({
      '/home': page({
        nextShift: {
          id: 'shift-1',
          day: TODAY,
          shiftType: 'feed_am',
          startTime: '06:30',
          purpose: null,
          state: 'scheduled',
          more: 2,
        },
      }),
    })
    renderHome()

    expect(await screen.findByText('Feed AM at 06:30')).toBeTruthy()
    expect(screen.getByText('2 more after this')).toBeTruthy()
    // The quiet line is the *all four empty* case and not a fallback.
    expect(screen.queryByText(/Nothing needs you right now/)).toBeNull()
  })

  it('shows what has been posted on the wall', async () => {
    stubApi({ '/home': page({ announcements: [announcement()] }) })
    renderHome()

    expect(await screen.findByText(/The hay comes Thursday\./)).toBeTruthy()
    expect(screen.getByText('Announcements')).toBeTruthy()
    expect(screen.getByText(/posted by Lori/)).toBeTruthy()
  })

  it('shows the Shifts short of people that this reader could cover', async () => {
    stubApi({ '/home': page({ cover: [coverable()] }) })
    renderHome()

    expect(await screen.findByText('Shifts needing cover')).toBeTruthy()
    expect(screen.getByText('Tomorrow — Feed PM at 16:00')).toBeTruthy()
  })

  it('shows the open Escalations addressed to a Scope this reader holds', async () => {
    stubApi({ '/home': page({ me: me(['horse_care']), escalations: [escalation()] }) })
    renderHome()

    expect(await screen.findByText('Your open escalations')).toBeTruthy()
    expect(screen.getByText('Dawson is favouring the near hind.')).toBeTruthy()
    expect(screen.getByText(/He would not put weight on it coming in\./)).toBeTruthy()
  })

  it('spells a missing Lead in words rather than as a category name', async () => {
    stubApi({ '/home': page({ cover: [coverable({ gaps: ['no_lead'] })] }) })
    renderHome()

    expect(await screen.findByText(/no Lead/)).toBeTruthy()
    // ADR 0011 keeps the term internal: it is what the wire carries and never
    // what a volunteer reads.
    expect(document.body.textContent).not.toMatch(/staffing gap/i)
  })

  it('spells being under the wanted headcount as the two numbers it is', async () => {
    stubApi({
      '/home': page({
        cover: [coverable({ gaps: ['below_target_headcount'], standing: 2, targetHeadcount: 4 })],
      }),
    })
    renderHome()

    expect(await screen.findByText(/2 of 4 wanted/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/staffing gap/i)
  })

  it('offers a signed-out visitor the way in rather than a broken screen', async () => {
    stubApi({ '/home': refused('not_authorized', 401) })
    renderHome()

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeTruthy()
    expect(screen.queryByText(/Something is wrong/)).toBeNull()
  })

  /**
   * The public page (#75, ADR 0028). It is `/`'s signed-out branch, and what
   * it has to carry is decided by a carrier's vetting reviewer rather than by
   * taste: the two SMS cases and no others, how somebody opted in, how to
   * stop, and somewhere to write.
   */
  describe('the public page a visitor with no session gets', () => {
    function renderSignedOut() {
      stubApi({ '/home': refused('not_authorized', 401) })
      renderHome()
    }

    it('names the two cases a text carries, and says there are no others', async () => {
      renderSignedOut()

      expect(await screen.findByText('What we send by text')).toBeTruthy()
      expect(screen.getByText(/Two things, and nothing else, ever/)).toBeTruthy()
      expect(screen.getByText(/shift you could work is short of people/)).toBeTruthy()
      expect(screen.getByText(/Rescue news that will not keep/)).toBeTruthy()
      // The things that stay on email, said out loud — a reviewer comparing
      // this page against the campaign's samples is the reader who matters.
      expect(screen.getByText(/your sign-in code — goes by email/)).toBeTruthy()
    })

    it('says how somebody opted in, which is the other half vetting asks for', async () => {
      renderSignedOut()

      expect(await screen.findByText(/There is no public sign-up/)).toBeTruthy()
      expect(screen.getAllByText(/Volunteer Coordinator/).length).toBeGreaterThan(0)
      expect(screen.getByText(/asked whether Caballus may text you/)).toBeTruthy()
    })

    it('says how to stop, and that stopping never locks anybody out', async () => {
      renderSignedOut()

      expect(await screen.findByText('How to stop')).toBeTruthy()
      expect(screen.getByText('STOP')).toBeTruthy()
      // ADR 0029's separation, stated where the person affected reads it: a
      // volunteer who replied STOP to a staffing text must still be able to
      // sign in.
      expect(screen.getByText(/never locks you out of the app/)).toBeTruthy()
    })

    it('gives somewhere to write', async () => {
      renderSignedOut()

      const contact = await screen.findByRole('link', { name: 'rob@heckart.me' })
      expect(contact.getAttribute('href')).toBe('mailto:rob@heckart.me')
    })

    it('shows a signed-in volunteer none of it', async () => {
      stubApi({ '/home': page() })
      renderHome()

      await screen.findByText('Signed in as Beth Ann.')
      expect(screen.queryByText('What we send by text')).toBeNull()
      expect(screen.queryByText('How to stop')).toBeNull()
    })
  })

  it('carries none of the tile grid #66 replaced with navigation', async () => {
    stubApi({ '/home': page({ me: me(['roster', 'horse_care']) }) })
    renderHome()

    await screen.findByText('Signed in as Beth Ann.')
    for (const label of ['Read the whiteboard', 'Audit log', 'Release versions']) {
      expect(screen.queryByText(label)).toBeNull()
    }
  })
})

describe('Home’s posting form', () => {
  it('offers it to a holder of any single Domain Scope', async () => {
    // The Treasurer's scope guards nothing else in v1 — the case ADR 0018
    // names as the reason this is not an enumerated pair.
    stubApi({ '/home': page({ me: me(['financial']) }) })
    renderHome()

    expect(await screen.findByText('Post an announcement')).toBeTruthy()
  })

  it('offers neither the form nor an Edit to somebody holding no Domain Scope', async () => {
    stubApi({ '/home': page({ announcements: [announcement()] }) })
    renderHome()

    await screen.findByText(/The hay comes Thursday\./)
    expect(screen.queryByText('Post an announcement')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('posts an Announcement with no subject field anywhere on the wire', async () => {
    let posted: Record<string, unknown> | null = null
    stubApi({
      '/home': page({ me: me(['roster']) }),
      '/announcements': (init: RequestInit) => {
        posted = JSON.parse(String(init.body)) as Record<string, unknown>
        return { announcementId: 'a2' }
      },
    })
    renderHome()

    fireEvent.change(await screen.findByLabelText('Text'), {
      target: { value: 'The vet is here Tuesday.' },
    })
    fireEvent.change(screen.getByLabelText('Expires on'), { target: { value: '2026-08-25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(posted).toMatchObject({ text: 'The vet is here Tuesday.', expiresOn: '2026-08-25' })
    })
    // No field on the wire could name a horse, a Space or a Product.
    expect(Object.keys(posted ?? {}).sort()).toEqual(['expiresOn', 'idempotencyKey', 'text'].sort())
  })

  it('lets any Domain Scope holder edit somebody else’s Announcement in place', async () => {
    let edited: Record<string, unknown> | null = null
    stubApi({
      '/home': page({ me: me(['roster']), announcements: [announcement()] }),
      '/announcements/edit': (init: RequestInit) => {
        edited = JSON.parse(String(init.body)) as Record<string, unknown>
        return {}
      },
    })
    renderHome()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    // The posting form carries a `Text` field of its own, so the edit's is
    // named by the id it derives from the Announcement rather than by label.
    fireEvent.change(screen.getByLabelText('Text', { selector: '#edit-announcement-text-a1' }), {
      target: { value: 'The hay comes Friday.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(edited).toMatchObject({ announcementId: 'a1', text: 'The hay comes Friday.' })
    })
  })
})
