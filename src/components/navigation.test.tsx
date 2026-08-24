/**
 * What the sidebar offers, rendered (#66, ADR 0026).
 *
 * `src/shared/navigation.test.ts` asserts the table; this asserts that the
 * shell draws it — that a plain Volunteer meets no **Admin** heading at all
 * rather than an empty one, that an officer meets both groups, and that the
 * account footer is absent for somebody the server has not named yet.
 *
 * Rendered inside a real router with a real route for every Destination,
 * because a `<Link>` to a path the router does not know is a different
 * failure from a Destination that was not offered, and this test must not
 * confuse them.
 */
import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'

import { Navigation } from './navigation'
import { SidebarProvider } from './ui/sidebar'
import { renderRoutes } from '../test/route-harness'
import { DESTINATIONS } from '../shared/navigation'
import type { DomainScope } from '../shared/domain-scopes'

/** Every Destination as a route that renders nothing, so `<Link>` resolves. */
const elsewhere = DESTINATIONS.filter((destination) => destination.to !== '/').map(
  (destination) => ({ path: destination.to, component: () => null }),
)

function show(me: { name: string; domainScopes: readonly DomainScope[] } | null) {
  renderRoutes(
    [
      {
        path: '/',
        component: () => (
          <SidebarProvider>
            <Navigation
              me={
                me === null
                  ? null
                  : { volunteerId: 'v1', name: me.name, domainScopes: [...me.domainScopes] }
              }
              path="/"
            />
          </SidebarProvider>
        ),
      },
      ...elsewhere,
    ],
    '/',
  )
}

it('offers a Volunteer holding nothing the General group and no Admin heading', async () => {
  show({ name: 'Beth Ann', domainScopes: [] })

  expect(await screen.findByRole('link', { name: 'Shifts' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Horses' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /admin/i })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Volunteers' })).toBeNull()
  // #43 put the Attendance ledger behind `roster`, which is the one General
  // Destination that can be missing.
  expect(screen.queryByRole('link', { name: 'Attendance' })).toBeNull()
})

it('offers a Coordinator the Admin group, with the roster desk in it', async () => {
  show({ name: 'Kate', domainScopes: ['roster'] })

  expect(await screen.findByRole('button', { name: /admin/i })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Volunteers' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Attendance' })).toBeTruthy()
  // `horse_care`'s own screens are not hers, and are not drawn.
  expect(screen.queryByRole('link', { name: 'Tasks' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Thresholds' })).toBeNull()
})

it('names the account and offers Sign out once the server has said who is reading', async () => {
  show({ name: 'Kate', domainScopes: ['roster'] })

  expect(await screen.findByText('Kate')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Theme' })).toBeTruthy()
})

it('draws the barn but no account for a visitor the server has not named', async () => {
  show(null)

  expect(await screen.findByRole('link', { name: 'Shifts' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
})
