/**
 * Two rescues behind two hosts, end to end (#112, ADR 0030), against a real
 * Postgres: each host reads only its own rescue's horses, an unmapped host is
 * a 404 with a sentence, and a session minted at one host is nobody at the
 * other — #111's guarantee, asserted through the door a phone actually uses.
 *
 * Skipped, loudly, on a machine with no database or no `BETTER_AUTH_SECRET`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeDb } from '../../db/for-org'
import { API_BASE } from '../../shared/api-client'
import { forgetIdentities } from '../../test/identities'
import { servingRescues } from '../../test/rescue'
import { forgetCodeRequestsForTest, requestCode, submitCode } from '../auth/sign-in'
import { createVolunteer } from '../auth/volunteers'
import { setEmailTransport, type OutgoingEmail } from '../email'
import { setRescues, UNKNOWN_RESCUE } from '../rescues'
import { api } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const secret = process.env.BETTER_AUTH_SECRET ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== '' && secret !== ''

const RESCUE_A = '00000000-0000-0000-0000-0000000000b8'
const RESCUE_B = '00000000-0000-0000-0000-0000000000b9'
const HOST_A = 'rescue-a.test'
const HOST_B = 'rescue-b.test:3000'

describe.skipIf(!reachable)('a rescue is the host it is reached at', () => {
  const owner = postgres(ownerUrl, { max: 1 })
  let posted: OutgoingEmail[] = []

  async function wipe(rescue: string, { keepOrg = false } = {}): Promise<void> {
    await forgetIdentities(owner, rescue)
    await owner`delete from horses where org_id = ${rescue}`
    await owner`delete from audit_entries where org_id = ${rescue}`
    await owner`delete from volunteer_accounts where org_id = ${rescue}`
    await owner`delete from volunteers where org_id = ${rescue}`
    if (!keepOrg) await owner`delete from orgs where id = ${rescue}`
  }

  beforeAll(async () => {
    for (const rescue of [RESCUE_A, RESCUE_B]) await wipe(rescue)
    await owner`
      insert into orgs (id, name, time_zone) values
        (${RESCUE_A}, 'Rescue A', 'America/New_York'),
        (${RESCUE_B}, 'Rescue B', 'America/Chicago')
    `
    await owner`
      insert into horses (id, org_id, name) values
        (gen_random_uuid(), ${RESCUE_A}, 'Applejack'),
        (gen_random_uuid(), ${RESCUE_B}, 'Biscuit')
    `
  })

  beforeEach(() => {
    posted = []
    forgetCodeRequestsForTest()
    setEmailTransport((message) => {
      posted.push(message)
      return Promise.resolve()
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(async () => {
    setEmailTransport(null)
    setRescues(null)
    vi.restoreAllMocks()
    for (const rescue of [RESCUE_A, RESCUE_B]) {
      await forgetIdentities(owner, rescue)
      await owner`delete from audit_entries where org_id = ${rescue}`
      await owner`delete from volunteer_accounts where org_id = ${rescue}`
      await owner`delete from volunteers where org_id = ${rescue}`
    }
  })

  afterAll(async () => {
    for (const rescue of [RESCUE_A, RESCUE_B]) await wipe(rescue)
    await owner.end()
    await closeDb()
  })

  function served() {
    const ids = servingRescues({ [HOST_A]: RESCUE_A, [HOST_B]: RESCUE_B })
    return { a: ids[HOST_A], b: ids[HOST_B] }
  }

  async function signedInAt(host: string, email: string): Promise<string> {
    const orgId = served()[host === HOST_A ? 'a' : 'b']
    if (orgId === undefined) throw new Error(`No rescue at ${host}`)
    await createVolunteer(orgId, { name: 'Someone', email })
    expect(await requestCode(orgId, email)).toEqual({ sent: true })
    const code = /\b(\d{6})\b/.exec(posted.findLast((sent) => sent.to === email)?.text ?? '')?.[1]
    const answered = await submitCode(orgId, email, code ?? '')
    if (!answered.signedIn) throw new Error(`Not signed in: ${answered.because}`)
    return (answered.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  }

  /** A request as it arrives off the wire: the Host header says where. */
  async function horsesAt(host: string, cookie?: string) {
    const response = await api.fetch(
      new Request(`http://internal${API_BASE}/horses`, {
        headers: { host, ...(cookie === undefined ? {} : { cookie }) },
      }),
    )
    return { status: response.status, body: (await response.json()) as unknown }
  }

  function names(body: unknown): string[] {
    const horses = (body as { horses?: { name: string }[] }).horses ?? []
    return horses.map((horse) => horse.name)
  }

  it('reads each rescue’s own horses at its own host, and only those', async () => {
    const cookieA = await signedInAt(HOST_A, 'ann@hosts.test')
    forgetCodeRequestsForTest()
    const cookieB = await signedInAt(HOST_B, 'ben@hosts.test')

    const atA = await horsesAt(HOST_A, cookieA)
    expect(atA.status).toBe(200)
    expect(names(atA.body)).toEqual(['Applejack'])

    const atB = await horsesAt(HOST_B, cookieB)
    expect(atB.status).toBe(200)
    expect(names(atB.body)).toEqual(['Biscuit'])
  })

  it('makes a cookie minted at one host nobody at the other', async () => {
    // The same person at both rescues, so the cookie is a real Account at the
    // other rescue's database rows — and still nobody there (#111).
    const cookieA = await signedInAt(HOST_A, 'cat@hosts.test')
    forgetCodeRequestsForTest()
    await signedInAt(HOST_B, 'cat@hosts.test')

    const crossed = await horsesAt(HOST_B, cookieA)
    expect(crossed.status).toBe(401)
    expect(names(crossed.body)).toEqual([])
  })

  it('answers a host nobody mapped with a 404 and a sentence, never the first rescue', async () => {
    const cookieA = await signedInAt(HOST_A, 'dee@hosts.test')

    const elsewhere = await horsesAt('rescue-c.test', cookieA)
    expect(elsewhere.status).toBe(404)
    expect(elsewhere.body).toEqual({ error: 'unknown_rescue', message: UNKNOWN_RESCUE })

    // The port is part of the host: B is mapped at :3000 and nowhere else.
    expect((await horsesAt('rescue-b.test')).status).toBe(404)
  })
})
