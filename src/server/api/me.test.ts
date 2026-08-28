/**
 * A Volunteer editing their own contact details, against a real Postgres and a
 * real Better Auth (#68, ADR 0027).
 *
 * The name and the mobile are an ordinary current-state edit, and the only
 * thing worth pinning about them is who the audit entry names: the actor and
 * the subject are one person, and there is no `reason`, because nobody will
 * ever ask why you changed your own phone number.
 *
 * **The email cannot be asserted against a fake.** ADR 0027's whole argument is
 * that `volunteers.email` is the credential — `requestCode` gates on it — so
 * every claim here is a claim about rows two libraries own between them: that
 * both columns moved together, that the new address is the one a code now goes
 * to and the old one is not, that the code was minted under a type the login
 * screen structurally cannot reach, that it is spent after one use, and that
 * every other session is gone. A stub would agree with all of it while the
 * database said something else, which is the failure that ends in a volunteer
 * locked out of the only account they have.
 *
 * Better Auth's `user`, `session` and `verification` carry no `org_id`, so they
 * are shared with every other suite on the box rather than fenced by the
 * policies. The wipe below is scoped to this file's own addresses instead of
 * emptying them, so that running beside a suite that also signs somebody in
 * cannot delete a row out from under it.
 *
 * Skipped, loudly, on a machine with no database or no `BETTER_AUTH_SECRET`:
 * `docker compose up -d`, then `psql -f scripts/provision-database.sql` and
 * `npm run db:migrate`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeDb, type OrgId } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import { contract, me } from '../../shared/api-contract'
import { auth } from '../auth/auth'
import {
  CODES_PER_ADDRESS,
  forgetCodeRequestsForTest,
  requestCode,
  submitCode,
} from '../auth/sign-in'
import { forgetSendsForTest, setEmailTransport, type OutgoingEmail } from '../email'
import { forgetTextsForTest, setSmsTransport, type OutgoingText } from '../sms'
import { setVerifier, type VerifyPurpose } from '../auth/verify'
import { anonymousContext, currentOrgId } from '../request-context'
import { api, buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const secret = process.env.BETTER_AUTH_SECRET ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== '' && secret !== ''

const HILL_BARN = '00000000-0000-0000-0000-0000000000f9'

/**
 * Every address this file uses ends here.
 *
 * Not decoration: it is what makes the wipe of Better Auth's own tables
 * scopable to this suite, and it keeps `user.email` — unique **globally**,
 * which is the seam ADR 0027 records — out of the way of every other suite's
 * addresses.
 */
const OURS = '@own.test'

/** An audit entry in the shape the claims here are about. */
interface AuditRow {
  readonly actor: string
  readonly entity: string
  readonly subject: string
  readonly field: string | null
  readonly before: string | null
  readonly after: string | null
  readonly reason: string | null
}

describe.skipIf(!reachable)('your own contact details, through the API', () => {
  const owner = postgres(ownerUrl, { max: 1 })

  /** Every message the run sent, so a test can read a code the way a volunteer does. */
  let posted: OutgoingEmail[] = []

  /** Every text the run sent, and every verification it started (#78). */
  let texted: OutgoingText[] = []
  let verified: { to: string; purpose: VerifyPurpose }[] = []

  /** What the fake verifier accepts. Verify owns the code, so a test picks one. */
  const STANDING_CODE = '424242'

  function orgId(): OrgId {
    process.env.APP_ORG_ID = HILL_BARN
    return currentOrgId()
  }

  /**
   * An API with the actor asserted rather than signed in.
   *
   * For the refusals that land before `/me/email` ever looks at a session — and
   * for the one that is *about* not having an Account, which by definition
   * cannot be reached through a session at all.
   */
  function apiAs(volunteerId: string): typeof api {
    return buildApi({
      idempotency: postgresIdempotency(),
      context: (request) => ({
        ...anonymousContext(request),
        actor: { volunteerId, domainScopes: [] },
      }),
    })
  }

  function url(path: string): string {
    return `http://barn.invalid${API_BASE}${path}`
  }

  function headersFor(cookie?: string): Record<string, string> {
    return cookie === undefined ? {} : { cookie }
  }

  interface Answered {
    readonly status: number
    readonly body: Record<string, unknown>
  }

  async function get(target: typeof api, path: string, cookie?: string): Promise<Answered> {
    const response = await target.fetch(new Request(url(path), { headers: headersFor(cookie) }))
    return { status: response.status, body: await bodyOf(response) }
  }

  async function post(
    target: typeof api,
    path: string,
    payload: Record<string, unknown>,
    cookie?: string,
  ): Promise<Answered> {
    const response = await target.fetch(
      new Request(url(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headersFor(cookie) },
        body: JSON.stringify({ ...payload, idempotencyKey: newIdempotencyKey() }),
      }),
    )
    return { status: response.status, body: await bodyOf(response) }
  }

  async function bodyOf(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text()
    if (text === '') return {}
    return JSON.parse(text) as Record<string, unknown>
  }

  beforeAll(async () => {
    process.env.APP_ORG_ID = HILL_BARN
    await wipe()
    await owner`
      insert into orgs (id, name, time_zone)
      values (${HILL_BARN}, 'Hill Barn Horse Rescue', 'America/New_York')
    `
  })

  beforeEach(() => {
    posted = []
    texted = []
    verified = []
    forgetCodeRequestsForTest()
    forgetSendsForTest()
    forgetTextsForTest()
    setEmailTransport((message) => {
      posted.push(message)
      return Promise.resolve()
    })
    // **No test makes a paid call** (#77, #78): both doors out are replaced.
    setSmsTransport((message) => {
      texted.push(message)
      return Promise.resolve()
    })
    setVerifier({
      start: (to, purpose) => {
        verified.push({ to, purpose })
        return Promise.resolve()
      },
      check: (_to, code) => Promise.resolve(code === STANDING_CODE),
    })
    // The transport logs the address and subject of everything it sends, and a
    // suite that signs several people in would otherwise write a page of it.
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(async () => {
    // The transport is process-wide, so it is put back rather than left
    // pointing at an array the next test has already replaced.
    setEmailTransport(null)
    setSmsTransport(null)
    setVerifier(null)
    vi.restoreAllMocks()
    await wipe({ keepOrg: true })
  })

  afterAll(async () => {
    await wipe()
    await owner.end()
    // Closed once, here. Better Auth builds its adapter over the same handle
    // and keeps it, so closing between suites would leave it holding a socket
    // that had already been ended.
    await closeDb()
  })

  async function wipe({ keepOrg = false }: { keepOrg?: boolean } = {}): Promise<void> {
    await owner`delete from audit_entries where org_id = ${HILL_BARN}`
    await owner`delete from idempotency_keys where org_id = ${HILL_BARN}`
    await owner`delete from volunteer_accounts where org_id = ${HILL_BARN}`
    await owner`delete from volunteers where org_id = ${HILL_BARN}`
    // Better Auth's three, by address rather than wholesale — see the module
    // note. `session` and `volunteer_accounts` both cascade from `user`, so the
    // order below is for readability rather than for the constraints.
    await owner`
      delete from "session"
      where user_id in (select id from "user" where email like ${`%${OURS}`})
    `
    await owner`delete from "user" where email like ${`%${OURS}`}`
    await owner`delete from verification where identifier like ${`%${OURS}`}`
    if (!keepOrg) await owner`delete from orgs where id = ${HILL_BARN}`
  }

  async function seedVolunteer(
    name: string,
    email: string,
    mobile: string | null = null,
  ): Promise<string> {
    const [row] = await owner`
      insert into volunteers (id, org_id, name, email, mobile)
      values (gen_random_uuid(), ${HILL_BARN}, ${name}, ${email}, ${mobile})
      returning id
    `
    return String(row?.id)
  }

  /** The six digits out of the last thing mailed to an address. */
  function codeFor(email: string): string {
    const message = posted.findLast((sent) => sent.to === email)
    const digits = /\b(\d{6})\b/.exec(message?.text ?? '')
    if (digits?.[1] === undefined) {
      throw new Error(`No six-digit code was mailed to ${email}`)
    }
    return digits[1]
  }

  /** Coded and signed in, answering with the cookie a phone would hold. */
  async function signIn(email: string): Promise<string> {
    expect(await requestCode(orgId(), email)).toEqual({ sent: true })
    const answered = await submitCode(orgId(), email, codeFor(email))
    if (!answered.signedIn) throw new Error(`Not signed in: ${answered.because}`)
    return (answered.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  }

  /** A Volunteer who has claimed an Account and is holding a session. */
  async function signedIn(
    name: string,
    email: string,
  ): Promise<{ volunteerId: string; userId: string; cookie: string }> {
    const volunteerId = await seedVolunteer(name, email)
    const cookie = await signIn(email)
    return { volunteerId, userId: await userIdOf(volunteerId), cookie }
  }

  async function userIdOf(volunteerId: string): Promise<string> {
    const [row] = await owner`
      select user_id from volunteer_accounts where volunteer_id = ${volunteerId}
    `
    return String(row?.user_id)
  }

  async function emailOfVolunteer(volunteerId: string): Promise<string> {
    const [row] = await owner`select email from volunteers where id = ${volunteerId}`
    return String(row?.email)
  }

  async function emailOfUser(userId: string): Promise<string> {
    const [row] = await owner`select email from "user" where id = ${userId}`
    return String(row?.email)
  }

  /** Asks for the code and hands it straight back, which is the two-step flow. */
  async function askForCode(cookie: string, email: string): Promise<string> {
    const asked = await post(api, '/me/email/code', { email }, cookie)
    expect(asked.status).toBe(204)
    return codeFor(email)
  }

  /** A code that is definitely not the one that was minted. */
  function notTheCode(code: string): string {
    return code === '000000' ? '111111' : '000000'
  }

  async function auditHere(): Promise<AuditRow[]> {
    const rows = await owner`
      select actor_volunteer_id, entity, entity_id, field, before, after, reason
      from audit_entries
      where org_id = ${HILL_BARN}
      order by field
    `
    return rows.map((row) => ({
      actor: String(row.actor_volunteer_id),
      entity: String(row.entity),
      subject: String(row.entity_id),
      field: row.field as string | null,
      before: row.before as string | null,
      after: row.after as string | null,
      reason: row.reason as string | null,
    }))
  }

  describe('the name, which commits immediately', () => {
    it('changes your own name, and names you as both the actor and the subject', async () => {
      const volunteerId = await seedVolunteer('Kate Ellery', `kate${OURS}`)

      const saved = await post(apiAs(volunteerId), '/me/contact-details', { name: 'Kate Nash' })

      expect(saved.status).toBe(204)
      const [row] = await owner`select name from volunteers where id = ${volunteerId}`
      expect(row?.name).toBe('Kate Nash')
      // The whole of what ADR 0027 asks the entry to say: one person in both
      // columns, and **no reason** — a reason exists because somebody is
      // explaining a decision about another person, which this is not.
      expect(await auditHere()).toEqual([
        {
          actor: volunteerId,
          entity: 'volunteer',
          subject: volunteerId,
          field: 'name',
          before: 'Kate Ellery',
          after: 'Kate Nash',
          reason: null,
        },
      ])
    })

    it('writes nothing when the name did not move', async () => {
      const volunteerId = await seedVolunteer('Kate Ellery', `kate${OURS}`)
      const mine = apiAs(volunteerId)

      expect((await post(mine, '/me/contact-details', { name: 'Kate Ellery' })).status).toBe(204)

      // An entry saying a name changed from *Kate* to *Kate* is noise in the
      // one record that has to stay readable.
      expect(await auditHere()).toEqual([])
    })

    it('carries no mobile at all, which is #78 moving it behind a code', async () => {
      // Structural rather than checked: the field is not in the contract, so
      // there is no shape in which this endpoint moves a credential.
      expect(Object.keys(contract.writes['/me/contact-details'].accepts.shape)).toEqual(['name'])
    })

    it('answers /me with your own email and mobile, which the redaction was never about', async () => {
      const volunteerId = await seedVolunteer('Kate Ellery', `kate${OURS}`, '410-555-0117')

      const read = await get(apiAs(volunteerId), '/me')

      expect(read.status).toBe(200)
      // Parsed against the contract rather than asserted loosely: the answer the
      // server sends and the shape the phone was promised are one declaration
      // (ADR 0021). `behindRoster` on the people list protects *other people's*
      // details; it was never about your own, which you read on your own screen.
      expect(me.parse(read.body)).toEqual({
        volunteerId,
        name: 'Kate Ellery',
        email: `kate${OURS}`,
        mobile: '410-555-0117',
        domainScopes: [],
      })
    })
  })

  describe('the email, which is the credential', () => {
    it('moves both columns, and the new address is the one that signs in', async () => {
      const kate = await signedIn('Kate Ellery', `kate${OURS}`)

      const code = await askForCode(kate.cookie, `kate.nash${OURS}`)
      const changed = await post(api, '/me/email', { email: `kate.nash${OURS}`, code }, kate.cookie)

      expect(changed.status).toBe(200)
      // Two tables holding one truth. A half-applied change is the lockout ADR
      // 0027 describes with extra steps.
      expect(await emailOfVolunteer(kate.volunteerId)).toBe(`kate.nash${OURS}`)
      expect(await emailOfUser(kate.userId)).toBe(`kate.nash${OURS}`)

      // And the credential has actually moved, which is the only test of it
      // that matters: `requestCode` gates on `volunteers.email`, so this is the
      // difference between a changed address and a locked-out volunteer.
      expect(await requestCode(orgId(), `kate.nash${OURS}`)).toEqual({ sent: true })
      expect(await requestCode(orgId(), `kate${OURS}`)).toEqual({
        sent: false,
        because: 'unrecognised-email',
      })
    })

    it('tells the old address that its account has moved', async () => {
      const kate = await signedIn('Kate Ellery', `kate${OURS}`)
      const code = await askForCode(kate.cookie, `kate.nash${OURS}`)

      await post(api, '/me/email', { email: `kate.nash${OURS}`, code }, kate.cookie)

      // The only way a person losing their account finds out. Without it a
      // stolen session becomes a stolen account silently and permanently.
      const notice = posted.findLast(
        (sent) => sent.to === `kate${OURS}` && !sent.subject.includes('your Caballus code'),
      )
      expect(notice?.subject).toBe('Your Caballus sign-in address was changed')
      expect(notice?.text).toContain(`kate.nash${OURS}`)
    })

    it('mints a code the login screen cannot use', async () => {
      const kate = await signedIn('Kate Ellery', `kate${OURS}`)

      const code = await askForCode(kate.cookie, `kate.nash${OURS}`)

      // Keyed `change-email` rather than `sign-in`, which is what makes the
      // replay structurally impossible rather than merely refused. The
      // identifier's format is Better Auth's own and reproduced in
      // `email-change.ts`, so a library that changed it fails here rather than
      // failing a volunteer.
      const rows = await owner`
        select identifier from verification where identifier like ${`%kate.nash${OURS}`}
      `
      expect(rows.map((row) => String(row.identifier))).toEqual([
        `change-email-otp-kate.nash${OURS}`,
      ])

      // Through our own door, and then past it: `submitCode` refuses because no
      // Volunteer holds that address yet, and Better Auth itself refuses
      // because there is no `sign-in` row for the code to match.
      expect(await submitCode(orgId(), `kate.nash${OURS}`, code)).toEqual({
        signedIn: false,
        because: 'unrecognised-email',
      })
      await expect(
        auth().api.signInEmailOTP({ body: { email: `kate.nash${OURS}`, otp: code } }),
      ).rejects.toThrow()

      // And nothing was signed up along the way: the address still has no
      // identity, which is the failure mode ADR 0008's gate exists to prevent.
      const identities = await owner`select id from "user" where email = ${`kate.nash${OURS}`}`
      expect(identities).toHaveLength(0)
    })

    it('ends every other session and leaves the one that made the change', async () => {
      const kate = await signedIn('Kate Ellery', `kate${OURS}`)
      // A second device — the tablet in the barn, signed in as her.
      const tablet = await signIn(`kate${OURS}`)
      expect(await owner`select id from "session" where user_id = ${kate.userId}`).toHaveLength(2)

      const code = await askForCode(kate.cookie, `kate.nash${OURS}`)
      const changed = await post(api, '/me/email', { email: `kate.nash${OURS}`, code }, kate.cookie)

      // Answered rather than merely done: a person who has just changed their
      // credential should be told that the tablet is now signed out.
      expect(changed.body).toEqual({ sessionsEnded: 1 })
      const left = await owner`select token from "session" where user_id = ${kate.userId}`
      expect(left).toHaveLength(1)
      // And the survivor is the one that made the change rather than whichever
      // happened to be listed first.
      expect(kate.cookie).toContain(String(left[0]?.token))
      expect((await get(api, '/me', tablet)).status).toBe(401)
      expect((await get(api, '/me', kate.cookie)).status).toBe(200)
    })

    it('refuses a wrong code without spending the whole code', async () => {
      const kate = await signedIn('Kate Ellery', `kate${OURS}`)
      const code = await askForCode(kate.cookie, `kate.nash${OURS}`)

      const mistyped = await post(
        api,
        '/me/email',
        { email: `kate.nash${OURS}`, code: notTheCode(code) },
        kate.cookie,
      )

      expect(mistyped.status).toBe(409)
      expect(mistyped.body).toEqual({ error: 'wrong_code' })
      expect(await emailOfVolunteer(kate.volunteerId)).toBe(`kate${OURS}`)

      // A mistyped digit costs an attempt and not the code — the volunteer is
      // holding a message with six digits in it and has no way to ask for the
      // same one again.
      const second = await post(api, '/me/email', { email: `kate.nash${OURS}`, code }, kate.cookie)
      expect(second.status).toBe(200)
      expect(await emailOfVolunteer(kate.volunteerId)).toBe(`kate.nash${OURS}`)
    })

    it('refuses a code that has already been used', async () => {
      const kate = await signedIn('Kate Ellery', `kate${OURS}`)
      const first = await askForCode(kate.cookie, `kate.nash${OURS}`)
      expect(
        (await post(api, '/me/email', { email: `kate.nash${OURS}`, code: first }, kate.cookie))
          .status,
      ).toBe(200)

      // Back again, so that the old address is free and the spent code is the
      // only thing standing between the replay and a second change.
      const back = await askForCode(kate.cookie, `kate${OURS}`)
      expect(
        (await post(api, '/me/email', { email: `kate${OURS}`, code: back }, kate.cookie)).status,
      ).toBe(200)

      const replayed = await post(
        api,
        '/me/email',
        { email: `kate.nash${OURS}`, code: first },
        kate.cookie,
      )

      // Consumed exactly once, which is what lets the code be the pending state
      // instead of a table (ADR 0027).
      expect(replayed.status).toBe(409)
      expect(replayed.body).toEqual({ error: 'no_code' })
      expect(await emailOfVolunteer(kate.volunteerId)).toBe(`kate${OURS}`)
    })

    it('refuses an address another live Volunteer holds, at both doors', async () => {
      const volunteerId = await seedVolunteer('Kate Ellery', `kate${OURS}`)
      await seedVolunteer('Joy Whittaker', `joy${OURS}`)
      const mine = apiAs(volunteerId)

      // Checked before the code is minted as well as before it is spent: the
      // unique indexes would refuse either way, but inside the transaction,
      // which answers a 500 rather than a sentence a volunteer can act on.
      const asked = await post(mine, '/me/email/code', { email: `joy${OURS}` })
      expect(asked.status).toBe(409)
      expect(asked.body).toEqual({ error: 'email_taken' })
      expect(posted).toEqual([])

      const applied = await post(mine, '/me/email', { email: `joy${OURS}`, code: '123456' })
      expect(applied.status).toBe(409)
      expect(applied.body).toEqual({ error: 'email_taken' })
    })

    it('refuses your own current address, however it is spelled', async () => {
      const volunteerId = await seedVolunteer('Kate Ellery', `kate${OURS}`)
      const mine = apiAs(volunteerId)

      expect((await post(mine, '/me/email/code', { email: `kate${OURS}` })).body).toEqual({
        error: 'email_unchanged',
      })
      // Normalised once, on the way in, because the uniqueness of an address
      // within a rescue is a plain index and an index only holds if everything
      // writing to it agrees on the spelling.
      expect(
        (await post(mine, '/me/email/code', { email: ` KATE${OURS.toUpperCase()} ` })).body,
      ).toEqual({ error: 'email_unchanged' })
      expect(posted).toEqual([])
    })

    it('refuses somebody who has never signed in', async () => {
      const volunteerId = await seedVolunteer('Terry Nash', `terry${OURS}`)

      const applied = await post(apiAs(volunteerId), '/me/email', {
        email: `terry.new${OURS}`,
        code: '123456',
      })

      // A self-edit of the email always implies a claimed Account, because it
      // takes a session to reach. The unclaimed case is `roster`'s door, where
      // there is no credential in use to protect (ADR 0027).
      expect(applied.status).toBe(409)
      expect(applied.body).toEqual({ error: 'account_not_claimed' })
    })

    it('spends the same per-address budget the login screen does', async () => {
      const volunteerId = await seedVolunteer('Grace Whittaker', `grace${OURS}`)
      const mine = apiAs(volunteerId)
      const wanted = `grace.new${OURS}`

      for (let attempt = 0; attempt < CODES_PER_ADDRESS; attempt += 1) {
        expect((await post(mine, '/me/email/code', { email: wanted })).status).toBe(204)
      }

      // One window across both doors (#68). This endpoint takes an arbitrary
      // address from any signed-in volunteer, and the only thing above it is
      // the `DAILY_CAP` the whole rescue shares — so a loop here would stop
      // sign-in working for everybody, which is the denial of service ADR
      // 0008's limit exists to prevent.
      const spent = await post(mine, '/me/email/code', { email: wanted })
      expect(spent.status).toBe(429)
      expect(spent.body).toEqual({ error: 'too_many_codes' })
      expect(posted).toHaveLength(CODES_PER_ADDRESS)
    })

    it('declares neverQueued on both email writes, because a code is a credential', () => {
      expect(contract.writes['/me/email/code'].neverQueued).toBe(true)
      expect(contract.writes['/me/email'].neverQueued).toBe(true)
      // And the plain edit does not, because it is an ordinary write about the
      // past and safe to send twice (ADR 0005).
      expect('neverQueued' in contract.writes['/me/contact-details']).toBe(false)
    })
  })

  /**
   * Changing the number you sign in with (#78, ADR 0029).
   *
   * The trap ADR 0027 walked out of once, for a second field: the moment a text
   * is how somebody logs in, a new number is a permanent lockout only a
   * Coordinator can undo. So the flow is the address flow's — a code to the
   * **new** number, of a type structurally unreachable from the login screen,
   * and nothing moves until it comes back.
   */
  describe('changing the number you sign in with', () => {
    it('sends a code to the new number and moves nothing yet', async () => {
      const volunteerId = await seedVolunteer('Kate Ellery', `kate${OURS}`, '+14105550117')
      const mine = apiAs(volunteerId)

      const asked = await post(mine, '/me/mobile/code', { mobile: '410-555-0199' })

      expect(asked.status).toBe(204)
      // Twilio Verify, on the **change** Service — not the sign-in one, which
      // is what makes this code structurally unreachable from `/login`.
      expect(verified).toEqual([{ to: '+14105550199', purpose: 'change-mobile' }])
      const [row] = await owner`select mobile from volunteers where id = ${volunteerId}`
      expect(row?.mobile).toBe('+14105550117')
    })

    it('moves the number when the code comes back, and tells the old one', async () => {
      const volunteerId = await seedVolunteer('Kate Ellery', `kate${OURS}`, '+14105550117')
      const mine = apiAs(volunteerId)
      await post(mine, '/me/mobile/code', { mobile: '410-555-0199' })

      const changed = await post(mine, '/me/mobile', {
        mobile: '410-555-0199',
        code: STANDING_CODE,
      })

      expect(changed.status).toBe(204)
      const [row] = await owner`select mobile from volunteers where id = ${volunteerId}`
      // Stored in one spelling, because a code sent here signs somebody in.
      expect(row?.mobile).toBe('+14105550199')
      // The old number is told, because the person who can no longer sign in at
      // that handset is the one who most needs to know.
      expect(texted.map((message) => message.to)).toEqual(['+14105550117'])
      expect(await auditHere()).toEqual([
        expect.objectContaining({
          actor: volunteerId,
          subject: volunteerId,
          field: 'mobile',
          before: '+14105550117',
          after: '+14105550199',
          reason: null,
        }),
      ])
    })

    it('completes the change even when the notice to the old number fails', async () => {
      const volunteerId = await seedVolunteer('Kate Ellery', `kate${OURS}`, '+14105550117')
      const mine = apiAs(volunteerId)
      await post(mine, '/me/mobile/code', { mobile: '410-555-0199' })
      setSmsTransport(() => Promise.reject(new Error('Twilio said no')))

      // Refusing a completed credential change over an undeliverable notice
      // leaves somebody with a number they cannot sign in at (ADR 0027).
      const changed = await post(mine, '/me/mobile', {
        mobile: '410-555-0199',
        code: STANDING_CODE,
      })

      expect(changed.status).toBe(204)
      const [row] = await owner`select mobile from volunteers where id = ${volunteerId}`
      expect(row?.mobile).toBe('+14105550199')
    })

    it('refuses a wrong code and moves nothing', async () => {
      const volunteerId = await seedVolunteer('Kate Ellery', `kate${OURS}`, '+14105550117')
      const mine = apiAs(volunteerId)
      await post(mine, '/me/mobile/code', { mobile: '410-555-0199' })

      const refused = await post(mine, '/me/mobile', { mobile: '410-555-0199', code: '000000' })

      expect(refused.status).toBe(409)
      expect(refused.body).toEqual({ error: 'wrong_code' })
      const [row] = await owner`select mobile from volunteers where id = ${volunteerId}`
      expect(row?.mobile).toBe('+14105550117')
    })

    it('refuses a number another live Volunteer already holds', async () => {
      await seedVolunteer('Joy Marsden', `joy${OURS}`, '+14105550199')
      const volunteerId = await seedVolunteer('Kate Ellery', `kate${OURS}`, '+14105550117')

      const refused = await post(apiAs(volunteerId), '/me/mobile/code', { mobile: '410-555-0199' })

      expect(refused.status).toBe(409)
      expect(refused.body).toEqual({ error: 'mobile_taken' })
      expect(verified).toEqual([])
    })

    it('refuses something that is not a number at all', async () => {
      const volunteerId = await seedVolunteer('Kate Ellery', `kate${OURS}`)

      const refused = await post(apiAs(volunteerId), '/me/mobile/code', { mobile: 'ask Kate' })

      expect(refused.status).toBe(409)
      expect(refused.body).toEqual({ error: 'mobile_invalid' })
    })

    it('gives the number up with no code, because that locks nobody out', async () => {
      const volunteerId = await seedVolunteer('Kate Ellery', `kate${OURS}`, '+14105550117')

      const removed = await post(apiAs(volunteerId), '/me/mobile/removal', {})

      expect(removed.status).toBe(204)
      const [row] = await owner`select mobile from volunteers where id = ${volunteerId}`
      expect(row?.mobile).toBeNull()
      expect(await auditHere()).toEqual([
        expect.objectContaining({ field: 'mobile', before: '+14105550117', after: null }),
      ])
    })

    it('spends the budget before it sends, never after', async () => {
      const volunteerId = await seedVolunteer('Kate Ellery', `kate${OURS}`, '+14105550117')
      const mine = apiAs(volunteerId)

      for (let index = 0; index < CODES_PER_ADDRESS; index += 1) {
        expect((await post(mine, '/me/mobile/code', { mobile: '410-555-0199' })).status).toBe(204)
      }
      const spent = await post(mine, '/me/mobile/code', { mobile: '410-555-0199' })

      expect(spent.status).toBe(429)
      expect(spent.body).toEqual({ error: 'too_many_codes' })
      // The point: the refused one never reached the vendor. A send above a
      // spent budget is a paid message that left before the 429 came back, and
      // this endpoint takes an arbitrary number from any signed-in volunteer.
      expect(verified).toHaveLength(CODES_PER_ADDRESS)
    })

    it('declares neverQueued on all three, because a credential is not replayable', () => {
      expect(contract.writes['/me/mobile/code'].neverQueued).toBe(true)
      expect(contract.writes['/me/mobile'].neverQueued).toBe(true)
      // Even the removal, which **is** safe to repeat: replayed from a pocket
      // days later it would take away a number somebody has since put back.
      expect(contract.writes['/me/mobile/removal'].neverQueued).toBe(true)
    })
  })
})
