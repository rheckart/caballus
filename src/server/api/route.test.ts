import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { requestContext } from '../request-context'
import { domainScope, floor, readEverything } from './authorization'
import { API_BASE, API_ROOT } from '../../shared/api-client'
import { createApi, json, queueable } from './route'

/** The one write these tests register, wherever they register it. */
const observed = queueable({ note: z.string() })

/** An api with somebody signed in, until accounts exist (ADR 0006). */
function apiWithVolunteer() {
  return createApi({
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

    const key = '019267c0-6f7e-7a3d-9c2f-2f9a1c7e5b10'
    const response = await api.fetch(
      request('POST', '/observations', { note: 'gate latch', idempotencyKey: key }),
    )

    expect(response.status).toBe(201)
    expect(seen).toEqual(['gate latch'])
    await expect(response.json()).resolves.toEqual({ idempotencyKey: key })
  })

  it('refuses a write from nobody, because a tick is a claim by an actor', async () => {
    const api = createApi()
    api.mutation('/observations', floor('record-an-observation'), observed, () => json({}, 201))

    const response = await api.fetch(
      request('POST', '/observations', {
        note: 'gate latch',
        idempotencyKey: '019267c0-6f7e-7a3d-9c2f-2f9a1c7e5b10',
      }),
    )

    expect(response.status).toBe(401)
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
