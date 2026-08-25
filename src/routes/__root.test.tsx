/**
 * The document's own tags, and the one decision the shell makes before it
 * draws anything: **is there a sidebar at all**.
 *
 * The head is asserted against `Route.options.head` directly, because
 * `src/test/route-harness.tsx` builds its own bare root route rather than
 * rendering this one. The shell is rendered, because *a signed-out visitor is
 * offered fourteen ways to be refused* is a bug a type cannot catch.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route, Shell } from './__root'
import { refused, stubApi } from '../test/api-stub'
import { renderRoutes } from '../test/route-harness'
import { DESTINATIONS } from '../shared/navigation'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('names the manifest and the icon the browser needs to install the app', async () => {
  const head = await Route.options.head?.({} as never)

  expect(head?.links).toEqual(
    expect.arrayContaining([
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/icons/icon-192.png' },
      { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
    ]),
  )
  expect(head?.meta).toEqual(expect.arrayContaining([{ name: 'theme-color', content: '#0f5d55' }]))
})

/** Every Destination as a route that renders nothing, so `<Link>` resolves. */
const elsewhere = DESTINATIONS.filter((destination) => destination.to !== '/').map(
  (destination) => ({ path: destination.to, component: () => null }),
)

function renderShell(at = '/') {
  return renderRoutes([{ path: '/', component: Shell }, ...elsewhere], at)
}

/**
 * The sidebar itself, by its accessible name. Named rather than queried
 * globally because *Shifts* is deliberately in two places at once — the
 * sidebar and the phone's bottom tab bar — and a bare `getByRole` cannot tell
 * a test which of them it found.
 */
const sidebar = () => screen.queryByRole('navigation', { name: 'Caballus' })
const tabBar = () => screen.queryByRole('navigation', { name: 'Main' })

function me(domainScopes: readonly string[] = []) {
  return {
    volunteerId: 'beth',
    name: 'Beth Ann',
    email: 'beth@barn.test',
    mobile: null,
    domainScopes,
  }
}

describe('whether the shell is drawn at all', () => {
  it('draws the navigation for somebody signed in', async () => {
    stubApi({ '/me': me() })
    renderShell()

    await screen.findByRole('button', { name: 'Sign out' })
    expect(within(sidebar() as HTMLElement).getByRole('link', { name: 'Shifts' })).toBeTruthy()
    expect(tabBar()).not.toBeNull()
  })

  it('draws none of it for a visitor who is not signed in', async () => {
    // The explicit 401 ADR 0010 makes a status rather than an empty body. A
    // menu of fourteen Destinations in front of somebody with no session is
    // fourteen ways to be refused; the hero on `/` says *sign in* on its own.
    stubApi({ '/me': refused('not_authorized', 401) })
    renderShell()

    await waitFor(() => {
      expect(tabBar()).toBeNull()
    })
    expect(sidebar()).toBeNull()
    expect(screen.queryByRole('link', { name: 'Shifts' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('draws none of it while the answer is still coming', () => {
    stubApi({ '/me': me() })
    renderShell()

    // One round trip, on a full load only. A navigation that appears and then
    // vanishes is worse than one that arrives a beat late, and the answer this
    // is waiting on is what decides whether it belongs there at all.
    expect(sidebar()).toBeNull()
    expect(tabBar()).toBeNull()
  })

  it('keeps the navigation when the read did not arrive, at its floor', async () => {
    // Not a refusal — a dropped connection. A volunteer whose signal went in a
    // barn must not also lose the way back to Shifts, and none of this is a
    // boundary: the server refuses on its own (ADR 0026).
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    )
    renderShell()

    await waitFor(() => {
      expect(sidebar()).not.toBeNull()
    })
    expect(within(sidebar() as HTMLElement).getByRole('link', { name: 'Shifts' })).toBeTruthy()
    // No account footer, because there is no account to name.
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('stays off the Board, which is the barn and not a person', async () => {
    stubApi({ '/me': me(['roster']) })
    renderRoutes(
      [
        { path: '/board', component: Shell },
        ...elsewhere.filter((route) => route.path !== '/board'),
      ],
      '/board',
    )

    // ADR 0022: the tablet authenticates as the barn and resolves to no actor,
    // so chrome on it is chrome somebody has to walk over and look past.
    await waitFor(() => {
      expect(sidebar()).toBeNull()
    })
    expect(tabBar()).toBeNull()
  })
})
