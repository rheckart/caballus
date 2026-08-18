/**
 * The other half of the UI seam: fetch stubbed at the network boundary, so
 * the real typed client and the real contract parsing participate (#32's
 * testing decisions) — a component under test calls `client.get`/`post`
 * exactly as it does against the real server, and only the network call
 * itself is faked.
 */
import { vi } from 'vitest'

import { API_BASE } from '../shared/api-client'

type Handler = unknown | ((init: RequestInit) => unknown)

/**
 * Stubs `fetch` to answer each `/api/v1` path with a fixed body (200), or —
 * for a write whose answer depends on what was sent — a function of the
 * request's `init`. A path with no handler answers `404 not_found`, which is
 * what an unstubbed call getting through unnoticed would otherwise look like
 * to the caller.
 */
export function stubApi(handlers: Readonly<Record<string, Handler>>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init: RequestInit = {}) => {
      const requested = input instanceof Request ? input.url : String(input)
      const path = new URL(requested, 'http://barn.invalid').pathname.slice(API_BASE.length)
      const handler = handlers[path]

      if (handler === undefined) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'not_found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }

      const body = typeof handler === 'function' ? handler(init) : handler
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }),
  )
}
