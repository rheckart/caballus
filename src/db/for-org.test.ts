/**
 * The tenancy guarantee, against a real Postgres.
 *
 * ADR 0007: RLS policies are database behaviour and a fake proves nothing
 * about any of them. What is being proved here is the shape of the failure —
 * a query outside the scope returns **zero rows, not another organisation's
 * rows**.
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`, then
 * `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { currentOrgId } from '../server/request-context'
import { closeDb, forOrg, type OrgId } from './for-org'
import { orgs } from './schema'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FRONT_BARN = '00000000-0000-0000-0000-0000000000a1'
const OTHER_RESCUE = '00000000-0000-0000-0000-0000000000b2'

/**
 * The one place an `OrgId` is minted is the request context, so the test asks
 * it for one rather than casting a string into the brand.
 */
function orgId(id: string): OrgId {
  process.env.APP_ORG_ID = id
  return currentOrgId()
}

describe.skipIf(!reachable)('forOrg', () => {
  // The owner, which bypasses its own policies — which is exactly why the
  // application never connects as it.
  const owner = postgres(ownerUrl, { max: 1 })

  beforeAll(async () => {
    await owner`delete from orgs where id in (${FRONT_BARN}, ${OTHER_RESCUE})`
    await owner`
      insert into orgs (id, name, time_zone) values
        (${FRONT_BARN}, 'Front Barn Horse Rescue', 'America/New_York'),
        (${OTHER_RESCUE}, 'Somebody Else', 'America/Chicago')
    `
  })

  afterAll(async () => {
    await owner`delete from orgs where id in (${FRONT_BARN}, ${OTHER_RESCUE})`
    await owner.end()
    await closeDb()
  })

  it('sees the organisation the request named', async () => {
    const rows = await forOrg(orgId(FRONT_BARN)).run((db) =>
      db.select({ id: orgs.id, name: orgs.name }).from(orgs),
    )

    expect(rows).toEqual([{ id: FRONT_BARN, name: 'Front Barn Horse Rescue' }])
  })

  it('sees the other one when the request names that one', async () => {
    const rows = await forOrg(orgId(OTHER_RESCUE)).run((db) =>
      db.select({ id: orgs.id }).from(orgs),
    )

    expect(rows).toEqual([{ id: OTHER_RESCUE }])
  })

  it('returns nothing at all when nobody set the scope', async () => {
    // A connection as the application role with no `app.org_id`: the state a
    // query that skipped forOrg would run in. It fails closed rather than
    // quietly returning the whole table.
    const unscoped = postgres(applicationUrl, { max: 1 })
    try {
      const rows = await unscoped`select id from orgs`
      expect(rows).toHaveLength(0)
    } finally {
      await unscoped.end()
    }
  })

  it('leaves the scope behind with the transaction', async () => {
    // One connection for both halves, deliberately: asking a *fresh* connection
    // whether it carries a scope proves nothing, since a fresh connection never
    // does. This is the same connection, before and after, so it fails if
    // `set_config(..., true)` ever loses its third argument.
    const client = postgres(applicationUrl, { max: 1 })
    try {
      const inside = await client.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${FRONT_BARN}, true)`
        return tx`select id from orgs`
      })
      expect(inside).toHaveLength(1)

      // The setting reverts to its reset value, which is the empty string
      // rather than null — so what is asserted is what the policy makes of it,
      // which is the guarantee that actually matters: the next request on this
      // connection sees nothing until it sets its own scope.
      const scope = await client`select current_setting('app.org_id', true) as scope`
      expect(scope[0]?.scope).not.toBe(FRONT_BARN)

      const after = await client`select id from orgs`
      expect(after).toHaveLength(0)
    } finally {
      await client.end()
    }
  })
})
