import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  API_BASE,
  API_ROOT,
  API_VERSION,
  OutdatedClientError,
  OutdatedServerError,
  apiGet,
  apiPost,
  apiVersionOf,
} from './api-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Answers every call with one response, and records what was asked. */
function serverAnswering(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })
  return calls
}

describe('apiVersionOf', () => {
  it('reads the version a path names', () => {
    expect(apiVersionOf(`${API_BASE}/day`)).toBe(API_VERSION)
    expect(apiVersionOf(`${API_ROOT}/v2/shifts/019267c0/items`)).toBe('v2')
    expect(apiVersionOf(`${API_ROOT}/v2`)).toBe('v2')
  })

  it('treats a path that skipped the version as naming an unknown one', () => {
    // Not a special case: a client that forgot the version and one asking for
    // a version called `day` are the same request, and get the same answer.
    expect(apiVersionOf(`${API_ROOT}/day`)).toBe('day')
    expect(apiVersionOf(API_ROOT)).toBe('')
    expect(apiVersionOf(`${API_ROOT}/`)).toBe('')
  })

  it('is null for a path that is not the API at all', () => {
    expect(apiVersionOf('/')).toBeNull()
    expect(apiVersionOf('/shifts')).toBeNull()
    // The prefix has to be a whole segment, or `/apiary` is an API call.
    expect(apiVersionOf('/apiary/day')).toBeNull()
  })
})

describe('the client reading a version rejection', () => {
  it('raises its own error, distinguishable from a denial', async () => {
    serverAnswering(400, { error: 'unsupported_api_version', supported: 'v2', received: 'v1' })

    const failure = await apiGet('/day').catch((error: unknown) => error)

    // A queue that cannot tell these apart retries the one it should surface
    // and surfaces the one it should retry (ADR 0010).
    expect(failure).toBeInstanceOf(OutdatedClientError)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as OutdatedClientError).supported).toBe('v2')
    expect((failure as OutdatedClientError).message).toContain('v2')
  })

  it('still reads as a sentence when the server names no version it serves', async () => {
    serverAnswering(400, { error: 'unsupported_api_version' })

    const failure = await apiGet('/day').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(OutdatedClientError)
    // The rejection is the load-bearing part and it arrived; a body missing
    // its `supported` is a server worth fixing, not a reason to retry.
    expect((failure as OutdatedClientError).supported).toBe('')
    expect((failure as OutdatedClientError).message).toBe(
      `this client speaks ${API_VERSION}; the server does not`,
    )
  })

  it('keeps the write when the server is the one behind', async () => {
    // Today's client speaks v1, so the only server it can be ahead of is one
    // still serving v0; from v2 onward this is the ordinary shape of a rolling
    // deploy, where a queued write meets a container nobody has replaced yet.
    serverAnswering(400, { error: 'unsupported_api_version', supported: 'v0', received: 'v1' })

    const failure = await apiPost('/observations', { note: 'gate latch' }).catch(
      (error: unknown) => error,
    )

    // Dropping this one loses a write the next attempt would have delivered,
    // which is the failure ADR 0005 exists to prevent.
    expect(failure).toBeInstanceOf(OutdatedServerError)
    expect(failure).not.toBeInstanceOf(OutdatedClientError)
    expect((failure as OutdatedServerError).supported).toBe('v0')
  })

  it('will not call the client outdated for the version it is running', async () => {
    // Reachable: `/api`, `/api/`, and `/api//v1/day` are all answered with the
    // server's own version, and the last is what a proxy leaves behind when it
    // strips a prefix and forgets the slash.
    serverAnswering(400, {
      error: 'unsupported_api_version',
      supported: API_VERSION,
      received: '',
    })

    const failure = await apiGet('/day').catch((error: unknown) => error)

    // The path is malformed; the bundle is fine. Telling a volunteer to reload
    // would be advice that cannot work.
    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).not.toBeInstanceOf(OutdatedClientError)
    expect(failure).not.toBeInstanceOf(OutdatedServerError)
  })

  it('leaves an ordinary denial an ordinary ApiError', async () => {
    serverAnswering(403, { error: 'not_authorized', wanted: 'horse_care' })

    const failure = await apiGet('/volunteers').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).not.toBeInstanceOf(OutdatedClientError)
    expect((failure as ApiError).status).toBe(403)
  })

  it('raises it for a queued write too, which is the case that matters', async () => {
    serverAnswering(400, { error: 'unsupported_api_version', supported: 'v2', received: 'v1' })

    const failure = await apiPost('/observations', { note: 'gate latch' }).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(OutdatedClientError)
  })
})

describe('apiPost', () => {
  it('mints one key when the write is new and keeps the one being replayed', async () => {
    const calls = serverAnswering(201, {})

    await apiPost('/observations', { note: 'gate latch' })
    await apiPost('/observations', { note: 'gate latch' }, { idempotencyKey: 'k_replayed' })

    const sent = calls.map(({ init }) => JSON.parse(String(init.body)) as { idempotencyKey: string })
    expect(sent[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(sent[1]?.idempotencyKey).toBe('k_replayed')
    expect(calls[0]?.url).toBe(`${API_BASE}/observations`)
  })

  it('will not let the payload shadow the key', async () => {
    const calls = serverAnswering(201, {})

    await apiPost('/observations', { idempotencyKey: 'from-the-body' }, { idempotencyKey: 'k_real' })

    const sent = JSON.parse(String(calls[0]?.init.body)) as { idempotencyKey: string }
    // A write whose key came from its own payload is a write with no key.
    expect(sent.idempotencyKey).toBe('k_real')
  })
})
