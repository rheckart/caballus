import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { memoryIdempotency } from '../../db/idempotency.memory'
import { requestContext } from '../request-context'
import { domainScope, floor, readEverything } from './authorization'
import { API_BASE, API_ROOT } from '../../shared/api-client'
import { createApi, json, queueable } from './route'

/** The one write these tests register, wherever they register it. */
const observed = queueable({ note: z.string() })

const KEY = '019267c0-6f7e-7a3d-9c2f-2f9a1c7e5b10'

/**
 * An api with somebody signed in, until accounts exist (ADR 0006), and with
 * the in-memory store behind it.
 *
 * That store proves nothing about dedupe — dedupe is a primary key in Postgres
 * and ADR 0007 says a fake proves nothing about database behaviour, which is
 * what `src/db/idempotency.test.ts` is for. What these tests are about is the
 * wrapper's own decisions: which outcome gets which status, and what reaches
 * the log.
 */
function apiWithVolunteer() {
  return createApi({
    idempotency: memoryIdempotency(),
    context: (request) => ({
      ...requestContext(request),
      actor: { volunteerId: 'v_01J8', domainScopes: [] },
    }),
  })
}

beforeAll(() => {
  process.env.APP_ORG_ID = '00000000-0000-0000-0000-000000000001'
})

beforeEach(() => {
  // The structured log is the point of the mutation wrapper; it just does not
  // belong in the test output.
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

/** The structured lines the server wrote while `act` ran, parsed. */
async function linesWhile(act: () => unknown): Promise<Record<string, unknown>[]> {
  const lines: Record<string, unknown>[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.push(JSON.parse(String(chunk)) as Record<string, unknown>)
    return true
  })
  await act()
  return lines
}

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`http://barn.invalid${API_BASE}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
}

describe('route', () => {
  it('serves a read to the floor, which reads everything', async () => {
    const api = createApi()
    api.route('GET', '/day', readEverything(), () => json({ day: '2026-08-15' }))

    const response = await api.fetch(request('GET', '/day'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ day: '2026-08-15' })
  })

  it('denies explicitly, and names the scope it wanted', async () => {
    const api = createApi()
    api.route('GET', '/volunteers', domainScope('roster'), () => json({ volunteers: [] }))

    const response = await api.fetch(request('GET', '/volunteers'))

    // Never a silent empty response: to a retry queue that is indistinguishable
    // from success (ADR 0010).
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'not_authorized', wanted: 'roster' })
  })

  it('answers a path the version does not claim with a 404', async () => {
    const api = createApi()
    const response = await api.fetch(request('GET', '/nothing-here'))
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
  })
})

describe('the version in the path', () => {
  /**
   * A request naming a version, built by hand: the typed client can only ever
   * send this build's version, and the client that sends the wrong one is an
   * older bundle that this code no longer exists to write.
   */
  function toVersion(method: string, version: string, path: string, body?: unknown): Request {
    return new Request(`http://barn.invalid${API_ROOT}/${version}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  }

  it('rejects a version it does not recognise, and says which one it serves', async () => {
    const api = createApi()
    const response = await api.fetch(toVersion('GET', 'v2', '/day'))

    // Not the 404 a mistyped path gets: *you may not do this*, *there is no
    // such thing here* and *your client is too old* are three different
    // answers on a phone in a barn (ADR 0010).
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'unsupported_api_version',
      supported: 'v1',
      received: 'v2',
    })
  })

  it('rejects a queued write from an old client rather than reading it', async () => {
    const api = apiWithVolunteer()
    const seen: string[] = []
    api.mutation('/observations', floor('record-an-observation'), observed, (input) => {
      seen.push(input.note)
      return json({}, 201)
    })

    const response = await api.fetch(
      toVersion('POST', 'v0', '/observations', {
        note: 'gate latch',
        idempotencyKey: '019267c0-6f7e-7a3d-9c2f-2f9a1c7e5b10',
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'unsupported_api_version' })
    // Accepted-and-misinterpreted is the outcome the version exists to prevent
    // (ADR 0007): a v0 write must not reach a v1 handler on path shape alone.
    expect(seen).toEqual([])
  })

  it('writes down the key of the write it turned away', async () => {
    const api = createApi()
    const key = '019267c0-6f7e-7a3d-9c2f-2f9a1c7e5b10'

    const lines = await linesWhile(() =>
      api.fetch(toVersion('POST', 'v0', '/observations', { note: 'gate latch', idempotencyKey: key })),
    )

    // The write never reaches `mutation`, so this line is the only record that
    // the server saw it at all — and "did the server ever see key X" is the
    // question ADR 0007 keeps this log for.
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      event: 'unsupported_api_version',
      received: 'v0',
      supported: 'v1',
      idempotencyKey: key,
      orgId: process.env.APP_ORG_ID,
    })
    // Beside the denial `register` logs, so the two read as one request.
    expect(lines[0]?.requestId).toEqual(expect.any(String))
  })

  it('will not let a scanner write the log a line at a time', async () => {
    const api = createApi()

    const lines = await linesWhile(() => api.fetch(toVersion('GET', '.env', '')))

    // Answered the same as any other version this server does not serve —
    // but an unmatched path is unauthenticated, and the internet's list of
    // them is long. What is not version-shaped leaves no line (ADR 0006).
    expect(lines).toEqual([])
  })

  it('rejects the versionless root, which is a client that has forgotten the path', async () => {
    const api = createApi()
    const response = await api.fetch(toVersion('GET', 'day', ''))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'unsupported_api_version',
      received: 'day',
    })
  })
})

describe('mutation', () => {
  it('rejects a write with no idempotency key rather than accepting it', async () => {
    const api = apiWithVolunteer()
    api.mutation('/observations', floor('record-an-observation'), observed, () => json({}, 201))

    const response = await api.fetch(request('POST', '/observations', { note: 'gate latch' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' })
  })

  it('hands the handler a parsed body once the key is there', async () => {
    const api = apiWithVolunteer()
    const seen: string[] = []
    api.mutation('/observations', floor('record-an-observation'), observed, (input) => {
      seen.push(input.note)
      return json({ idempotencyKey: input.idempotencyKey }, 201)
    })

    const response = await api.fetch(
      request('POST', '/observations', { note: 'gate latch', idempotencyKey: KEY }),
    )

    expect(response.status).toBe(201)
    expect(seen).toEqual(['gate latch'])
    await expect(response.json()).resolves.toEqual({ idempotencyKey: KEY })
  })

  it('refuses a write from nobody, because a tick is a claim by an actor', async () => {
    const api = createApi({ idempotency: memoryIdempotency() })
    api.mutation('/observations', floor('record-an-observation'), observed, () => json({}, 201))

    const response = await api.fetch(
      request('POST', '/observations', { note: 'gate latch', idempotencyKey: KEY }),
    )

    expect(response.status).toBe(401)
  })
})

describe('a key the wrapper has already answered', () => {
  /** An api with one write on it, and the handler's call count. */
  function apiRecording(): { api: ReturnType<typeof apiWithVolunteer>; ran: string[] } {
    const api = apiWithVolunteer()
    const ran: string[] = []
    api.mutation('/observations', floor('record-an-observation'), observed, (input) => {
      ran.push(input.note)
      return json({ recorded: ran.length }, 201)
    })
    return { api, ran }
  }

  it('runs the handler once and answers the retry with the first response', async () => {
    const { api, ran } = apiRecording()
    const write = () =>
      api.fetch(request('POST', '/observations', { note: 'gate latch', idempotencyKey: KEY }))

    const first = await write()
    const retry = await write()

    // The case ADR 0005 is written for: the response was lost on the way back,
    // so the phone sent the same key again. It is success, not a new event.
    expect(ran).toEqual(['gate latch'])
    expect(retry.status).toBe(first.status)
    await expect(retry.json()).resolves.toEqual({ recorded: 1 })
  })

  it('says on the log that it was a replay, and what it answered', async () => {
    const { api } = apiRecording()
    const write = () =>
      api.fetch(request('POST', '/observations', { note: 'gate latch', idempotencyKey: KEY }))

    await write()
    const lines = await linesWhile(write)

    // "Did the server see key X, and what did it answer" is one grep (ADR
    // 0007): arrival, then outcome, both carrying the key.
    expect(lines.map((line) => line.event)).toEqual(['mutation', 'mutation_answered'])
    expect(lines[1]).toMatchObject({
      level: 'info',
      outcome: 'replayed',
      status: 201,
      idempotencyKey: KEY,
      route: `POST ${API_BASE}/observations`,
    })
  })

  it('refuses the same key carrying a different request', async () => {
    const { api, ran } = apiRecording()

    await api.fetch(request('POST', '/observations', { note: 'gate latch', idempotencyKey: KEY }))
    const lines = await linesWhile(() =>
      api.fetch(request('POST', '/observations', { note: 'gate open', idempotencyKey: KEY })),
    )
    const conflict = await api.fetch(
      request('POST', '/observations', { note: 'gate open', idempotencyKey: KEY }),
    )

    // A client bug or a collision. The one answer it must not get is the first
    // response, which would report success for a write nothing recorded.
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toEqual({ error: 'idempotency_key_reused' })
    expect(ran).toEqual(['gate latch'])
    expect(lines[1]).toMatchObject({ level: 'warn', outcome: 'key_reused', status: 409 })
  })

  it('replays an answer that had no body at all', async () => {
    const api = apiWithVolunteer()
    api.mutation('/observations', floor('record-an-observation'), observed, () => new Response(null, { status: 204 }))

    const write = () =>
      api.fetch(request('POST', '/observations', { note: 'gate latch', idempotencyKey: KEY }))

    // 204 and its three siblings may not carry a body, and a response
    // reconstructed from the empty string does — which is a TypeError on the
    // first write that answers this way rather than on a later one.
    expect((await write()).status).toBe(204)
    expect((await write()).status).toBe(204)
  })

  it('leaves nothing behind when the handler throws', async () => {
    const api = apiWithVolunteer()
    let attempts = 0
    api.mutation('/observations', floor('record-an-observation'), observed, () => {
      attempts += 1
      if (attempts === 1) throw new Error('the barn lost power')
      return json({ recorded: true }, 201)
    })

    const write = () =>
      api.fetch(request('POST', '/observations', { note: 'gate latch', idempotencyKey: KEY }))

    expect((await write()).status).toBe(500)
    const retry = await write()

    // A key recorded for work that rolled back would turn a retry into a
    // permanent silent failure — the write never happens and the phone is told
    // it did.
    expect(retry.status).toBe(201)
    expect(attempts).toBe(2)
  })
})

describe('a key sent to two paths of one pattern', () => {
  /** One parameterised write, and which horse each run was for. */
  function apiPerHorse(): { api: ReturnType<typeof apiWithVolunteer>; ran: string[] } {
    const api = apiWithVolunteer()
    const ran: string[] = []
    // The shape every mutation this domain needs has: an observation belongs
    // to a horse, a tick belongs to a shift.
    const perHorse = '/horses/:horseId/observations'
    api.mutation(perHorse, floor('record-an-observation'), observed, (input, ctx) => {
      ran.push(`${ctx.params.horseId}: ${input.note}`)
      return json({ horse: ctx.params.horseId }, 201)
    })
    return { api, ran }
  }

  it('refuses the second, rather than answering it with the first horse', async () => {
    const { api, ran } = apiPerHorse()
    const body = { note: 'gate latch', idempotencyKey: KEY }

    const first = await api.fetch(request('POST', '/horses/alfie/observations', body))
    const second = await api.fetch(request('POST', '/horses/bramble/observations', body))

    // The digest is over the path that was sent, not the pattern that matched
    // it — otherwise bramble's observation is answered 201 with alfie's
    // response and nothing at all records it.
    await expect(first.json()).resolves.toEqual({ horse: 'alfie' })
    expect(second.status).toBe(409)
    await expect(second.json()).resolves.toEqual({ error: 'idempotency_key_reused' })
    expect(ran).toEqual(['alfie: gate latch'])
  })

  it('still replays a retry of the same path', async () => {
    const { api, ran } = apiPerHorse()
    const write = () =>
      api.fetch(
        request('POST', '/horses/alfie/observations', { note: 'gate latch', idempotencyKey: KEY }),
      )

    await write()
    const retry = await write()

    // The other half: a parameterised path must not become a path that never
    // dedupes, which would double-log every queued write (ADR 0005).
    expect(retry.status).toBe(201)
    await expect(retry.json()).resolves.toEqual({ horse: 'alfie' })
    expect(ran).toEqual(['alfie: gate latch'])
  })

  it('names the horse on the log, not the pattern', async () => {
    const { api } = apiPerHorse()
    const lines = await linesWhile(() =>
      api.fetch(
        request('POST', '/horses/alfie/observations', { note: 'gate latch', idempotencyKey: KEY }),
      ),
    )

    // A collision that names `:horseId` cannot tell you which horse, which is
    // the whole reason a person greps this line (ADR 0007).
    const route = `POST ${API_BASE}/horses/alfie/observations`
    expect(lines.map((line) => line.event)).toEqual(['mutation', 'mutation_answered'])
    expect(lines[0]).toMatchObject({ route, idempotencyKey: KEY })
    expect(lines[1]).toMatchObject({ route, outcome: 'performed' })
  })

  it('says which request the key was first spent on', async () => {
    const { api } = apiPerHorse()
    const body = { note: 'gate latch', idempotencyKey: KEY }

    await api.fetch(request('POST', '/horses/alfie/observations', body))
    const lines = await linesWhile(() =>
      api.fetch(request('POST', '/horses/bramble/observations', body)),
    )

    expect(lines[1]).toMatchObject({
      outcome: 'key_reused',
      route: `POST ${API_BASE}/horses/bramble/observations`,
      firstRoute: `POST ${API_BASE}/horses/alfie/observations`,
    })
  })

  it('counts a query string as part of the request', async () => {
    const { api, ran } = apiPerHorse()
    const body = { note: 'gate latch', idempotencyKey: KEY }

    await api.fetch(request('POST', '/horses/alfie/observations?at=07:15', body))
    const changed = await api.fetch(request('POST', '/horses/alfie/observations?at=17:15', body))
    const same = await api.fetch(request('POST', '/horses/alfie/observations?at=07:15', body))

    // No mutation carries one yet, and the answer is decided here rather than
    // left to the endpoint that first does: a query that says something else
    // is a different request, and gets a 409 rather than the first answer.
    expect(changed.status).toBe(409)
    await expect(changed.json()).resolves.toEqual({ error: 'idempotency_key_reused' })
    expect(same.status).toBe(201)
    expect(ran).toEqual(['alfie: gate latch'])
  })

  it('reads a re-encoded path as the same path', async () => {
    const { api, ran } = apiPerHorse()
    const body = { note: 'gate latch', idempotencyKey: KEY }

    await api.fetch(request('POST', '/horses/alfie/observations', body))
    const retry = await api.fetch(request('POST', '/horses/al%66ie/observations', body))

    // Both spell one horse and reach one handler, so this is the retry ADR 0005
    // is written for. A 409 here is a queued write that can never drain — the
    // same standard the body half of the digest already holds.
    expect(retry.status).toBe(201)
    await expect(retry.json()).resolves.toEqual({ horse: 'alfie' })
    expect(ran).toEqual(['alfie: gate latch'])
  })

  it('does not read the order of a query as a change to it', async () => {
    const { api } = apiPerHorse()
    const body = { note: 'gate latch', idempotencyKey: KEY }

    await api.fetch(request('POST', '/horses/alfie/observations?at=07:15&by=v_01J8', body))
    const retry = await api.fetch(
      request('POST', '/horses/alfie/observations?by=v_01J8&at=07:15', body),
    )

    // Key order in a body is not a difference, and the path may not be held to
    // a different standard than the body it arrived with.
    expect(retry.status).toBe(201)
  })
})

// The two invariants ADR 0016 moved out of lint and into the type checker.
// These do not run; they fail the build if the constraint ever loosens,
// because an unused `@ts-expect-error` is itself an error.
describe('the constraints are types', () => {
  it('will not register a handler with no authorization declared', () => {
    const api = createApi()
    // @ts-expect-error the authorization declaration is a required argument
    api.route('GET', '/day', () => json({}))
  })

  it('will not register a mutation whose schema carries no idempotency key', () => {
    const api = createApi()
    api.mutation(
      '/observations',
      floor('record-an-observation'),
      // @ts-expect-error a queueable write carries an idempotency key
      z.object({ note: z.string() }),
      () => json({}, 201),
    )
  })

  it('will not accept a fourth reason for the floor', () => {
    // @ts-expect-error the three legitimate uses are enumerated in FloorReason
    floor('because-the-endpoint-was-easier-that-way')
  })

  it('will not register a write through the read door', () => {
    const api = createApi()
    // @ts-expect-error a write goes through mutation, which requires a schema
    api.route('POST', '/observations', floor('record-an-observation'), () => json({}, 201))
  })
})
