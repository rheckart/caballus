/**
 * The installable shell's service worker (ADR 0004, #48).
 *
 * One job: precache the app shell so the app opens on a bad bar of signal —
 * "and for nothing else" is ADR 0004's own words, and the reason this file
 * never touches `/api/`. The retry queue (`src/shared/tick-queue.ts`, #42)
 * already owns write durability with its own rules about what a caught error
 * means; a second cache in front of it with opinions about freshness would be
 * a second, disagreeing answer to a question #42 already answers. So every
 * `/api/` request is left alone entirely — not cached, not intercepted, not
 * even passed through `respondWith` — and a network failure surfaces to
 * `src/shared/api-client.ts` exactly as it would with no service worker
 * installed at all.
 *
 * Two request shapes get a strategy, and nothing else does:
 *
 * - A navigation (a document request) is **network-first**. Online, a
 *   volunteer always gets the page the server just rendered, which is what
 *   keeps a new deploy's bundle from being trapped behind a cached HTML file
 *   — there is no version to go stale because the shell is never served from
 *   cache while the network answers. The response is cached as it passes
 *   through, keyed by its exact URL, so a reload of that same page has
 *   something to open into; offline, the cached shell answers instead of the
 *   browser's own error page, and whatever a volunteer taps inside it (the
 *   queue's Unsent state, in particular) is `#42`'s to answer from there.
 * - Everything under `/assets/` is Vite's content-hashed build output — the
 *   bytes at a given URL never change, so it is **cache-first**: a hit
 *   answers with no network at all, a miss goes to the network once and is
 *   cached for every request after.
 *
 * Nothing else is intercepted — a font, an uncategorised path, anything this
 * file does not recognise falls through to the network unchanged.
 *
 * **Update strategy.** `self.skipWaiting()` on install and
 * `self.clients.claim()` on activate: a new deploy's worker takes over the
 * moment the browser has fetched it — which, per spec, it checks on every
 * navigation to this scope — rather than waiting for every open tab to
 * close first. That is safe only because navigation is network-first: the
 * next page a volunteer opens already asks the network for fresh HTML and
 * fresh content-hashed asset URLs, so an old tab and a new worker never
 * disagree about which bytes belong to which hash. `CACHE_NAME` carries a
 * hand-bumped version; `activate` deletes every cache under the
 * `caballus-shell-` prefix that is not the current one, so bumping it is
 * what retires whatever the previous deploy cached instead of it
 * accumulating in storage forever — the mechanism that keeps the shell from
 * being stuck on an old version, decided and recorded here rather than left
 * for whoever notices the cache growing.
 */
const CACHE_VERSION = 'v1'
const CACHE_NAME = `caballus-shell-${CACHE_VERSION}`

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name.startsWith('caballus-shell-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request))
  }
})

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    await cache.put(request, response.clone())
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) return cached
    throw error
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  await cache.put(request, response.clone())
  return response
}
