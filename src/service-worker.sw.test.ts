import { expect, it, vi } from 'vitest'

import swSource from '../public/sw.js?raw'

/**
 * `public/sw.js` is a static asset, served to the browser exactly as
 * written rather than bundled — so this reads it as text (Vite's `?raw`) and
 * runs it with `new Function`, passing fake `self`, `caches` and `fetch` in
 * as parameters rather than stubbing real globals. That is deliberate and
 * not just convenient: the file is a **classic** worker script (registered
 * with no `{ type: 'module' }`), and anything that made it import cleanly as
 * an ES module here — an `export {}`, say — would be a syntax error in the
 * one place this file actually runs.
 *
 * Its two strategies and its update behaviour are exactly the part of ADR
 * 0004 this ticket (#48) is about, so they get the same behavioural coverage
 * anything else load-bearing in this codebase would.
 */

interface FakeCache {
  match: (request: FakeRequest) => Promise<FakeResponse | undefined>
  put: (request: FakeRequest, response: FakeResponse) => Promise<void>
}

class FakeResponse {
  constructor(public readonly body: string) {}
  clone(): FakeResponse {
    return this
  }
}

interface FakeRequest {
  readonly url: string
  readonly method: string
  readonly mode?: string
}

function makeRequest(url: string, mode?: string): FakeRequest {
  return { url, method: 'GET', mode }
}

function makeFakeCaches() {
  const named = new Map<string, { store: Map<string, FakeResponse>; cache: FakeCache }>()

  function cacheFor(name: string) {
    let entry = named.get(name)
    if (!entry) {
      const store = new Map<string, FakeResponse>()
      const cache: FakeCache = {
        match: (request) => Promise.resolve(store.get(request.url)),
        put: (request, response) => {
          store.set(request.url, response)
          return Promise.resolve()
        },
      }
      entry = { store, cache }
      named.set(name, entry)
    }
    return entry
  }

  return {
    open: vi.fn((name: string) => Promise.resolve(cacheFor(name).cache)),
    keys: vi.fn(() => Promise.resolve([...named.keys()])),
    delete: vi.fn((name: string) => Promise.resolve(named.delete(name))),
    storeFor: (name: string) => cacheFor(name).store,
  }
}

type Listener = (event: unknown) => void

function makeFakeSelf() {
  const listeners = new Map<string, Listener>()
  return {
    addEventListener: vi.fn((type: string, handler: Listener) => listeners.set(type, handler)),
    location: { origin: 'https://caballus.example' },
    clients: { claim: vi.fn(() => Promise.resolve()) },
    skipWaiting: vi.fn(),
    listeners,
  }
}

/** Runs a fresh copy of the worker against a fresh set of fake globals. */
function load() {
  const fakeSelf = makeFakeSelf()
  const fakeCaches = makeFakeCaches()
  const fetchMock = vi.fn<(request: FakeRequest) => Promise<FakeResponse>>()

  const run = new Function('self', 'caches', 'fetch', swSource)
  run(fakeSelf, fakeCaches, fetchMock)

  return { fakeSelf, fakeCaches, fetchMock }
}

it('never intercepts an /api/ request — not cached, not answered from a fallback', () => {
  const { fakeSelf, fetchMock } = load()
  const fetchListener = fakeSelf.listeners.get('fetch')
  expect(fetchListener).toBeTypeOf('function')

  let responded: unknown = 'not called'
  fetchListener?.({
    request: makeRequest('https://caballus.example/api/v1/shifts', 'navigate'),
    respondWith: (value: unknown) => {
      responded = value
    },
  })

  expect(responded).toBe('not called')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('answers a navigation from the network, and caches it under its own URL for offline', async () => {
  const { fakeSelf, fakeCaches, fetchMock } = load()
  const online = new FakeResponse('<html>shell</html>')
  fetchMock.mockResolvedValueOnce(online)

  const fetchListener = fakeSelf.listeners.get('fetch')
  const request = makeRequest('https://caballus.example/shifts/sh_1', 'navigate')
  let responded: Promise<unknown> = Promise.resolve()
  fetchListener?.({
    request,
    respondWith: (value: Promise<unknown>) => {
      responded = value
    },
  })

  const answer = await responded
  expect(answer).toBe(online)
  expect(await fakeCaches.storeFor('caballus-shell-v1').get(request.url)).toBe(online)
})

it('falls back to the cached shell for a navigation when the network fails offline', async () => {
  const { fakeSelf, fakeCaches, fetchMock } = load()
  const request = makeRequest('https://caballus.example/shifts/sh_1', 'navigate')
  fakeCaches.storeFor('caballus-shell-v1').set(request.url, new FakeResponse('<html>cached</html>'))
  fetchMock.mockRejectedValueOnce(new Error('offline'))

  const fetchListener = fakeSelf.listeners.get('fetch')
  let responded: Promise<unknown> = Promise.resolve()
  fetchListener?.({
    request,
    respondWith: (value: Promise<unknown>) => {
      responded = value
    },
  })

  const answer = (await responded) as FakeResponse
  expect(answer.body).toBe('<html>cached</html>')
})

it('answers a hashed asset from cache without touching the network on a hit', async () => {
  const { fakeSelf, fakeCaches, fetchMock } = load()
  const request = makeRequest('https://caballus.example/assets/index-abc123.js')
  const cached = new FakeResponse('console.log(1)')
  fakeCaches.storeFor('caballus-shell-v1').set(request.url, cached)

  const fetchListener = fakeSelf.listeners.get('fetch')
  let responded: Promise<unknown> = Promise.resolve()
  fetchListener?.({
    request,
    respondWith: (value: Promise<unknown>) => {
      responded = value
    },
  })

  expect(await responded).toBe(cached)
  expect(fetchMock).not.toHaveBeenCalled()
})

it('leaves anything that is neither a navigation nor a hashed asset alone', async () => {
  const { fakeSelf, fetchMock } = load()
  const fetchListener = fakeSelf.listeners.get('fetch')

  let responded: unknown = 'not called'
  fetchListener?.({
    request: makeRequest('https://caballus.example/robots.txt'),
    respondWith: (value: unknown) => {
      responded = value
    },
  })

  expect(responded).toBe('not called')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('takes over immediately on install and activate, and purges a previous deploy’s cache', async () => {
  const { fakeSelf, fakeCaches } = load()
  fakeCaches.storeFor('caballus-shell-v0')

  const installListener = fakeSelf.listeners.get('install')
  installListener?.({})
  expect(fakeSelf.skipWaiting).toHaveBeenCalledTimes(1)

  let activated: Promise<unknown> = Promise.resolve()
  const activateListener = fakeSelf.listeners.get('activate')
  activateListener?.({
    waitUntil: (value: Promise<unknown>) => {
      activated = value
    },
  })
  await activated

  expect(fakeCaches.delete).toHaveBeenCalledWith('caballus-shell-v0')
  expect(fakeCaches.delete).not.toHaveBeenCalledWith('caballus-shell-v1')
  expect(fakeSelf.clients.claim).toHaveBeenCalledTimes(1)
})
