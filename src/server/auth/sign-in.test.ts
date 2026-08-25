/**
 * Signing in, against a real Postgres — because every claim ADR 0008 makes is
 * a claim about rows.
 *
 * Sessions are database rows and revocation is a delete with no staleness
 * window; a Volunteer exists before an Account and outlives one; a revoked
 * Account cannot be re-claimed by asking for another code. A fake agrees with
 * whatever it is asked, and would agree with all four while the schema said
 * something else.
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`, then
 * `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import { eq, inArray, like } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeDb, forOrg, type OrgId } from '../../db/for-org'
import { api } from '../api/app'
import { API_BASE } from '../../shared/api-client'
import { me } from '../../shared/api-contract'
import { sessions, users, volunteerAccounts, volunteerRoles, volunteers } from '../../db/schema'
import { setEmailTransport, type OutgoingEmail } from '../email'
import { currentOrgId } from '../request-context'
import { actorForUser, actorFrom } from './actor'
import { revokeAccount, restoreAccount } from './revoke'
import {
  CODES_PER_ADDRESS,
  forgetCodeRequestsForTest,
  requestCode,
  signOut,
  submitCode,
} from './sign-in'
import { claimAccount, createVolunteer, grantRole, removeVolunteer } from './volunteers'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const secret = process.env.BETTER_AUTH_SECRET ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== '' && secret !== ''

const FRONT_BARN = '00000000-0000-0000-0000-0000000000d1'

describe.skipIf(!reachable)('email codes, sessions and revocation, against the database', () => {
  const owner = postgres(ownerUrl, { max: 1 })

  /** Every message the run sent, so a test can read a code the way a volunteer does. */
  let posted: OutgoingEmail[] = []

  function orgId(): OrgId {
    process.env.APP_ORG_ID = FRONT_BARN
    return currentOrgId()
  }

  /**
   * Better Auth's `user`, `session` and `verification` carry no `org_id` and no
   * policy (ADR 0008), so `forOrg` does **not** scope them — which makes a bare
   * `select().from(users)` a claim about every test file running in parallel
   * rather than about this one. Both of these narrow it to this file's own
   * rows: every address here ends in `example.invalid`, and a session of ours
   * belongs to a `user` some Volunteer of this organisation has claimed.
   */
  const ours = like(users.email, '%example.invalid')

  const mine = (db: Parameters<Parameters<ReturnType<typeof forOrg>['run']>[0]>[0]) =>
    inArray(
      sessions.userId,
      db.select({ userId: volunteerAccounts.userId }).from(volunteerAccounts),
    )

  beforeAll(async () => {
    process.env.APP_ORG_ID = FRONT_BARN
    await owner`delete from audit_entries where org_id = ${FRONT_BARN}`
    await owner`delete from volunteer_roles where org_id = ${FRONT_BARN}`
    await owner`delete from volunteer_accounts where org_id = ${FRONT_BARN}`
    await owner`delete from volunteers where org_id = ${FRONT_BARN}`
    await owner`delete from orgs where id = ${FRONT_BARN}`
    await owner`
      insert into orgs (id, name, time_zone)
      values (${FRONT_BARN}, 'Front Barn Horse Rescue', 'America/New_York')
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
    vi.restoreAllMocks()
    // First, because every grant and removal below now writes one and it
    // references both the volunteer and the org (ADR 0010).
    await owner`delete from audit_entries where org_id = ${FRONT_BARN}`
    await owner`delete from volunteer_roles where org_id = ${FRONT_BARN}`
    await owner`delete from volunteer_accounts where org_id = ${FRONT_BARN}`
    await owner`delete from volunteers where org_id = ${FRONT_BARN}`
    // Better Auth's three tables carry no `org_id` (ADR 0008), so these are
    // scoped by **address** instead. An unscoped delete here reaches into
    // whatever `src/server/api/me.test.ts` is doing in the process next door,
    // and vitest runs files in parallel: every address this file ever uses ends
    // in `example.invalid`, and that is what makes the scope real.
    await owner`
      delete from "session"
      where user_id in (select id from "user" where email like '%example.invalid')
    `
    await owner`delete from "user" where email like '%example.invalid'`
    await owner`delete from verification where identifier like '%example.invalid'`
  })

  afterAll(async () => {
    await owner`delete from audit_entries where org_id = ${FRONT_BARN}`
    await owner`delete from volunteer_roles where org_id = ${FRONT_BARN}`
    await owner`delete from volunteer_accounts where org_id = ${FRONT_BARN}`
    await owner`delete from volunteers where org_id = ${FRONT_BARN}`
    await owner`delete from orgs where id = ${FRONT_BARN}`
    await owner.end()
    // Closed once, here. Better Auth builds its adapter over the same handle
    // and keeps it, so closing between suites would leave it holding a socket
    // that had already been ended — which looks exactly like a mail failure.
    await closeDb()
  })

  /** The six digits out of whatever was mailed, the way a volunteer reads them. */
  function codeFrom(message: OutgoingEmail | undefined): string {
    const digits = /\b(\d{6})\b/.exec(message?.text ?? '')
    if (digits?.[1] === undefined) {
      throw new Error(`No six-digit code in: ${message?.text ?? '(nothing was sent)'}`)
    }
    return digits[1]
  }

  /** A request carrying the session a sign-in just handed back. */
  function carrying(headers: Headers): Request {
    const pair = (headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    return new Request('http://barn.invalid/', { headers: { cookie: pair } })
  }

  /** Invited, coded, signed in — the whole of it. */
  async function signIn(email = 'Grace@Example.invalid') {
    const volunteer = await createVolunteer(orgId(), { name: 'Grace Whittaker', email })
    expect(await requestCode(orgId(), email)).toEqual({ sent: true })
    const answered = await submitCode(orgId(), email, codeFrom(posted[0]))
    if (!answered.signedIn) throw new Error(`Not signed in: ${answered.because}`)
    return { volunteer, answered }
  }

  describe('a code, a session, and who it makes you', () => {
    it('mails a code, takes it back, and hands over a session', async () => {
      const { volunteer, answered } = await signIn()

      expect(answered.volunteerId).toBe(volunteer.id)
      // The cookie is what carries the session, and it must be the browser's to
      // hold rather than the page's to read.
      const cookie = answered.headers.get('set-cookie') ?? ''
      expect(cookie).toMatch(/HttpOnly/i)
      expect(cookie).toMatch(/SameSite=Lax/i)
    })

    it('makes the session a row, and the row is what the next request reads', async () => {
      const { volunteer, answered } = await signIn()

      const rows = await forOrg(orgId()).run((db) => db.select().from(sessions).where(mine(db)))
      expect(rows).toHaveLength(1)

      // Not a JWT anywhere: what the next request resolves is this row, which is
      // what makes revocation a delete with no staleness window (ADR 0008).
      const actor = await actorFrom(orgId(), carrying(answered.headers))
      expect(actor).toEqual({ volunteerId: volunteer.id, domainScopes: [] })
    })

    it('sets the longest expiry a browser will hold, and refreshes it on use', async () => {
      const { answered } = await signIn()
      expect(answered.signedIn).toBe(true)

      const [row] = await forOrg(orgId()).run((db) =>
        db.select({ expiresAt: sessions.expiresAt }).from(sessions).where(mine(db)),
      )

      // Not a number we were free to choose. RFC 6265bis caps a cookie's
      // `Max-Age` at 400 days and browsers enforce it, so ADR 0004's *stay
      // signed in* has to be *a long expiry refreshed on use* — which is what
      // ADR 0008 actually says. The assertion is both halves: far enough out
      // that no shift pattern reaches it, and inside what a browser will hold.
      const days = ((row?.expiresAt.getTime() ?? 0) - performance.timeOrigin) / 86_400_000
      expect(days).toBeGreaterThan(360)
      expect(days).toBeLessThan(400)

      // And the refresh is configured, which is the half that makes it
      // effectively forever for anybody who works a shift a week.
      const cookie = answered.headers.get('set-cookie') ?? ''
      expect(cookie).toMatch(/Max-Age=\d+/)
    })

    it('carries the Domain Scopes the volunteer’s roles confer', async () => {
      const { volunteer, answered } = await signIn()
      await grantRole(orgId(), volunteer.id, 'head_of_horse_welfare')
      await grantRole(orgId(), volunteer.id, 'volunteer_coordinator')

      const actor = await actorFrom(orgId(), carrying(answered.headers))

      // Resolved per request rather than stamped into the session, which is the
      // point: a grant made now takes effect on the next request rather than
      // whenever something forces a refresh.
      expect(actor?.domainScopes).toEqual(['horse_care', 'roster'])
    })
  })

  describe('the Volunteer and the Account are two records', () => {
    it('rosters a Volunteer who has no Account and may never have one', async () => {
      const volunteer = await createVolunteer(orgId(), {
        name: 'Terry Nash',
        email: 'terry@example.invalid',
      })
      await grantRole(orgId(), volunteer.id, 'head_of_maintenance')

      // ADR 0010: a report addressed to `maintenance` has to reach Terry whether
      // or not Terry has ever logged in, and ADR 0006 runs the whole POC with no
      // volunteer accounts at all.
      const accounts = await forOrg(orgId()).run((db) => db.select().from(volunteerAccounts))
      const identities = await forOrg(orgId()).run((db) => db.select().from(users).where(ours))
      expect(accounts).toEqual([])
      expect(identities).toEqual([])
      expect(volunteer.id).toEqual(expect.any(String))
    })

    it('claims the Account rather than creating it, and only after a code', async () => {
      const volunteer = await createVolunteer(orgId(), {
        name: 'Grace Whittaker',
        email: 'grace@example.invalid',
      })

      // Before: a Volunteer and nothing else.
      expect(await forOrg(orgId()).run((db) => db.select().from(users).where(ours))).toEqual([])

      await requestCode(orgId(), 'grace@example.invalid')
      const answered = await submitCode(orgId(), 'grace@example.invalid', codeFrom(posted[0]))

      expect(answered.signedIn).toBe(true)
      const [claimed] = await forOrg(orgId()).run((db) => db.select().from(volunteerAccounts))
      expect(claimed?.volunteerId).toBe(volunteer.id)
    })

    it('refuses to hand one Volunteer to a second identity rather than doing nothing', async () => {
      const { volunteer } = await signIn()

      // A corrected address, or a `user` row recreated by a restore. The old
      // `on conflict do nothing` swallowed this and left the volunteer signed
      // in and locked out at once: a valid session cookie, and 401 on every
      // request after it.
      await expect(claimAccount(orgId(), volunteer.id, 'some-other-identity')).rejects.toThrow(
        /already claimed/,
      )
    })

    it('tells an address it does not know that it does not know it', async () => {
      const requested = await requestCode(orgId(), 'nobody@example.invalid')

      // Deliberately against the usual convention (ADR 0008): enumerating a
      // sixty-person invite-only roster is not a meaningful threat, and "if that
      // address is registered…" leaves a volunteer waiting in a barn for a code
      // that a mistyped character guaranteed would never arrive.
      expect(requested).toEqual({ sent: false, because: 'unrecognised-email' })
      expect(posted).toEqual([])
      // And Better Auth is never given the chance to sign somebody up.
      expect(await forOrg(orgId()).run((db) => db.select().from(users).where(ours))).toEqual([])
    })

    it('matches an address whatever case it was typed in', async () => {
      await createVolunteer(orgId(), { name: 'Grace', email: 'Grace@Example.invalid' })

      // One person, one Volunteer. A case-sensitive comparison here would make
      // two of them the first time somebody's keyboard capitalised a name.
      await expect(requestCode(orgId(), 'grace@example.INVALID')).resolves.toEqual({ sent: true })
    })

    it('refuses a code to somebody who has left the rescue', async () => {
      const volunteer = await createVolunteer(orgId(), {
        name: 'Grace',
        email: 'grace@example.invalid',
      })
      await removeVolunteer(orgId(), volunteer.id)

      expect(await requestCode(orgId(), 'grace@example.invalid')).toEqual({
        sent: false,
        because: 'volunteer-removed',
      })

      // Removed, not deleted: the work they did still happened and still has a
      // subject (ADR 0008).
      const [still] = await forOrg(orgId()).run((db) =>
        db.select().from(volunteers).where(eq(volunteers.id, volunteer.id)),
      )
      expect(still?.removedAt).not.toBeNull()
    })

    it('stops one address asking for codes over and over', async () => {
      await createVolunteer(orgId(), { name: 'Grace', email: 'grace@example.invalid' })

      for (let asked = 0; asked < CODES_PER_ADDRESS; asked += 1) {
        expect(await requestCode(orgId(), 'grace@example.invalid')).toEqual({ sent: true })
      }
      const again = await requestCode(orgId(), 'grace@example.invalid')

      // The code endpoint is unauthenticated and reachable from the login
      // form. Without this, a few hundred requests spend the whole rescue's
      // daily email budget and sign-in stops working for everybody — which is
      // a denial of service against the one screen that has to work.
      expect(again).toEqual({ sent: false, because: 'too-many-codes' })
      expect(posted).toHaveLength(CODES_PER_ADDRESS)
    })

    it('counts the limit per address, so one volunteer cannot lock out another', async () => {
      await createVolunteer(orgId(), { name: 'Grace', email: 'grace@example.invalid' })
      await createVolunteer(orgId(), { name: 'Terry', email: 'terry@example.invalid' })

      for (let asked = 0; asked < CODES_PER_ADDRESS; asked += 1) {
        await requestCode(orgId(), 'grace@example.invalid')
      }

      expect(await requestCode(orgId(), 'terry@example.invalid')).toEqual({ sent: true })
    })

    it('does not let the limit turn an unknown address into a different answer', async () => {
      for (let asked = 0; asked < CODES_PER_ADDRESS + 2; asked += 1) {
        // The refusal a volunteer needs is *check it for a typo*, every time.
        // Turning into *slow down* on the fourth attempt would hide the one
        // thing that tells them what to do (ADR 0008).
        expect(await requestCode(orgId(), 'nobody@example.invalid')).toEqual({
          sent: false,
          because: 'unrecognised-email',
        })
      }
    })

    it('tells the volunteer nothing is coming when the mail could not be sent', async () => {
      await createVolunteer(orgId(), { name: 'Grace', email: 'grace@example.invalid' })
      setEmailTransport(null)

      const requested = await requestCode(orgId(), 'grace@example.invalid')

      // With email the only channel there is (ADR 0009), a send that quietly
      // fails is a volunteer standing in a barn waiting for a code. The
      // refusal has to reach the screen and not only the log — which means
      // this depends on Better Auth awaiting our sender rather than firing it
      // into the background, and that is what this pins.
      expect(requested).toEqual({ sent: false, because: 'email-not-sent' })
    })

    it('lets somebody who left and came back be created again', async () => {
      const first = await createVolunteer(orgId(), {
        name: 'Grace',
        email: 'grace@example.invalid',
      })
      await removeVolunteer(orgId(), first.id)

      const returned = await createVolunteer(orgId(), {
        name: 'Grace Whittaker',
        email: 'grace@example.invalid',
      })

      // Removal is a date rather than a delete, so the old row is still there
      // — and a total unique index on the address would make coming back a raw
      // Postgres violation that no screen could explain. The index is partial
      // over the live ones, and `volunteerByEmail` matches the same predicate.
      expect(returned.id).not.toBe(first.id)
      expect(await requestCode(orgId(), 'grace@example.invalid')).toEqual({ sent: true })
    })

    it('still tells somebody who left that they left, rather than sending them typo-hunting', async () => {
      const gone = await createVolunteer(orgId(), { name: 'Grace', email: 'grace@example.invalid' })
      await removeVolunteer(orgId(), gone.id)

      expect(await requestCode(orgId(), 'grace@example.invalid')).toEqual({
        sent: false,
        because: 'volunteer-removed',
      })
    })

    it('refuses a wrong code without saying which way it was wrong', async () => {
      await createVolunteer(orgId(), { name: 'Grace', email: 'grace@example.invalid' })
      await requestCode(orgId(), 'grace@example.invalid')

      const answered = await submitCode(orgId(), 'grace@example.invalid', '000000')

      expect(answered).toEqual({ signedIn: false, because: 'wrong-code' })
    })
  })

  describe('revocation, which is the whole security model', () => {
    it('deletes every session the volunteer holds, and takes effect at once', async () => {
      const { volunteer, answered } = await signIn()
      const request = carrying(answered.headers)
      expect(await actorFrom(orgId(), request)).not.toBeNull()

      const revocation = await revokeAccount(orgId(), volunteer.id)

      expect(revocation).toEqual({ revoked: true, sessionsEnded: 1 })
      // No staleness window at all: the same request, made again, is nobody.
      expect(await actorFrom(orgId(), request)).toBeNull()
      expect(await forOrg(orgId()).run((db) => db.select().from(sessions).where(mine(db)))).toEqual(
        [],
      )
    })

    it('leaves the Volunteer, their roles and their work behind', async () => {
      const { volunteer } = await signIn()
      await grantRole(orgId(), volunteer.id, 'head_of_maintenance')

      await revokeAccount(orgId(), volunteer.id)

      // ADR 0010: revoking an Account does not vacate a scope, and removing a
      // role does not sign anybody out. Two acts, kept separate on purpose — a
      // report addressed to `maintenance` still has to reach Terry.
      const [still] = await forOrg(orgId()).run((db) =>
        db.select().from(volunteers).where(eq(volunteers.id, volunteer.id)),
      )
      expect(still?.removedAt).toBeNull()
      const roles = await forOrg(orgId()).run((db) =>
        db
          .select({ role: volunteerRoles.role })
          .from(volunteerRoles)
          .where(eq(volunteerRoles.volunteerId, volunteer.id)),
      )
      expect(roles).toEqual([{ role: 'head_of_maintenance' }])
    })

    it('cannot be undone by asking for another code', async () => {
      const { volunteer } = await signIn()
      await revokeAccount(orgId(), volunteer.id)

      // The link is marked rather than deleted precisely so this holds: an
      // unconditional re-claim on the next sign-in would silently undo what an
      // officer decided.
      expect(await requestCode(orgId(), 'grace@example.invalid')).toEqual({
        sent: false,
        because: 'account-revoked',
      })
      expect(posted).toHaveLength(1)
    })

    it('is idempotent, because an admin screen gets double-tapped', async () => {
      const { volunteer } = await signIn()

      const first = await revokeAccount(orgId(), volunteer.id)
      const second = await revokeAccount(orgId(), volunteer.id)

      expect(first.revoked).toBe(true)
      expect(second).toEqual({ revoked: false, sessionsEnded: 0 })
    })

    it('can be reversed, and the volunteer signs in again rather than being handed a session', async () => {
      const { volunteer } = await signIn()
      await revokeAccount(orgId(), volunteer.id)

      expect(await restoreAccount(orgId(), volunteer.id)).toBe(true)

      // Restored means *may sign in again*, never *is signed in*. Nothing in
      // this application hands somebody a session they did not authenticate for.
      expect(await forOrg(orgId()).run((db) => db.select().from(sessions).where(mine(db)))).toEqual(
        [],
      )
      expect(await requestCode(orgId(), 'grace@example.invalid')).toEqual({ sent: true })
    })

    it('signs one device out without touching the others', async () => {
      const { volunteer, answered } = await signIn()
      const phone = carrying(answered.headers)

      await signOut(phone)

      // Signing out on the barn's shared tablet must not sign out the phone in
      // somebody's pocket — which is why this is not the revocation path.
      expect(await actorFrom(orgId(), phone)).toBeNull()
      expect(await actorForUser(orgId(), 'whoever')).toBeNull()
      const [account] = await forOrg(orgId()).run((db) =>
        db.select().from(volunteerAccounts).where(eq(volunteerAccounts.volunteerId, volunteer.id)),
      )
      // The Account is untouched: they can sign back in with a code.
      expect(account?.revokedAt).toBeNull()
    })
  })
  describe('through the API contract, which is what the phone actually calls', () => {
    /** The request the typed client would make, carrying whatever session it has. */
    function ask(path: string, session?: Headers): Request {
      const cookie = (session?.get('set-cookie') ?? '').split(';')[0] ?? ''
      return new Request(`http://barn.invalid${API_BASE}${path}`, {
        headers: cookie === '' ? {} : { cookie },
      })
    }

    it('answers /me with the Volunteer and their scopes, parsed by the contract', async () => {
      const { volunteer, answered } = await signIn()
      await grantRole(orgId(), volunteer.id, 'volunteer_coordinator')

      const response = await api.fetch(ask('/me', answered.headers))

      expect(response.status).toBe(200)
      // Parsed against the contract, not asserted: the answer the server sends
      // and the shape the phone was promised are one declaration (ADR 0021).
      const body = me.parse(await response.json())
      expect(body).toEqual({
        volunteerId: volunteer.id,
        name: 'Grace Whittaker',
        // Your own contact details, which #68 added: the redaction ADR 0017
        // asks for protects other people's, never your own.
        email: 'grace@example.invalid',
        mobile: null,
        domainScopes: ['roster'],
      })
    })

    it('refuses a signed-out read explicitly, and never with an empty answer', async () => {
      const response = await api.fetch(ask('/me'))

      // The acceptance criterion in the plainest form there is. An empty
      // answer would be indistinguishable from success to a retry queue and
      // from *nothing today* to a volunteer (ADR 0010).
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({ error: 'not_authorized', wanted: 'read' })
    })

    it('refuses the same read once the Account is revoked, on the very next request', async () => {
      const { volunteer, answered } = await signIn()
      expect((await api.fetch(ask('/me', answered.headers))).status).toBe(200)

      await revokeAccount(orgId(), volunteer.id)

      // No staleness window: the same cookie, the same endpoint, one request
      // later. This is the whole of why membership is a row rather than a
      // claim in a token (ADR 0008).
      expect((await api.fetch(ask('/me', answered.headers))).status).toBe(401)
    })

    it('stops crediting somebody who has left the rescue, on their very next request', async () => {
      const { volunteer, answered } = await signIn()
      const phone = carrying(answered.headers)
      expect(await actorFrom(orgId(), phone)).not.toBeNull()

      await removeVolunteer(orgId(), volunteer.id)

      // Leaving the rescue and having an Account switched off are two acts
      // under two scopes, and only the second one deletes sessions — so this
      // is the read that has to hold. ADR 0008's whole argument for membership
      // as a row is that removing it bites on the next request rather than
      // whenever something forces a refresh; a removed volunteer still reading
      // the barn from a phone in their pocket is that argument failing.
      expect(await actorFrom(orgId(), phone)).toBeNull()
      expect((await api.fetch(ask('/me', answered.headers))).status).toBe(401)
    })

    it('serves the day to a Volunteer and refuses it to nobody', async () => {
      const { answered } = await signIn()

      expect((await api.fetch(ask('/day', answered.headers))).status).toBe(200)
      expect((await api.fetch(ask('/day'))).status).toBe(401)
    })
  })
})
