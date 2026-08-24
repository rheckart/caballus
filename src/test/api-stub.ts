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
 * A refusal, for a handler that wants to answer one: return
 * `refused('space_occupied')` and the client sees the same 4xx body the
 * server would send (#62 — the inline-refusal tests need a server that says
 * no).
 */
export function refused(error: string, status = 409): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * What `noContent()` looks like on the wire, for a write whose contract says it
 * answers nothing.
 *
 * A stub answering `{}` instead is a 200 that the real client parses against
 * `z.void()` and **rejects** — so a screen under test takes a successful save
 * for a refusal, and a test that only inspects the captured request body
 * passes anyway while the screen behind it is showing an error. That is a real
 * trap the seam had no way to avoid until #68 walked into it.
 */
export function answeredNothing(): Response {
  return new Response(null, { status: 204 })
}

/**
 * Stubs `fetch` to answer each `/api/v1` path with a fixed body (200), a
 * `Response` of the handler's own making (for a refusal), or — for a write
 * whose answer depends on what was sent — a function of the request's
 * `init`. A path with no handler answers `404 not_found`, which is what an
 * unstubbed call getting through unnoticed would otherwise look like to the
 * caller.
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
      if (body instanceof Response) return Promise.resolve(body)
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }),
  )
}
