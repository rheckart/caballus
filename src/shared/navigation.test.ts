/**
 * The two things a hand-declared navigation can get wrong, asserted.
 *
 * The first is a screen added without an entry, which ADR 0026 says must fail
 * the build rather than appear for everybody — so the table below is read off
 * the filesystem rather than written out a second time. A route file is a
 * Destination unless it is one of the four kinds that cannot be one, and each
 * exclusion is named.
 *
 * The second is `navigationFor` offering something it should not, or hiding a
 * group instead of emptying it.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { DESTINATIONS, navigationFor } from './navigation'
import { DOMAIN_SCOPES } from './domain-scopes'

const ROUTES = 'src/routes'

/**
 * Every route file in the application, as the path the router serves it at.
 *
 * Four kinds are dropped, and none of them is a Destination:
 *
 * - **`__root` and `api.$`** are not screens at all — the shell itself, and
 *   the catch-all that hands `/api/v1` to Hono.
 * - **Anything with a `$` segment** is a detail screen — `/horses/$horseId`,
 *   `/shifts/$shiftId` — reached *from* a Destination and never listed as one.
 * - **`/login`** is the screen you reach by not being signed in, and the shell
 *   stays off it (ADR 0022's other half).
 * - **`.test.tsx`** is a test beside the screen it tests.
 */
function screensOnDisk(directory = ROUTES, prefix = ''): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return screensOnDisk(join(directory, entry.name), `${prefix}/${entry.name}`)
    }
    const name = entry.name.replace(/\.tsx?$/, '')
    if (name.includes('.test')) return []
    if (name === '__root' || name === 'api.$') return []

    const path = name === 'index' ? prefix || '/' : `${prefix}/${name.replaceAll('.', '/')}`
    if (path.includes('$')) return []
    if (path === '/login') return []
    return [path]
  })
}

it('offers every screen the shell can render, and invents none', () => {
  expect([...DESTINATIONS.map((destination) => destination.to)].sort()).toEqual(
    [...screensOnDisk()].sort(),
  )
})

it('names a Domain Scope this build knows, or none at all', () => {
  for (const destination of DESTINATIONS) {
    for (const scope of destination.scopes) {
      expect(DOMAIN_SCOPES).toContain(scope)
    }
  }
})

describe('what a person is offered', () => {
  it('offers a Volunteer holding nothing General alone, with no Admin heading', () => {
    const offered = navigationFor([])

    expect(offered.map((group) => group.group)).toEqual(['general'])
    // The one General Destination behind a Scope goes with it (#43 put the
    // Attendance ledger behind `roster`), and the rest stay.
    expect(offered[0]?.destinations.map((destination) => destination.to)).toEqual([
      '/',
      '/shifts',
      '/horses',
      '/board',
      '/supplies',
      '/contacts',
      '/escalations',
    ])
  })

  it('offers a President everything', () => {
    const offered = navigationFor(DOMAIN_SCOPES)

    expect(offered.map((group) => group.group)).toEqual(['general', 'admin'])
    expect(offered.flatMap((group) => group.destinations)).toEqual(DESTINATIONS)
  })

  it('offers a Coordinator the roster desk and not the horse desk', () => {
    const admin = navigationFor(['roster']).find((group) => group.group === 'admin')

    expect(admin?.destinations.map((destination) => destination.to)).toEqual([
      '/admin/volunteers',
      '/admin/shift-patterns',
      '/admin/attendance',
      '/admin/release-versions',
      '/admin/contacts',
      '/admin/whiteboard-read',
      '/admin/audit',
    ])
  })

  it('offers a two-Scope Destination to a holder of either', () => {
    const products = (held: 'horse_care' | 'supplies') =>
      navigationFor([held])
        .flatMap((group) => group.destinations)
        .some((destination) => destination.to === '/admin/products')

    expect(products('horse_care')).toBe(true)
    expect(products('supplies')).toBe(true)
  })

  it('offers the supplies desk to a holder of `supplies` and nothing else of the desk', () => {
    const admin = navigationFor(['supplies']).find((group) => group.group === 'admin')

    expect(admin?.destinations.map((destination) => destination.to)).toEqual(['/admin/products'])
  })
})
