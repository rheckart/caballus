/**
 * A Visit, at the UI seam: the real route component, the real typed client,
 * only `fetch` stubbed (#32's testing decisions, #43).
 *
 * What is claimed: a Visit takes a description and a category and no Shift,
 * defaults to signing yourself in and out, and can name somebody else instead
 * — attributed to whoever taps the button, never to the person named
 * (ADR 0012).
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../test/api-stub'
import { chooseOption, renderRoutes } from '../test/route-harness'
import { Route } from './attendance'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderVisit() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoutes([{ path: '/attendance', component }], '/attendance')
}

const ME = {
  volunteerId: 'beth',
  name: 'Beth Ann',
  email: 'someone@barn.test',
  mobile: null,
  smsConsentAt: null,
  smsStoppedAt: null,
  domainScopes: [],
}

const PEOPLE = {
  today: '2026-08-18',
  people: [
    { id: 'beth', name: 'Beth Ann', state: 'volunteer' },
    { id: 'valerie', name: 'Valerie', state: 'volunteer' },
  ].map((person) => ({
    ...person,
    rosterable: true,
    gaps: [],
    isMinor: false,
    birthday: null,
    roles: [],
    domainScopes: [],
    medicationAuthority: false,
    hasAccount: true,
    consentIsHistorical: false,
    behindRoster: null,
  })),
  unstaffedScopes: [],
}

function watchPosts(extra: Record<string, unknown> = {}): { path: string; body: unknown }[] {
  const posted: { path: string; body: unknown }[] = []
  stubApi({
    '/volunteers': PEOPLE,
    '/me': ME,
    '/horses': { horses: [], attention: [] },
    '/attendance/sign-in': (init: RequestInit) => {
      posted.push({ path: '/attendance/sign-in', body: JSON.parse(String(init.body)) as unknown })
      return { attendanceId: 'new' }
    },
    '/attendance/sign-out': (init: RequestInit) => {
      posted.push({ path: '/attendance/sign-out', body: JSON.parse(String(init.body)) as unknown })
      return {}
    },
    '/observations': (init: RequestInit) => {
      posted.push({ path: '/observations', body: JSON.parse(String(init.body)) as unknown })
      return { observationId: 'obs-1' }
    },
    '/observations/note': (init: RequestInit) => {
      posted.push({ path: '/observations/note', body: JSON.parse(String(init.body)) as unknown })
      return {}
    },
    '/escalations': (init: RequestInit) => {
      posted.push({ path: '/escalations', body: JSON.parse(String(init.body)) as unknown })
      return { escalationId: 'esc-1' }
    },
    '/observations/new': { observations: [] },
    ...extra,
  })
  return posted
}

describe('a Visit, on the phone', () => {
  it('signs the volunteer looking at the phone in by default, with a description and a category', async () => {
    const posted = watchPosts()
    renderVisit()

    fireEvent.change(await screen.findByLabelText('What are you here to do?'), {
      target: { value: 'Mowed the north field' },
    })
    await chooseOption('Category', 'Maintenance and grounds')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]).toMatchObject({
      path: '/attendance/sign-in',
      body: {
        volunteerId: 'beth',
        description: 'Mowed the north field',
        category: 'maintenance',
      },
    })
    expect(posted[0]?.body).not.toHaveProperty('shiftId')
  })

  it('records for somebody else, attributed to whoever is signed in rather than to them', async () => {
    const posted = watchPosts()
    renderVisit()

    // Two pickers are named "Who" — sign in and sign out — so `chooseOption`
    // cannot disambiguate; this is its body, scoped to the sign-in one.
    const user = userEvent.setup()
    const whoTriggers = await screen.findAllByRole('combobox', { name: 'Who' })
    await user.click(whoTriggers[0] as HTMLElement)
    const listbox = await screen.findByRole('listbox')
    await user.click(within(listbox).getByRole('option', { name: 'Valerie' }))
    fireEvent.change(screen.getByLabelText('What are you here to do?'), {
      target: { value: 'Fundraiser table' },
    })
    await chooseOption('Category', 'Fundraising')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]?.body).toMatchObject({ volunteerId: 'valerie' })
  })

  it('signs out with no Attendance id, the server resolving the open Visit', async () => {
    const posted = watchPosts()
    renderVisit()

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]).toMatchObject({
      path: '/attendance/sign-out',
      body: { volunteerId: 'beth' },
    })
    expect(posted[0]?.body).not.toHaveProperty('shiftId')
  })
})

describe('Observations and their disposition on a Visit (ADR 0014)', () => {
  it('records an Observation against the Attendance opened by signing in', async () => {
    const posted = watchPosts()
    renderVisit()

    fireEvent.change(await screen.findByLabelText('What are you here to do?'), {
      target: { value: 'Mowed the north field' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => {
      expect(posted.some((call) => call.path === '/attendance/sign-in')).toBe(true)
    })

    fireEvent.change(await screen.findByLabelText('What did you see?'), {
      target: { value: 'The west gate latch is broken' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))

    await waitFor(() => {
      expect(posted.some((call) => call.path === '/observations')).toBe(true)
    })
    const written = posted.find((call) => call.path === '/observations')
    expect(written?.body).toMatchObject({
      text: 'The west gate latch is broken',
      subjectKind: null,
      subjectId: null,
    })
  })

  it('lists an undispositioned Observation and clears it with "noted, no action"', async () => {
    let recorded = false
    const posted = watchPosts({
      '/observations': (init: RequestInit) => {
        recorded = true
        posted.push({ path: '/observations', body: JSON.parse(String(init.body)) as unknown })
        return { observationId: 'obs-1' }
      },
      '/observations/new': () => ({
        observations: recorded
          ? [
              {
                id: 'obs-1',
                attendanceId: 'new',
                text: 'The west gate latch is broken',
                subjectKind: null,
                subjectId: null,
                subjectLabel: null,
                recordedBy: 'beth',
                recordedByName: 'Beth Ann',
                observedBy: 'beth',
                observedByName: 'Beth Ann',
                recordedAt: 0,
                dispositionedAt: null,
                disposition: null,
                escalatedScopes: [],
              },
            ]
          : [],
      }),
    })
    renderVisit()

    fireEvent.change(await screen.findByLabelText('What are you here to do?'), {
      target: { value: 'Mowed the north field' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() =>
      expect(posted.some((call) => call.path === '/attendance/sign-in')).toBe(true),
    )

    fireEvent.change(await screen.findByLabelText('What did you see?'), {
      target: { value: 'The west gate latch is broken' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Note, no action' }))
    await waitFor(() => {
      expect(posted.some((call) => call.path === '/observations/note')).toBe(true)
    })
    expect(posted.find((call) => call.path === '/observations/note')?.body).toMatchObject({
      observationId: 'obs-1',
    })
  })
})
