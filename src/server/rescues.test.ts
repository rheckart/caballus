/**
 * Which rescue a request is for (#112, ADR 0030), without a database: how
 * `RESCUES` parses, how a request's host is read, and what a host nobody
 * mapped is answered with — at the start gate every page, server function and
 * `/api/*` request passes, and inside the API for whatever calls it directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aMappedHost } from '../start'
import { API_BASE } from '../shared/api-client'
import { servingRescues } from '../test/rescue'
import { buildApi } from './api/app'
import { anonymousContext, currentOrgId, UnknownRescue } from './request-context'
import {
  hostOf,
  MalformedRescues,
  originOf,
  parseRescues,
  rescueOfOrg,
  rescueFor,
  setRescues,
  UNKNOWN_RESCUE,
  unknownRescueResponse,
} from './rescues'

const A = '00000000-0000-0000-0000-0000000000b6'
const B = '00000000-0000-0000-0000-0000000000b7'

afterEach(() => {
  setRescues(null)
  vi.unstubAllEnvs()
})

describe('RESCUES, the one piece of configuration keyed by host', () => {
  it('maps each host to its rescue', () => {
    const parsed = parseRescues(
      JSON.stringify({ 'caballus.tech': { orgId: A }, 'localhost:3000': { orgId: B } }),
    )
    expect(parsed.get('caballus.tech')).toEqual({
      host: 'caballus.tech',
      orgId: A,
      boardToken: null,
      sms: false,
    })
    expect(parsed.get('localhost:3000')?.orgId).toBe(B)
  })

  it('carries each rescue’s kiosk token and whether it may text (#113)', () => {
    const parsed = parseRescues(
      JSON.stringify({
        'caballus.tech': { orgId: A, boardToken: 'a-token-long-enough-to-matter', sms: true },
        'rescue-b.caballus.tech': { orgId: B },
      }),
    )
    expect(parsed.get('caballus.tech')).toMatchObject({
      boardToken: 'a-token-long-enough-to-matter',
      sms: true,
    })
    expect(parsed.get('rescue-b.caballus.tech')).toMatchObject({ boardToken: null, sms: false })
  })

  it('finds a rescue by its organisation, and names its origin', () => {
    setRescues(
      parseRescues(
        JSON.stringify({ 'rescue-b.caballus.tech': { orgId: B }, 'localhost:3000': { orgId: A } }),
      ),
    )
    const b = rescueOfOrg(B)
    const a = rescueOfOrg(A)
    expect(b === null ? null : originOf(b)).toBe('https://rescue-b.caballus.tech')
    // No certificate on a development box, so its links are plain http.
    expect(a === null ? null : originOf(a)).toBe('http://localhost:3000')
    expect(rescueOfOrg('00000000-0000-0000-0000-0000000000ff')).toBeNull()
  })

  it.each([
    ['unset', undefined, /not set/],
    ['empty', '  ', /not set/],
    ['not JSON', '{caballus.tech', /not JSON/],
    ['an empty map', '{}', /names no rescue/],
    [
      'an org id that is not one',
      JSON.stringify({ 'caballus.tech': { orgId: 'rescue-a' } }),
      /malformed/,
    ],
    ['a key with a scheme', JSON.stringify({ 'https://caballus.tech': { orgId: A } }), /malformed/],
    ['a key in capitals', JSON.stringify({ 'Caballus.tech': { orgId: A } }), /malformed/],
    [
      'a field nobody reads',
      JSON.stringify({ 'caballus.tech': { orgId: A, colour: 'red' } }),
      /malformed/,
    ],
    [
      'a kiosk token anybody could guess',
      JSON.stringify({ 'caballus.tech': { orgId: A, boardToken: 'barn' } }),
      /malformed/,
    ],
    [
      'sms that is not a yes or a no',
      JSON.stringify({ 'caballus.tech': { orgId: A, sms: 'yes' } }),
      /malformed/,
    ],
    [
      'two hosts for one rescue',
      JSON.stringify({ 'a.test': { orgId: A }, 'b.test': { orgId: A } }),
      /same organisation/,
    ],
  ])('refuses %s, loudly', (_label, raw, because) => {
    expect(() => parseRescues(raw)).toThrow(MalformedRescues)
    expect(() => parseRescues(raw)).toThrow(because)
  })

  it('reads the variable on first use, and fails rather than serving nobody', () => {
    vi.stubEnv('RESCUES', 'not json')
    expect(() => rescueFor(new Request('http://caballus.tech/'))).toThrow(MalformedRescues)
    vi.stubEnv('RESCUES', JSON.stringify({ 'caballus.tech': { orgId: A } }))
    expect(rescueFor(new Request('http://caballus.tech/'))?.orgId).toBe(A)
  })
})

describe('the host a request arrived at', () => {
  it('is the Host header, lowercased, with its port', () => {
    const request = new Request('http://internal:3000/horses', {
      headers: { host: 'Rescue-B.Caballus.tech' },
    })
    expect(hostOf(request)).toBe('rescue-b.caballus.tech')
    expect(hostOf(new Request('http://x/', { headers: { host: 'localhost:3000' } }))).toBe(
      'localhost:3000',
    )
  })

  it('ignores X-Forwarded-Host, which is whatever the client wrote', () => {
    servingRescues({ 'rescue-a.test': A, 'rescue-b.test': B })
    const request = new Request('http://x/', {
      headers: { host: 'rescue-a.test', 'x-forwarded-host': 'rescue-b.test' },
    })
    expect(currentOrgId(request)).toBe(A)
  })

  it('tolerates the trailing dot of a fully qualified name', () => {
    expect(hostOf(new Request('http://x/', { headers: { host: 'caballus.tech.' } }))).toBe(
      'caballus.tech',
    )
  })

  it('refuses a host nobody mapped rather than defaulting to the first rescue', () => {
    servingRescues({ 'rescue-a.test': A })
    expect(() => currentOrgId(new Request('http://rescue-c.test/'))).toThrow(UnknownRescue)
    expect(() => anonymousContext(new Request('http://rescue-c.test/'))).toThrow(UnknownRescue)
  })
})

describe('a host nobody mapped is a 404 and a sentence, on every surface', () => {
  it('answers a page in words', async () => {
    const answer = unknownRescueResponse(new Request('http://nowhere.test/shifts'))
    expect(answer.status).toBe(404)
    expect(await answer.text()).toBe(UNKNOWN_RESCUE)
  })

  it('answers the API in JSON the phone can read', async () => {
    const answer = unknownRescueResponse(new Request(`http://nowhere.test${API_BASE}/horses`))
    expect(answer.status).toBe(404)
    expect(await answer.json()).toEqual({ error: 'unknown_rescue', message: UNKNOWN_RESCUE })
  })

  /** The start gate's own function, as TanStack Start calls it. */
  async function throughTheGate(
    url: string,
  ): Promise<{ response: Response | null; passed: boolean }> {
    let passed = false
    const next = () => {
      passed = true
      return Promise.resolve({
        request: new Request(url),
        pathname: '',
        context: {},
        response: new Response('ok'),
      })
    }
    const server = aMappedHost.options.server as unknown as (ctx: {
      request: Request
      next: typeof next
    }) => Promise<unknown> | unknown
    const result = await server({ request: new Request(url), next })
    return { response: result instanceof Response ? result : null, passed }
  }

  it('stops a page, a server function and the API at the start gate', async () => {
    servingRescues({ 'rescue-a.test': A })
    for (const path of ['/shifts', '/_serverFn/abc', `${API_BASE}/horses`]) {
      const { response, passed } = await throughTheGate(`http://nowhere.test${path}`)
      expect(passed).toBe(false)
      expect(response?.status).toBe(404)
    }
  })

  it('lets a mapped host through untouched', async () => {
    servingRescues({ 'rescue-a.test': A })
    const { passed } = await throughTheGate('http://rescue-a.test/shifts')
    expect(passed).toBe(true)
  })

  it('stops the API itself, for whatever calls it without the gate', async () => {
    servingRescues({ 'rescue-a.test': A })
    const api = buildApi({ context: anonymousContext })
    for (const path of ['/horses', '/no-such-path']) {
      const answer = await api.fetch(new Request(`http://nowhere.test${API_BASE}${path}`))
      expect(answer.status).toBe(404)
      expect(await answer.json()).toEqual({ error: 'unknown_rescue', message: UNKNOWN_RESCUE })
    }
    // And a version this server does not serve, which is answered from the
    // not-found handler rather than a route.
    const old = await api.fetch(new Request('http://nowhere.test/api/v0/horses'))
    expect(old.status).toBe(404)
  })
})
