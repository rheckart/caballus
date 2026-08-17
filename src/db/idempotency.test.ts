/**
 * ADR 0007's mandatory path: tick a checklist item with the network cut,
 * restore it, replay the queue, assert the tick was recorded exactly once.
 *
 * Against a real Postgres, because that is where the guarantee lives. Dedupe
 * is a primary key holding under two inserts, a transaction that carries the
 * key and the effect together, and policies that scope both — and a fake
 * agrees with whatever it is asked. The wrapper's own decisions are tested in
 * `src/server/api/route.test.ts` against the in-memory store; nothing here is.
 *
 * The Shift and its checklist do not exist yet, so the effect is a table this
 * file creates and drops. Putting a `checklist_ticks` in a migration to have
 * something to insert into would invent the domain ahead of the ticket that
 * decides it, which is how the two previous attempts at this application went.
 * What is under test is the wrapper and the key, and those are indifferent to
 * which table the work touched.
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`, then
 * `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { floor } from '../server/api/authorization'
import { createApi, json, noContent, queueable, type Api } from '../server/api/route'
import { currentOrgId } from '../server/request-context'
import { API_BASE } from '../shared/api-client'
import { closeDb, forOrg, type OrgId } from './for-org'
import { forgetKeysPastRetention, postgresIdempotency } from './idempotency'
import { idempotencyKeys } from './schema'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FRONT_BARN = '00000000-0000-0000-0000-0000000000c3'

/** The effect a queued write has, standing in for a Shift's checklist. */
const checklistTicks = pgTable('checklist_ticks', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  item: text('item').notNull(),
})

const ticked = queueable({ tickId: z.uuid(), item: z.string() })

describe.skipIf(!reachable)('idempotency, against the database', () => {
  const owner = postgres(ownerUrl, { max: 1 })

  function orgId(): OrgId {
    process.env.APP_ORG_ID = FRONT_BARN
    return currentOrgId()
  }

  beforeAll(async () => {
    process.env.APP_ORG_ID = FRONT_BARN
    await owner`delete from orgs where id = ${FRONT_BARN}`
    await owner`
      insert into orgs (id, name, time_zone)
      values (${FRONT_BARN}, 'Front Barn Horse Rescue', 'America/New_York')
    `

    // Created here rather than in a migration, and with the same two things
    // every table in this application carries: the org, and a policy that
    // fails closed without it (ADR 0007).
    await owner`drop table if exists checklist_ticks`
    await owner`
      create table checklist_ticks (
        id uuid primary key,
        org_id uuid not null references orgs(id),
        item text not null
      )
    `
    await owner`alter table checklist_ticks enable row level security`
    await owner`
      create policy checklist_ticks_in_scope on checklist_ticks for all
        using (org_id::text = current_setting('app.org_id', true))
        with check (org_id::text = current_setting('app.org_id', true))
    `
    await owner`grant select, insert, update, delete on checklist_ticks to caballus_app`
  })

  beforeEach(() => {
    // Every write here writes two structured lines, which is the point of them
    // and not something the test output needs to carry.
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await owner`delete from checklist_ticks where org_id = ${FRONT_BARN}`
    await owner`delete from idempotency_keys where org_id = ${FRONT_BARN}`
  })

  afterAll(async () => {
    await owner`drop table if exists checklist_ticks`
    await owner`delete from orgs where id = ${FRONT_BARN}`
    await owner.end()
    await closeDb()
  })

  /**
   * The application, with one write on it and a count of how often the handler
   * actually ran — the number the whole of ADR 0005 is about.
   */
  function barn(): { api: Api; ran: () => number } {
    let ran = 0
    const api = createApi({
      idempotency: postgresIdempotency(),
      context: (request) => ({
        orgId: orgId(),
        requestId: request.headers.get('x-request-id') ?? randomUUID(),
        actor: { volunteerId: 'v_01J8', domainScopes: [] },
      }),
    })

    api.mutation(
      '/ticks',
      floor('work-on-a-shift-you-are-rostered-on'),
      ticked,
      async (input, { db, context }) => {
        ran += 1
        await db
          .insert(checklistTicks)
          .values({ id: input.tickId, orgId: context.orgId, item: input.item })
        return json({ tickId: input.tickId }, 201)
      },
    )

    return { api, ran: () => ran }
  }

  /**
   * One item in the phone's queue. The key is minted here, once, before the
   * first attempt — mint it per attempt and every retry is a new event, which
   * is the bug ADR 0005 exists to prevent.
   */
  function queued(item: string) {
    return { idempotencyKey: randomUUID(), tickId: randomUUID(), item }
  }

  /**
   * An attempt to send it. `online: false` is the barn's connectivity at 6am:
   * nothing leaves the phone, the item stays in the queue, and the server
   * never hears about it.
   */
  async function send(
    api: Api,
    write: Record<string, unknown>,
    { online = true }: { online?: boolean } = {},
  ): Promise<Response | null> {
    if (!online) return null
    return api.fetch(
      new Request(`http://barn.invalid${API_BASE}/ticks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(write),
      }),
    )
  }

  /** Every tick the organisation can see, through the scope the app uses. */
  async function ticks(): Promise<{ id: string; item: string }[]> {
    return forOrg(orgId()).run((db) =>
      db.select({ id: checklistTicks.id, item: checklistTicks.item }).from(checklistTicks),
    )
  }

  it('records the tick exactly once when the queue is replayed', async () => {
    const { api, ran } = barn()
    const write = queued('muck the paddock')

    // The network is out. The write sits in IndexedDB in somebody's pocket,
    // which is the likeliest truth behind "it didn't save" (ADR 0007).
    expect(await send(api, write, { online: false })).toBeNull()
    expect(await ticks()).toEqual([])

    // It comes back and the queue drains. The response is lost on the way
    // back, so the item is still queued and goes again — indistinguishable,
    // from the phone's side, from never having arrived.
    const first = await send(api, write)
    const replay = await send(api, write)

    expect(first?.status).toBe(201)
    expect(replay?.status).toBe(201)
    await expect(replay?.json()).resolves.toEqual({ tickId: write.tickId })

    // The whole point: one tick, and the handler ran once.
    expect(await ticks()).toEqual([{ id: write.tickId, item: 'muck the paddock' }])
    expect(ran()).toBe(1)
  })

  it('records the key in the same transaction as the tick, so a rollback takes both', async () => {
    let attempts = 0
    const api = createApi({
      idempotency: postgresIdempotency(),
      context: () => ({
        orgId: orgId(),
        requestId: randomUUID(),
        actor: { volunteerId: 'v_01J8', domainScopes: [] },
      }),
    })
    api.mutation(
      '/ticks',
      floor('work-on-a-shift-you-are-rostered-on'),
      ticked,
      async (input, { db, context }) => {
        attempts += 1
        await db
          .insert(checklistTicks)
          .values({ id: input.tickId, orgId: context.orgId, item: input.item })
        if (attempts === 1) throw new Error('the barn lost power')
        return json({ tickId: input.tickId }, 201)
      },
    )

    const write = queued('fill the water trough')

    expect((await send(api, write))?.status).toBe(500)
    // Nothing committed, so nothing is remembered: a key that outlived its
    // rolled-back effect would turn the retry into a permanent silent failure.
    const keys = await forOrg(orgId()).run((db) =>
      db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, write.idempotencyKey)),
    )
    expect(keys).toEqual([])
    expect(await ticks()).toEqual([])

    expect((await send(api, write))?.status).toBe(201)
    expect(await ticks()).toHaveLength(1)
  })

  it('runs the work once when two attempts arrive at the same moment', async () => {
    const { api, ran } = barn()
    const write = queued('turn out the geldings')

    // A flaky connection retrying before the first attempt has answered. The
    // second insert blocks on the primary key until the first transaction
    // settles, which is why the claim is made before the work and not after.
    const [first, second] = await Promise.all([send(api, write), send(api, write)])

    expect([first?.status, second?.status]).toEqual([201, 201])
    expect(await ticks()).toHaveLength(1)
    expect(ran()).toBe(1)
  })

  it('refuses the same key carrying a different tick', async () => {
    const { api, ran } = barn()
    const write = queued('sweep the barn')

    expect((await send(api, write))?.status).toBe(201)
    const different = await send(api, { ...write, item: 'groom the mares' })

    // A client bug or a collision, and it must not be answered with the first
    // response — that would report success for a tick nothing recorded.
    expect(different?.status).toBe(409)
    await expect(different?.json()).resolves.toEqual({ error: 'idempotency_key_reused' })
    expect(await ticks()).toEqual([{ id: write.tickId, item: 'sweep the barn' }])
    expect(ran()).toBe(1)
  })

  it('replays an answer that had no body as the answer it was', async () => {
    let ran = 0
    const api = createApi({
      idempotency: postgresIdempotency(),
      context: (request) => ({
        orgId: orgId(),
        requestId: request.headers.get('x-request-id') ?? randomUUID(),
        actor: { volunteerId: 'v_01J8', domainScopes: [] },
      }),
    })
    api.mutation('/ticks', floor('work-on-a-shift-you-are-rostered-on'), ticked, () => {
      ran += 1
      return noContent()
    })

    const write = queued('sweep the barn')
    const first = await send(api, write)
    const replay = await send(api, write)

    // Through the table this time, not the double: only the status and the
    // body are stored, and a 204 has neither a body nor a content type. What
    // comes back out has to be the same answer, header for header, or ADR
    // 0020's promise is a JSON-shaped approximation of it (#30).
    expect(first?.status).toBe(204)
    expect(replay?.status).toBe(204)
    expect([...(replay?.headers ?? [])]).toEqual([...(first?.headers ?? [])])
    expect(replay?.headers.get('content-type')).toBeNull()
    expect(ran).toBe(1)
  })

  it('will not let one organisation replay another organisation’s key', async () => {
    const { api, ran } = barn()
    const write = queued('hay in every field')
    expect((await send(api, write))?.status).toBe(201)

    // The policies scope the key table like every other one, so the row is
    // simply not there for anyone else — a key is unique within a rescue and
    // says nothing outside it.
    process.env.APP_ORG_ID = '00000000-0000-0000-0000-0000000000c4'
    const elsewhere = await forOrg(currentOrgId()).run((db) =>
      db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, write.idempotencyKey)),
    )
    process.env.APP_ORG_ID = FRONT_BARN

    expect(elsewhere).toEqual([])
    expect(ran()).toBe(1)
  })

  it('forgets keys past their retention, and keeps the ones inside it', async () => {
    const { api } = barn()
    const recent = queued('check the water heaters')
    expect((await send(api, recent))?.status).toBe(201)

    const stale = randomUUID()
    await owner`
      insert into idempotency_keys (org_id, idempotency_key, route, fingerprint, status, response, recorded_at)
      values (${FRONT_BARN}, ${stale}, 'POST /ticks', 'whatever', 201, '{}', now() - interval '31 days')
    `

    const dropped = await forgetKeysPastRetention(orgId())

    expect(dropped).toBe(1)
    const left = await forOrg(orgId()).run((db) =>
      db.select({ key: idempotencyKeys.key }).from(idempotencyKeys),
    )
    expect(left).toEqual([{ key: recent.idempotencyKey }])
  })
})
