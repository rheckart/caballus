/**
 * Home, at the UI seam: the real route component, the real typed client, and
 * only `fetch` stubbed (#32's testing decisions, #46).
 *
 * What is claimed here: the Announcements section exists only when there is
 * something to show, any Domain Scope holder — not an enumerated pair — sees
 * the posting form, and someone with no Scope at all sees neither the form
 * nor an Edit button (ADR 0018).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../test/api-stub'
import { renderRoutes } from '../test/route-harness'
import { Route } from './index'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderHome() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoutes([{ path: '/', component }], '/')
}

function me(domainScopes: readonly string[] = []) {
  return { volunteerId: 'beth', name: 'Beth Ann', domainScopes }
}

function announcement(overrides: Partial<Record<string, unknown>> = {}) {
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
    ...overrides,
  }
}

describe('Home’s Announcements', () => {
  it('shows no section when there is nothing posted', async () => {
    stubApi({ '/me': me([]), '/announcements': { today: '2026-08-18', announcements: [] } })
    renderHome()

    await screen.findByText('Signed in as Beth Ann.')
    expect(screen.queryByText('Announcements')).toBeNull()
  })

  it('shows unexpired Announcements when there are any', async () => {
    stubApi({
      '/me': me([]),
      '/announcements': { today: '2026-08-18', announcements: [announcement()] },
    })
    renderHome()

    expect(await screen.findByText(/The hay comes Thursday\./)).toBeTruthy()
    expect(screen.getByText(/posted by Lori/)).toBeTruthy()
  })

  it('offers no posting form to somebody holding no Domain Scope', async () => {
    stubApi({ '/me': me([]), '/announcements': { today: '2026-08-18', announcements: [] } })
    renderHome()

    await screen.findByText('You hold no domain scopes.')
    expect(screen.queryByText('Post an announcement')).toBeNull()
  })

  it('offers the posting form to a holder of any single Domain Scope', async () => {
    // The Treasurer's scope guards nothing else in v1 — the case ADR 0018
    // names as the reason this is not an enumerated pair.
    stubApi({
      '/me': me(['financial']),
      '/announcements': { today: '2026-08-18', announcements: [] },
    })
    renderHome()

    expect(await screen.findByText('Post an announcement')).toBeTruthy()
  })

  it('posts an Announcement with no subject field anywhere in the form', async () => {
    let posted: Record<string, unknown> | null = null
    stubApi({
      '/me': me(['roster']),
      '/announcements': (init: RequestInit) => {
        if (init.method === 'POST') {
          posted = JSON.parse(String(init.body)) as Record<string, unknown>
          return { announcementId: 'a2' }
        }
        return { today: '2026-08-18', announcements: [] }
      },
    })
    renderHome()

    const text = await screen.findByLabelText('Text')
    fireEvent.change(text, { target: { value: 'The vet is here Tuesday.' } })
    fireEvent.change(screen.getByLabelText('Expires on'), { target: { value: '2026-08-25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(posted).toMatchObject({ text: 'The vet is here Tuesday.', expiresOn: '2026-08-25' })
    })
    // No field on the wire could name a horse, a Space or a Product.
    expect(Object.keys(posted ?? {}).sort()).toEqual(['expiresOn', 'idempotencyKey', 'text'].sort())
  })

  it('lets any Domain Scope holder edit somebody else’s Announcement', async () => {
    stubApi({
      '/me': me(['roster']),
      '/announcements': { today: '2026-08-18', announcements: [announcement()] },
    })
    renderHome()

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy()
  })
})
