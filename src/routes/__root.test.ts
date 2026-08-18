import { expect, it } from 'vitest'

import { Route } from './__root'

/**
 * The installable half of ADR 0004 (#48) is three tags in the document
 * `<head>` — a manifest, an icon, and a theme colour — and nothing about
 * signing in or the Board reads any of them. Asserted directly against the
 * route's `head` function, because `src/test/route-harness.tsx` builds its
 * own bare root route rather than rendering this one.
 */
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
