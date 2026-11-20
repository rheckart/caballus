/**
 * An Account belongs to one rescue (#111, ADR 0030), against a real Postgres
 * holding two of them.
 *
 * The hole this closes was a claim about rows two libraries own between them:
 * Better Auth's `user.email` is unique across the whole database while
 * `volunteers.email` is unique only within one rescue, and the text door minted
 * a session for **whichever `user` held the Volunteer's address**. So a
 * `roster` holder at rescue B could create a Volunteer carrying rescue A's
 * officer's address and their own mobile, sign in at B by text, and hold the
 * officer's `user`. A fake agrees with whatever it is asked; this file asks the
 * database.
 *
 * Skipped, loudly, on a machine with no database or no `BETTER_AUTH_SECRET`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeDb, type OrgId } from '../../db/for-org'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import { forgetIdentities } from '../../test/identities'
import { api } from '../api/app'
import { setEmailTransport, type OutgoingEmail } from '../email'
import { actorForUser, actorFrom } from './actor'
import { auth } from './auth'
import { forgetCodeRequestsForTest, requestCode, submitCode } from './sign-in'
import { setVerifier } from './verify'
import { accountKey, createVolunteer, grantRole, isAccountKey } from './volunteers'
import { servingRescue } from '../../test/rescue'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const secret = process.env.BETTER_AUTH_SECRET ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== '' && secret !== ''

const RESCUE_A = '00000000-0000-0000-0000-0000000000a5'
const RESCUE_B = '00000000-0000-0000-0000-0000000000a6'

/** Every address this file uses ends here, so its mail is its own. */
const OURS = '@one-rescue.test'

describe.skipIf(!reachable)('an Account belongs to one rescue, against the database', () => {
  const owner = postgres(ownerUrl, { max: 1 })

  let posted: OutgoingEmail[] = []

  /** What the fake Verify accepts: the handset proved, and nothing else. */
  const STANDING_CODE = '424242'

  function at(rescue: string): OrgId {
    return servingRescue(rescue)
  }

  async function wipe(rescue: string, { keepOrg = false } = {}): Promise<void> {
    await forgetIdentities(owner, rescue)
    await owner`delete from audit_entries where org_id = ${rescue}`
    await owner`delete from idempotency_keys where org_id = ${rescue}`
    await owner`delete from volunteer_roles where org_id = ${rescue}`
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
  })

  beforeEach(() => {
    posted = []
    forgetCodeRequestsForTest()
    setEmailTransport((message) => {
      posted.push(message)
      return Promise.resolve()
    })
    setVerifier({
      start: () => Promise.resolve(),
      check: (_to, code) => Promise.resolve(code === STANDING_CODE),
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(async () => {
    setEmailTransport(null)
    setVerifier(null)
    vi.restoreAllMocks()
    for (const rescue of [RESCUE_A, RESCUE_B]) await wipe(rescue, { keepOrg: true })
  })

  afterAll(async () => {
    for (const rescue of [RESCUE_A, RESCUE_B]) await wipe(rescue)
    await owner.end()
    await closeDb()
  })

  function codeFor(email: string): string {
    const message = posted.findLast((sent) => sent.to === email)
    const digits = /\b(\d{6})\b/.exec(message?.text ?? '')
    if (digits?.[1] === undefined) throw new Error(`No code was mailed to ${email}`)
    return digits[1]
  }

  function cookieOf(headers: Headers): string {
    return (headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  }

  function carrying(cookie: string): Request {
    return new Request('http://barn.invalid/', { headers: { cookie } })
  }

  async function byEmail(rescue: string, email: string) {
    expect(await requestCode(at(rescue), email)).toEqual({ sent: true })
    const answered = await submitCode(at(rescue), email, codeFor(email))
    if (!answered.signedIn) throw new Error(`Not signed in at ${rescue}: ${answered.because}`)
    return answered
  }

  async function byText(rescue: string, mobile: string) {
    expect(await requestCode(at(rescue), mobile)).toEqual({ sent: true })
    const answered = await submitCode(at(rescue), mobile, STANDING_CODE)
    if (!answered.signedIn) throw new Error(`Not signed in at ${rescue}: ${answered.because}`)
    return answered
  }

  async function userIdOf(volunteerId: string): Promise<string> {
    const [row] =
      await owner`select user_id from volunteer_accounts where volunteer_id = ${volunteerId}`
    return String(row?.user_id)
  }

  async function emailOfUser(userId: string): Promise<string> {
    const [row] = await owner`select email from "user" where id = ${userId}`
    return String(row?.email)
  }

  it('gives rescue B no way into rescue A’s officer, by the door that used to be open', async () => {
    const officer = await createVolunteer(at(RESCUE_A), {
      name: 'Ada President',
      email: `ada${OURS}`,
    })
    await grantRole(at(RESCUE_A), officer.id, 'president')
    const officerSignedIn = await byEmail(RESCUE_A, `ada${OURS}`)

    // Rescue B's `roster` holder types A's officer's address beside their own
    // number — exactly the attack ADR 0030 describes.
    const impostor = await createVolunteer(at(RESCUE_B), {
      name: 'Not Ada',
      email: `ada${OURS}`,
      mobile: '+14105550188',
    })
    const impostorSignedIn = await byText(RESCUE_B, '410-555-0188')

    // Signed in at B as B's own Volunteer, on a `user` that is not the
    // officer's.
    expect(impostorSignedIn.volunteerId).toBe(impostor.id)
    expect(await userIdOf(impostor.id)).not.toBe(await userIdOf(officer.id))

    // And the session resolves to **nobody** at A, presented there.
    const impostorCookie = cookieOf(impostorSignedIn.headers)
    expect(await actorFrom(at(RESCUE_A), carrying(impostorCookie))).toBeNull()
    expect(await actorForUser(at(RESCUE_A), await userIdOf(impostor.id))).toBeNull()

    // The officer is untouched: still themselves at A, by email, as before.
    posted = []
    forgetCodeRequestsForTest()
    const again = await byEmail(RESCUE_A, `ada${OURS}`)
    expect(again.volunteerId).toBe(officer.id)
    expect(await actorFrom(at(RESCUE_A), carrying(cookieOf(officerSignedIn.headers)))).toEqual({
      volunteerId: officer.id,
      domainScopes: expect.arrayContaining(['grants']) as unknown,
    })
  })

  it('gives somebody who volunteers at both rescues two Accounts, signed into separately', async () => {
    const atA = await createVolunteer(at(RESCUE_A), { name: 'Bea Both', email: `bea${OURS}` })
    const atB = await createVolunteer(at(RESCUE_B), { name: 'Bea Both', email: `bea${OURS}` })

    const signedInAtA = await byEmail(RESCUE_A, `bea${OURS}`)
    forgetCodeRequestsForTest()
    const signedInAtB = await byEmail(RESCUE_B, `bea${OURS}`)

    const userAtA = await userIdOf(atA.id)
    const userAtB = await userIdOf(atB.id)
    expect(userAtA).not.toBe(userAtB)
    expect(await emailOfUser(userAtA)).toBe(accountKey(atA.id))
    expect(await emailOfUser(userAtB)).toBe(accountKey(atB.id))

    // Each cookie is somebody at its own rescue and nobody at the other.
    const cookieA = cookieOf(signedInAtA.headers)
    const cookieB = cookieOf(signedInAtB.headers)
    expect((await actorFrom(at(RESCUE_A), carrying(cookieA)))?.volunteerId).toBe(atA.id)
    expect((await actorFrom(at(RESCUE_B), carrying(cookieB)))?.volunteerId).toBe(atB.id)
    expect(await actorFrom(at(RESCUE_B), carrying(cookieA))).toBeNull()
    expect(await actorFrom(at(RESCUE_A), carrying(cookieB))).toBeNull()
  })

  it('leaves the sign-in at A untouched by /me/email at B', async () => {
    const atA = await createVolunteer(at(RESCUE_A), { name: 'Cal Both', email: `cal${OURS}` })
    await createVolunteer(at(RESCUE_B), { name: 'Cal Both', email: `cal${OURS}` })
    await byEmail(RESCUE_A, `cal${OURS}`)
    forgetCodeRequestsForTest()
    const cookieB = cookieOf((await byEmail(RESCUE_B, `cal${OURS}`)).headers)

    // At B, through the endpoint the phone calls.
    at(RESCUE_B)
    const asked = await api.fetch(
      new Request(`http://barn.invalid${API_BASE}/me/email/code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieB },
        body: JSON.stringify({ email: `cal.new${OURS}`, idempotencyKey: newIdempotencyKey() }),
      }),
    )
    expect(asked.status).toBe(204)
    const moved = await api.fetch(
      new Request(`http://barn.invalid${API_BASE}/me/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieB },
        body: JSON.stringify({
          email: `cal.new${OURS}`,
          code: codeFor(`cal.new${OURS}`),
          idempotencyKey: newIdempotencyKey(),
        }),
      }),
    )
    expect(moved.status).toBe(200)

    // A's Account is exactly where it was, and the old address still signs in
    // there — it was only ever B's record that moved.
    expect(await emailOfUser(await userIdOf(atA.id))).toBe(accountKey(atA.id))
    forgetCodeRequestsForTest()
    expect((await byEmail(RESCUE_A, `cal${OURS}`)).volunteerId).toBe(atA.id)
  })

  it('still signs in an Account claimed under a real address, by email and by text', async () => {
    // The state of every Account before the rewrite migration ships: a `user`
    // keyed by the address it was claimed under. The code that resolves the
    // identifier ships first and has to work on this.
    const legacy = await createVolunteer(at(RESCUE_A), {
      name: 'Dot Early',
      email: `dot${OURS}`,
      mobile: '+14105550199',
    })
    const userId = `legacy-${legacy.id}`
    await owner`
      insert into "user" (id, name, email, email_verified)
      values (${userId}, 'Dot Early', ${`dot${OURS}`}, true)
    `
    await owner`
      insert into volunteer_accounts (org_id, volunteer_id, user_id)
      values (${RESCUE_A}, ${legacy.id}, ${userId})
    `

    const mailed = await byEmail(RESCUE_A, `dot${OURS}`)
    expect(mailed.volunteerId).toBe(legacy.id)
    forgetCodeRequestsForTest()
    const texted = await byText(RESCUE_A, '410-555-0199')
    expect(texted.volunteerId).toBe(legacy.id)

    // Both landed on the legacy row rather than minting a keyed one beside it.
    expect(await userIdOf(legacy.id)).toBe(userId)
    const minted = await owner`select id from "user" where email = ${accountKey(legacy.id)}`
    expect(minted).toHaveLength(0)
    await owner`delete from "user" where id = ${userId}`
  })

  it('keeps a session minted before the rewrite, and signs in on the same Account after it', async () => {
    // Before: an Account keyed by the address it was claimed under, holding a
    // session — every volunteer on the morning `0024_accounts_keyed_by_volunteer`
    // deploys.
    const legacy = await createVolunteer(at(RESCUE_A), {
      name: 'Fay Early',
      email: `fay${OURS}`,
      mobile: '+14105550177',
    })
    const userId = `legacy-${legacy.id}`
    await owner`
      insert into "user" (id, name, email, email_verified)
      values (${userId}, 'Fay Early', ${`fay${OURS}`}, true)
    `
    await owner`
      insert into volunteer_accounts (org_id, volunteer_id, user_id)
      values (${RESCUE_A}, ${legacy.id}, ${userId})
    `
    const before = cookieOf((await byEmail(RESCUE_A, `fay${OURS}`)).headers)

    // What the migration does to this row — its own SQL is exercised whole in
    // `src/server/auth/account-keys.test.ts`, in a database of its own, because
    // it is global and this one is shared with every suite running beside it.
    await owner`update "user" set email = ${accountKey(legacy.id)} where id = ${userId}`

    // Nobody is signed out: a session points at a user id, never an address.
    expect((await actorFrom(at(RESCUE_A), carrying(before)))?.volunteerId).toBe(legacy.id)

    // And both doors still land on that same row.
    posted = []
    forgetCodeRequestsForTest()
    expect((await byEmail(RESCUE_A, `fay${OURS}`)).volunteerId).toBe(legacy.id)
    forgetCodeRequestsForTest()
    expect((await byText(RESCUE_A, '410-555-0177')).volunteerId).toBe(legacy.id)
    expect(await userIdOf(legacy.id)).toBe(userId)
  })

  it('never mails a code to an Account key, even through Better Auth’s own sender', async () => {
    const volunteer = await createVolunteer(at(RESCUE_A), { name: 'Eve', email: `eve${OURS}` })
    expect(isAccountKey(accountKey(volunteer.id))).toBe(true)

    // The control: the same endpoint does mail an ordinary address, so the
    // silence below is the refusal and not a sender that never runs.
    await auth().api.sendVerificationOTP({ body: { email: `eve${OURS}`, type: 'sign-in' } })
    await vi.waitFor(() => {
      expect(posted.map((sent) => sent.to)).toEqual([`eve${OURS}`])
    })

    // Better Auth swallows its sender's failure and answers success either way
    // — the reason `requestCode` mints and sends codes itself — so what is
    // asserted is the thing that matters: nothing addressed to a key left.
    posted = []
    await auth().api.sendVerificationOTP({
      body: { email: accountKey(volunteer.id), type: 'sign-in' },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(posted).toEqual([])
    await owner`delete from verification where identifier like ${`%eve${OURS}`}`
  })
})
