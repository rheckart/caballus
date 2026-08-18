import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  ApiError,
  API_BASE,
  API_ROOT,
  API_VERSION,
  OutdatedClientError,
  OutdatedServerError,
  UnreadableAnswerError,
  apiVersionOf,
  client as realClient,
  createClient,
} from './api-client'
import { day, type Contract } from './api-contract'

/**
 * A contract of this file's own, because the real one declares the endpoints
 * that exist and these tests are about the client rather than about the barn.
 * Endpoints invented for the tests do not belong in the thing the server is
 * held to (#26).
 */
const testContract = {
  reads: {
    '/day': { answers: day },
    '/volunteers': { answers: z.object({ volunteers: z.array(z.string()) }) },
    '/horses/:horseId': { answers: z.object({ id: z.string(), name: z.string() }) },
  },
  writes: {
    '/observations': {
      accepts: z.object({ note: z.string() }),
      answers: z.object({ recorded: z.boolean() }),
    },
    // A write whose payload names the field the key goes in. Contrived, and
    // the reason it exists is below: the key must survive it.
    '/pretenders': {
      accepts: z.object({ idempotencyKey: z.string() }),
      answers: z.object({ recorded: z.boolean() }),
    },
  },
} as const satisfies Contract

const client = createClient(testContract)

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

    const failure = await client.get('/day').catch((error: unknown) => error)

    // A queue that cannot tell these apart retries the one it should surface
    // and surfaces the one it should retry (ADR 0010).
    expect(failure).toBeInstanceOf(OutdatedClientError)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as OutdatedClientError).supported).toBe('v2')
    expect((failure as OutdatedClientError).message).toContain('v2')
  })

  it('still reads as a sentence when the server names no version it serves', async () => {
    serverAnswering(400, { error: 'unsupported_api_version' })

    const failure = await client.get('/day').catch((error: unknown) => error)

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

    const failure = await client
      .post('/observations', { note: 'gate latch' })
      .catch((error: unknown) => error)

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

    const failure = await client.get('/day').catch((error: unknown) => error)

    // The path is malformed; the bundle is fine. Telling a volunteer to reload
    // would be advice that cannot work.
    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).not.toBeInstanceOf(OutdatedClientError)
    expect(failure).not.toBeInstanceOf(OutdatedServerError)
  })

  it('leaves an ordinary denial an ordinary ApiError', async () => {
    serverAnswering(403, { error: 'not_authorized', wanted: 'horse_care' })

    const failure = await client.get('/volunteers').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).not.toBeInstanceOf(OutdatedClientError)
    expect((failure as ApiError).status).toBe(403)
  })

  it('raises it for a queued write too, which is the case that matters', async () => {
    serverAnswering(400, { error: 'unsupported_api_version', supported: 'v2', received: 'v1' })

    const failure = await client
      .post('/observations', { note: 'gate latch' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(OutdatedClientError)
  })
})

describe('a write, and the replay of one', () => {
  it('mints one key when the write is new and keeps the one being replayed', async () => {
    const calls = serverAnswering(201, { recorded: true })

    await client.post('/observations', { note: 'gate latch' })
    await client.post('/observations', { note: 'gate latch' }, { idempotencyKey: 'k_replayed' })

    const sent = calls.map(
      ({ init }) => JSON.parse(String(init.body)) as { idempotencyKey: string },
    )
    expect(sent[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(sent[1]?.idempotencyKey).toBe('k_replayed')
    expect(calls[0]?.url).toBe(`${API_BASE}/observations`)
  })

  it('sends a replay byte for byte as the attempt it is replaying', async () => {
    const calls = serverAnswering(201, { recorded: true })
    const queued = { note: 'gate latch' }
    const key = 'k_thursday'

    // What the queue does when the barn comes back: the same call, with the
    // key it kept. One door, so a replay cannot drift from the write it is
    // replaying — a second builder is how the digest on the server stops
    // matching and a queued write starts collecting 409s (ADR 0005, ADR 0020).
    await client.post('/observations', queued, { idempotencyKey: key })
    await client.post('/observations', queued, { idempotencyKey: key })

    expect(calls[1]?.init.body).toEqual(calls[0]?.init.body)
    expect(calls[1]?.url).toEqual(calls[0]?.url)
  })

  it('will not let the payload shadow the key', async () => {
    const calls = serverAnswering(201, { recorded: true })

    await client.post(
      '/pretenders',
      { idempotencyKey: 'from-the-body' },
      { idempotencyKey: 'k_real' },
    )

    const sent = JSON.parse(String(calls[0]?.init.body)) as { idempotencyKey: string }
    // A write whose key came from its own payload is a write with no key.
    expect(sent.idempotencyKey).toBe('k_real')
  })
})

describe('the answer, against the shape the contract promised', () => {
  it('reads a good answer through the schema and hands it back', async () => {
    serverAnswering(200, {
      day: '2026-08-16',
      timeZone: 'America/New_York',
      organisation: 'Front Barn',
    })

    // The real contract, not this file's: the one endpoint that exists,
    // through the client the application actually uses.
    const today = await realClient.get('/day')

    expect(today.day).toBe('2026-08-16')
    expect(today.organisation).toBe('Front Barn')
  })

  it('refuses an answer that is not the shape it was promised', async () => {
    serverAnswering(200, { day: '2026-08-16', timeZone: 'America/New_York' })

    const failure = await realClient.get('/day').catch((error: unknown) => error)

    // A missing field asserted into existence by `as T` is `undefined` on a
    // screen in a barn, blamed on the data. Parsed, it is a server worth
    // fixing, said out loud, at the boundary where it happened.
    expect(failure).toBeInstanceOf(UnreadableAnswerError)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as UnreadableAnswerError).because).toContain('organisation')
  })

  it('refuses an answer that is not there at all', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 200 })))

    const failure = await realClient.get('/day').catch((error: unknown) => error)

    // A proxy answering 200 with nothing is not the day, and rendering it as
    // one is the same lie with fewer steps.
    expect(failure).toBeInstanceOf(UnreadableAnswerError)
  })
})

describe('a parameterised path (ADR 0021)', () => {
  it('interpolates the param into the path it fetches', async () => {
    const calls = serverAnswering(200, { id: 'apollo-1', name: 'Apollo' })
    await client.get('/horses/:horseId', { horseId: 'apollo-1' })
    expect(calls[0]?.url).toBe(`${API_BASE}/horses/apollo-1`)
  })

  it('encodes a param that would otherwise spell two segments', async () => {
    const calls = serverAnswering(200, { id: 'a/b', name: 'Odd' })
    await client.get('/horses/:horseId', { horseId: 'a/b' })
    expect(calls[0]?.url).toBe(`${API_BASE}/horses/a%2Fb`)
  })

  it('leaves a path with no params exactly as every existing call site sends it', async () => {
    const calls = serverAnswering(200, { volunteers: [] })
    await client.get('/volunteers')
    expect(calls[0]?.url).toBe(`${API_BASE}/volunteers`)
  })
})

// These do not run. They fail the build if the constraint ever loosens, because
// an unused `@ts-expect-error` is itself an error — which is the point of #26:
// a wrong path is a type error, not a 404 at 6am.
describe('the path is a type', () => {
  it('will not read a parameterised path with no params', () => {
    const read = () =>
      // @ts-expect-error `/horses/:horseId` needs a `horseId` param
      client.get('/horses/:horseId')
    expect(read).toBeTypeOf('function')
  })

  it('will not read a parameterised path with the wrong param name', () => {
    const read = () =>
      // @ts-expect-error the param is `horseId`, not `id`
      client.get('/horses/:horseId', { id: 'apollo-1' })
    expect(read).toBeTypeOf('function')
  })

  it('will not read a path no route registers', async () => {
    await expect(
      // @ts-expect-error `/shifts` is not in the contract, so nothing serves it
      client.get('/shifts'),
    ).rejects.toThrow(/No endpoint is declared at \/shifts/)
  })

  it('will not write to a path no route registers', async () => {
    await expect(
      // @ts-expect-error a write goes where a write is declared, or nowhere
      client.post('/shifts', { note: 'gate latch' }),
    ).rejects.toThrow(/No endpoint is declared at \/shifts/)
  })

  it('will not send a body the write does not accept', () => {
    // The call is never made; the constraint is the whole assertion.
    const send = () =>
      // @ts-expect-error the payload is the contract's, not the call site's
      client.post('/observations', { note: 7 })
    expect(send).toBeTypeOf('function')
  })

  it('will not read a write path, or write to a read path', () => {
    const read = () =>
      // @ts-expect-error `/observations` is a write
      client.get('/observations')
    const write = () =>
      // @ts-expect-error `/day` is a read
      client.post('/day', {})
    expect([read, write]).toHaveLength(2)
  })
})
