/**
 * The Board, through the API application's own fetch entry — the same primary
 * seam the rest of the domain uses (#32's testing decisions, #37).
 *
 * Two things are being claimed here that only a real request can settle: that
 * the grid comes back in stall order with the sections and the OPEN row the
 * whiteboard has, and that the barn's tablet authenticates as the barn rather
 * than as a person (ADR 0022) — token in configuration, header on the request,
 * no actor anywhere.
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`,
 * then `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeDb, type OrgId } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import { board } from '../../shared/api-contract'
import { BOARD_TOKEN_HEADER } from '../../shared/board'
import type { DomainScope } from '../../shared/domain-scopes'
import { anonymousContext, currentOrgId } from '../request-context'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FIELD_BARN = '00000000-0000-0000-0000-0000000000ea'

/** What the tablet in the feed room is enrolled with (ADR 0022). */
const TOKEN = 'a-token-somebody-typed-into-the-tablet-once'

describe.skipIf(!reachable)('the Board, through the API', () => {
  const owner = postgres(ownerUrl, { max: 1 })

  function orgId(): OrgId {
    process.env.APP_ORG_ID = FIELD_BARN
    return currentOrgId()
  }

  function apiAs(volunteerId: string, scopes: readonly DomainScope[]) {
    return buildApi({
      idempotency: postgresIdempotency(),
      context: (request) => ({
        ...anonymousContext(request),
        actor: { volunteerId, domainScopes: scopes },
      }),
    })
  }

  /**
   * The application as it really resolves a request: no supplied actor, so the
   * kiosk token and the header decide everything.
   */
  function apiAsItself() {
    return buildApi({
      idempotency: postgresIdempotency(),
      context: (request) => anonymousContext(request),
    })
  }

  function url(path: string): string {
    return `http://barn.invalid${API_BASE}${path}`
  }

  async function get(
    api: ReturnType<typeof apiAs>,
    path: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await api.fetch(new Request(url(path), { headers }))
    return { status: response.status, body: (await bodyOf(response)) as Record<string, unknown> }
  }

  async function post(
    api: ReturnType<typeof apiAs>,
    path: string,
    payload: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await api.fetch(
      new Request(url(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, idempotencyKey: newIdempotencyKey() }),
      }),
    )
    return { status: response.status, body: (await bodyOf(response)) as Record<string, unknown> }
  }

  async function bodyOf(response: Response): Promise<unknown> {
    const text = await response.text()
    if (text === '') return {}
    return JSON.parse(text) as unknown
  }

  beforeAll(async () => {
    orgId()
    await wipe()
    await owner`
      insert into orgs (id, name, time_zone)
      values (${FIELD_BARN}, 'Field Barn Horse Rescue', 'America/New_York')
    `
  })

  beforeEach(() => {
    process.env.BOARD_TOKEN = TOKEN
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    delete process.env.BOARD_TOKEN
    await wipe({ keepOrg: true })
  })

  afterAll(async () => {
    await wipe()
    await owner.end()
    await closeDb()
  })

  async function wipe({ keepOrg = false }: { keepOrg?: boolean } = {}): Promise<void> {
    await owner`delete from audit_entries where org_id = ${FIELD_BARN}`
    await owner`delete from announcements where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_lines where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_versions where org_id = ${FIELD_BARN}`
    await owner`delete from horse_measurements where org_id = ${FIELD_BARN}`
    await owner`delete from products where org_id = ${FIELD_BARN}`
    await owner`delete from suppliers where org_id = ${FIELD_BARN}`
    await owner`delete from horse_space_assignments where org_id = ${FIELD_BARN}`
    await owner`delete from horses where org_id = ${FIELD_BARN}`
    await owner`delete from spaces where org_id = ${FIELD_BARN}`
    await owner`delete from idempotency_keys where org_id = ${FIELD_BARN}`
    await owner`delete from volunteers where org_id = ${FIELD_BARN}`
    if (!keepOrg) await owner`delete from orgs where id = ${FIELD_BARN}`
  }

  async function seedVolunteer(name: string, email: string): Promise<string> {
    const [row] = await owner`
      insert into volunteers (id, org_id, name, email)
      values (gen_random_uuid(), ${FIELD_BARN}, ${name}, ${email})
      returning id
    `
    return String(row?.id)
  }

  /** Whoever sets the barn up: every write below is behind `horse_care`. */
  async function holder() {
    const id = await seedVolunteer('Priya Chandra', `priya-${newIdempotencyKey()}@barn.test`)
    return apiAs(id, ['horse_care'])
  }

  async function reader() {
    const id = await seedVolunteer('Reader Volunteer', `reader-${newIdempotencyKey()}@barn.test`)
    return apiAs(id, [])
  }

  async function seedSpace(
    api: ReturnType<typeof apiAs>,
    kind: string,
    name: string,
  ): Promise<string> {
    const created = await post(api, '/spaces', { kind, name })
    return created.body.spaceId as string
  }

  async function seedHorse(
    api: ReturnType<typeof apiAs>,
    name: string,
    at: { stall?: string; field?: string; barn?: string } = {},
  ): Promise<string> {
    const created = await post(api, '/horses', { name })
    const horseId = created.body.horseId as string
    for (const [kind, spaceId] of Object.entries(at)) {
      await post(api, '/horses/space', { horseId, kind, spaceId })
    }
    return horseId
  }

  /** The Board as the tablet on the feed room wall reads it. */
  async function boardAsTablet() {
    const read = await get(apiAsItself(), '/board', { [BOARD_TOKEN_HEADER]: TOKEN })
    expect(read.status).toBe(200)
    // Parsed against the contract, not asserted: what the phone and the tablet
    // are promised is this schema, and a test that reads the body loosely
    // proves nothing about what they will receive (ADR 0021).
    return board.parse(read.body)
  }

  describe('who may read it', () => {
    it('answers the barn tablet, which presents a token and is nobody', async () => {
      const grid = await boardAsTablet()
      expect(grid.sections).toEqual([])
    })

    it('answers a signed-in Volunteer, on their own phone', async () => {
      const read = await get(await reader(), '/board')
      expect(read.status).toBe(200)
    })

    it('refuses a request that is neither, rather than making the grid public', async () => {
      const read = await get(apiAsItself(), '/board')
      expect(read.status).toBe(401)
      expect(read.body.error).toBe('not_authorized')
    })

    it('refuses a wrong token, and refuses every token when none is configured', async () => {
      const wrong = await get(apiAsItself(), '/board', { [BOARD_TOKEN_HEADER]: 'not-the-token' })
      expect(wrong.status).toBe(401)

      delete process.env.BOARD_TOKEN
      const unconfigured = await get(apiAsItself(), '/board', { [BOARD_TOKEN_HEADER]: '' })
      expect(unconfigured.status).toBe(401)
    })

    it('lets the tablet no further than the Board', async () => {
      // The token authorizes one read. The horse profile a row links to is
      // behind the ordinary floor, so a tablet cannot drill down (ADR 0022).
      const elsewhere = await get(apiAsItself(), '/horses', { [BOARD_TOKEN_HEADER]: TOKEN })
      expect(elsewhere.status).toBe(401)
    })
  })

  describe('the grid', () => {
    it('runs in stall order, keeps the OPEN stall’s row, and sections the Small Barn', async () => {
      const api = await holder()
      const stallOne = await seedSpace(api, 'stall', '1')
      const stallTwoThree = await seedSpace(api, 'stall', '2 & 3')
      const stallTen = await seedSpace(api, 'stall', '10')
      await seedSpace(api, 'stall', '7')
      const mainBarn = await seedSpace(api, 'barn', 'Main barn')
      const smallBarn = await seedSpace(api, 'barn', 'Small Barn')

      await seedHorse(api, 'Dawson', { stall: stallOne, barn: mainBarn })
      await seedHorse(api, 'Blue', { stall: stallTwoThree, barn: mainBarn })
      await seedHorse(api, 'Apollo', { stall: stallTen, barn: mainBarn })
      await seedHorse(api, 'Mystery', { barn: smallBarn })
      await seedHorse(api, 'Nora', { barn: smallBarn })

      const grid = await boardAsTablet()

      expect(grid.sections.map((section) => section.heading)).toEqual(['Main barn', 'Small Barn'])
      expect(
        grid.sections[0]?.rows.map((row) => [row.stall?.name, row.horse?.name ?? 'OPEN']),
      ).toEqual([
        ['1', 'Dawson'],
        ['2 & 3', 'Blue'],
        ['7', 'OPEN'],
        ['10', 'Apollo'],
      ])
      expect(grid.sections[1]?.rows.map((row) => row.horse?.name)).toEqual(['Mystery', 'Nora'])
    })

    it('takes a Departed horse off the board and leaves its stall standing open', async () => {
      const api = await holder()
      const stall = await seedSpace(api, 'stall', '4')
      const horseId = await seedHorse(api, 'Delilah', { stall })

      await post(api, '/horses/departure', { horseId, departedOn: '2026-05-01' })

      const grid = await boardAsTablet()
      expect(grid.sections[0]?.rows).toEqual([
        expect.objectContaining({ horse: null, stall: expect.objectContaining({ name: '4' }) }),
      ])
    })

    it('carries the halter colour, the field and the current feeding per Shift Type', async () => {
      const api = await holder()
      const stall = await seedSpace(api, 'stall', '1')
      const fieldA = await seedSpace(api, 'field', 'A')
      const horseId = await seedHorse(api, 'Dawson', { stall, field: fieldA })
      await post(api, '/horses/attributes', { horseId, halterColour: 'green' })

      const senior = await post(api, '/products', {
        name: 'Senior',
        kind: 'feed',
        prescription: false,
      })
      const prascend = await post(api, '/products', {
        name: 'Prascend',
        kind: 'medication',
        prescription: true,
      })

      await post(api, '/feed-schedules', {
        horseId,
        shiftType: 'feed_am',
        validFrom: '2026-01-02',
        lines: [
          { productId: senior.body.productId, amount: '1 scoop', route: 'in_feed' },
          { productId: prascend.body.productId, amount: '1 tab', route: 'oral_syringe' },
        ],
      })

      const grid = await boardAsTablet()
      const horse = grid.sections[0]?.rows[0]?.horse

      expect(horse?.halterColour).toBe('green')
      expect(horse?.field?.name).toBe('A')
      expect(horse?.feedings).toHaveLength(1)
      expect(horse?.feedings[0]?.shiftType).toBe('feed_am')
      // A syringe medication is visibly not in-feed, on the wall as on the
      // phone (`CONTEXT.md`'s Route).
      expect(horse?.feedings[0]?.lines).toEqual([
        expect.objectContaining({ productName: 'Senior', route: 'in_feed', productKind: 'feed' }),
        expect.objectContaining({
          productName: 'Prascend',
          route: 'oral_syringe',
          productKind: 'medication',
        }),
      ])
    })

    it('leaves a Shift Type this horse has no schedule for absent rather than empty', async () => {
      const api = await holder()
      const stall = await seedSpace(api, 'stall', '1')
      await seedHorse(api, 'Blue', { stall })

      const grid = await boardAsTablet()
      expect(grid.sections[0]?.rows[0]?.horse?.feedings).toEqual([])
    })

    it('shows a horse no Space has been decided for rather than dropping it', async () => {
      const api = await holder()
      await seedHorse(api, 'Storm')

      const grid = await boardAsTablet()
      expect(grid.sections.map((section) => section.heading)).toEqual(['No space assigned'])
      expect(grid.sections[0]?.rows[0]?.horse?.name).toBe('Storm')
    })
  })

  describe('Announcements, the whiteboard’s missing panel (#46)', () => {
    it('carries unexpired Announcements on the same read as the rows', async () => {
      const api = await holder()
      const today = ((await get(api, '/day')).body as { day: string }).day
      await post(api, '/announcements', { text: 'The hay comes Thursday.', expiresOn: today })

      const grid = await boardAsTablet()
      expect(grid.announcements).toEqual([
        expect.objectContaining({ text: 'The hay comes Thursday.' }),
      ])
    })

    it('leaves an expired Announcement off the wall', async () => {
      const api = await holder()
      await post(api, '/announcements', {
        text: 'The water is back on.',
        expiresOn: '2020-01-01',
      })

      const grid = await boardAsTablet()
      expect(grid.announcements).toEqual([])
    })
  })
})
