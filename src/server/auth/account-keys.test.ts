/**
 * The migration that rewrites every Better Auth `user` to its Account key
 * (#111, ADR 0030), run against a database of its own.
 *
 * **A database of its own, because the migration is global.** `user` carries no
 * `org_id`, and the rewrite deletes every unclaimed row in it — which, run in
 * the shared test database, is another suite's `user` deleted between its
 * sign-in and its claim. So this file creates a throwaway database, migrates it
 * to the head, seeds the state every Account was in before the rewrite — keyed
 * by a real address — and then runs `0024_accounts_keyed_by_volunteer.sql`
 * itself over it, statement by statement, the way the migrator does.
 *
 * What the end-to-end half needs the application for — a session minted before
 * the rewrite resolving after it — is in `src/server/auth/one-rescue.test.ts`,
 * against the database the application actually connects to.
 *
 * Skipped, loudly, on a machine with no database.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { accountKey } from './volunteers'

const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = ownerUrl !== ''

const MIGRATIONS = fileURLToPath(new URL('../../db/migrations', import.meta.url))
const REWRITE = `${MIGRATIONS}/0024_accounts_keyed_by_volunteer.sql`

const ORG = '00000000-0000-0000-0000-0000000000a7'
const OTHER_ORG = '00000000-0000-0000-0000-0000000000a8'

describe.skipIf(!reachable)('the rewrite to Account keys, in a database of its own', () => {
  const name = `caballus_rewrite_${crypto.randomUUID().replaceAll('-', '')}`
  const server = postgres(ownerUrl, { max: 1 })
  let scratch: postgres.Sql

  beforeAll(async () => {
    await server.unsafe(`create database "${name}"`)
    const url = new URL(ownerUrl)
    url.pathname = `/${name}`
    scratch = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    await migrate(drizzle(scratch), { migrationsFolder: MIGRATIONS })
    await scratch`
      insert into orgs (id, name, time_zone) values
        (${ORG}, 'Rescue', 'America/New_York'),
        (${OTHER_ORG}, 'Other Rescue', 'America/New_York')
    `
  }, 60_000)

  beforeEach(async () => {
    await scratch`delete from volunteer_accounts`
    await scratch`delete from "session"`
    await scratch`delete from "user"`
    await scratch`delete from volunteers`
  })

  afterAll(async () => {
    await scratch.end()
    await server.unsafe(`drop database if exists "${name}" with (force)`)
    await server.end()
  })

  /** The migration's own statements, split where the migrator splits them. */
  async function rewrite(): Promise<void> {
    const text = await readFile(REWRITE, 'utf8')
    for (const statement of text.split('--> statement-breakpoint')) {
      if (statement.trim() !== '') await scratch.unsafe(statement)
    }
  }

  async function volunteer(email: string, org = ORG): Promise<string> {
    const [row] = await scratch`
      insert into volunteers (id, org_id, name, email)
      values (gen_random_uuid(), ${org}, 'Someone', ${email})
      returning id
    `
    return String(row?.id)
  }

  /** A `user` keyed by a real address, the way every Account was before #111. */
  async function legacyAccount(
    volunteerId: string | null,
    email: string,
    { revoked = false, org = ORG } = {},
  ): Promise<string> {
    const userId = `user-${email}`
    await scratch`
      insert into "user" (id, name, email, email_verified) values (${userId}, 'Someone', ${email}, true)
    `
    await scratch`
      insert into "session" (id, token, user_id, expires_at)
      values (${`session-${email}`}, ${`token-${email}`}, ${userId}, now() + interval '1 year')
    `
    if (volunteerId !== null) {
      await scratch`
        insert into volunteer_accounts (org_id, volunteer_id, user_id, revoked_at)
        values (${org}, ${volunteerId}, ${userId}, case when ${revoked} then now() end)
      `
    }
    return userId
  }

  async function emailOf(userId: string): Promise<string | undefined> {
    const [row] = await scratch`select email from "user" where id = ${userId}`
    return row === undefined ? undefined : String(row.email)
  }

  it('keys every claimed user by its Volunteer, spelled as accountKey spells it', async () => {
    const ada = await volunteer('ada@rescue.test')
    const adaUser = await legacyAccount(ada, 'ada@rescue.test')

    await rewrite()

    // Two spellings of one rule — SQL in the migration, TypeScript in the
    // sign-in path — and this is where they are held to each other.
    expect(await emailOf(adaUser)).toBe(accountKey(ada))
  })

  it('keeps the user id, so a session minted before it still points at the same Account', async () => {
    const ada = await volunteer('ada@rescue.test')
    const adaUser = await legacyAccount(ada, 'ada@rescue.test')

    await rewrite()

    const sessions =
      await scratch`select user_id from "session" where token = 'token-ada@rescue.test'`
    expect(sessions.map((row) => String(row.user_id))).toEqual([adaUser])
    const links = await scratch`select user_id from volunteer_accounts where volunteer_id = ${ada}`
    expect(links.map((row) => String(row.user_id))).toEqual([adaUser])
  })

  it('rewrites a revoked Account too, because it is still an address somebody receives at', async () => {
    const bea = await volunteer('bea@rescue.test')
    const beaUser = await legacyAccount(bea, 'bea@rescue.test', { revoked: true })

    await rewrite()

    expect(await emailOf(beaUser)).toBe(accountKey(bea))
  })

  it('deletes a user nobody claimed, and its sessions with it', async () => {
    const orphan = await legacyAccount(null, 'orphan@rescue.test')

    await rewrite()

    expect(await emailOf(orphan)).toBeUndefined()
    expect(await scratch`select id from "session" where user_id = ${orphan}`).toHaveLength(0)
  })

  it('leaves no deliverable address anywhere in user', async () => {
    const ada = await volunteer('ada@rescue.test')
    await legacyAccount(ada, 'ada@rescue.test')
    const bea = await volunteer('bea@rescue.test')
    await legacyAccount(bea, 'bea@rescue.test', { revoked: true })
    await legacyAccount(null, 'orphan@rescue.test')

    await rewrite()

    const addresses = await scratch`select email from "user"`
    expect(addresses.length).toBe(2)
    for (const row of addresses) expect(String(row.email)).toMatch(/@account\.invalid$/)
  })

  it('is safe to run twice, because a deploy can be retried', async () => {
    const ada = await volunteer('ada@rescue.test')
    const adaUser = await legacyAccount(ada, 'ada@rescue.test')

    await rewrite()
    await rewrite()

    expect(await emailOf(adaUser)).toBe(accountKey(ada))
  })

  it('stops, rather than choosing, when one user is claimed at two rescues', async () => {
    const atOne = await volunteer('cal@rescue.test')
    const atOther = await volunteer('cal@rescue.test', OTHER_ORG)
    const shared = await legacyAccount(atOne, 'cal@rescue.test')
    await scratch`
      insert into volunteer_accounts (org_id, volunteer_id, user_id)
      values (${OTHER_ORG}, ${atOther}, ${shared})
    `

    await expect(rewrite()).rejects.toThrow(/more than one Volunteer/)
    // And nothing moved: the address is still the one it was claimed under.
    expect(await emailOf(shared)).toBe('cal@rescue.test')
  })
})
