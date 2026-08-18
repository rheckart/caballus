/**
 * Products, Suppliers, Feed Schedules and measurements, through the API
 * application's own fetch entry — the same primary seam
 * `src/server/api/horses.test.ts` uses, for the domain #36 adds (ADR 0003,
 * ADR 0019).
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`,
 * then `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { closeDb } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import type { DomainScope } from '../../shared/domain-scopes'
import { anonymousContext } from '../request-context'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FIELD_BARN = '00000000-0000-0000-0000-0000000000e7'

describe.skipIf(!reachable)('Products, Suppliers and Feed Schedules, through the API', () => {
  const owner = postgres(ownerUrl, { max: 1 })

  function apiAs(volunteerId: string, scopes: readonly DomainScope[]) {
    return buildApi({
      idempotency: postgresIdempotency(),
      context: (request) => ({
        ...anonymousContext(request),
        actor: { volunteerId, domainScopes: scopes },
      }),
    })
  }

  function url(path: string): string {
    return `http://barn.invalid${API_BASE}${path}`
  }

  async function get(
    api: ReturnType<typeof apiAs>,
    path: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await api.fetch(new Request(url(path)))
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
    process.env.APP_ORG_ID = FIELD_BARN
    await wipe()
    await owner`
      insert into orgs (id, name, time_zone)
      values (${FIELD_BARN}, 'Field Barn Horse Rescue', 'America/New_York')
    `
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await wipe({ keepOrg: true })
  })

  afterAll(async () => {
    await wipe()
    await owner.end()
    await closeDb()
  })

  async function wipe({ keepOrg = false }: { keepOrg?: boolean } = {}): Promise<void> {
    await owner`delete from audit_entries where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_lines where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_versions where org_id = ${FIELD_BARN}`
    await owner`delete from horse_measurements where org_id = ${FIELD_BARN}`
    await owner`delete from products where org_id = ${FIELD_BARN}`
    await owner`delete from suppliers where org_id = ${FIELD_BARN}`
    await owner`delete from horses where org_id = ${FIELD_BARN}`
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

  async function horseCareHolder() {
    const id = await seedVolunteer('Priya Chandra', `priya-${newIdempotencyKey()}@barn.test`)
    return apiAs(id, ['horse_care'])
  }

  async function suppliesHolder() {
    const id = await seedVolunteer('Barn Manager', `bm-${newIdempotencyKey()}@barn.test`)
    return apiAs(id, ['supplies'])
  }

  async function reader() {
    const id = await seedVolunteer('Reader Volunteer', `reader-${newIdempotencyKey()}@barn.test`)
    return apiAs(id, [])
  }

  async function seedHorse(api: ReturnType<typeof apiAs>, name: string): Promise<string> {
    const created = await post(api, '/horses', { name })
    return created.body.horseId as string
  }

  async function seedProduct(
    api: ReturnType<typeof apiAs>,
    name: string,
    kind = 'feed',
  ): Promise<string> {
    const created = await post(api, '/products', { name, kind, prescription: false })
    return created.body.productId as string
  }

  describe('Suppliers', () => {
    it('creates a Supplier, readable by everyone', async () => {
      const holder = await horseCareHolder()
      const created = await post(holder, '/suppliers', {
        name: 'Allivet',
        url: 'https://allivet.com',
      })
      expect(created.status).toBe(201)

      const listed = await get(await reader(), '/suppliers')
      expect(listed.body.suppliers).toContainEqual(
        expect.objectContaining({ name: 'Allivet', url: 'https://allivet.com' }),
      )
    })

    it('refuses to create a Supplier without horse_care or supplies', async () => {
      const created = await post(await reader(), '/suppliers', { name: 'Chewy' })
      expect(created.status).toBe(403)
    })

    it('lets a supplies holder create one too, ADR 0019’s two-Scope record', async () => {
      const created = await post(await suppliesHolder(), '/suppliers', { name: 'The Vet' })
      expect(created.status).toBe(201)
    })
  })

  describe('Products', () => {
    it('creates a Product with an audit entry, editable by horse_care or supplies', async () => {
      const holder = await horseCareHolder()
      const created = await post(holder, '/products', {
        name: 'Senior',
        kind: 'feed',
        prescription: false,
      })
      expect(created.status).toBe(201)
      const productId = created.body.productId as string

      const audited = await owner`
        select entity, entity_id, after from audit_entries
        where entity = 'product' and entity_id = ${productId}
      `
      expect(audited).toHaveLength(1)
      expect(audited[0]?.after).toBe('Senior')

      const edited = await post(await suppliesHolder(), '/products/edit', {
        productId,
        prescription: true,
        reason: 'now requires one',
      })
      expect(edited.status).toBe(204)

      const listed = await get(await reader(), '/products')
      expect(listed.body.products).toContainEqual(
        expect.objectContaining({ name: 'Senior', prescription: true }),
      )
    })

    it('refuses a Product naming a Supplier that does not exist', async () => {
      const created = await post(await horseCareHolder(), '/products', {
        name: 'Prascend',
        kind: 'medication',
        supplierId: crypto.randomUUID(),
        prescription: true,
      })
      expect(created.status).toBe(404)
      expect(created.body.error).toBe('supplier_not_found')
    })

    it('refuses to create a Product without horse_care or supplies', async () => {
      const created = await post(await reader(), '/products', {
        name: 'Bute',
        kind: 'medication',
        prescription: true,
      })
      expect(created.status).toBe(403)
    })
  })

  describe('Feed Schedules', () => {
    it('publishes a version with lines, and it becomes the current schedule on the horse profile', async () => {
      const holder = await horseCareHolder()
      const horseId = await seedHorse(holder, 'Apollo')
      const senior = await seedProduct(holder, 'Senior', 'feed')

      const published = await post(holder, '/feed-schedules', {
        horseId,
        shiftType: 'feed_am',
        validFrom: '2024-01-01',
        lines: [{ productId: senior, amount: '2 scoops', route: 'in_feed' }],
      })
      expect(published.status).toBe(201)

      const profile = await get(holder, `/horses/${horseId}`)
      expect(profile.body.feedSchedules).toEqual([
        expect.objectContaining({
          shiftType: 'feed_am',
          validFrom: '2024-01-01',
          lines: [
            expect.objectContaining({
              productId: senior,
              productName: 'Senior',
              amount: '2 scoops',
            }),
          ],
        }),
      ])

      // No audit entry for a versioned-tier change — the version is the record.
      const audited = await owner`
        select * from audit_entries where entity = 'feed_schedule_version'
      `
      expect(audited).toHaveLength(0)
    })

    it('resolves the current version as the latest by valid-from, keeping prior versions out of the answer', async () => {
      const holder = await horseCareHolder()
      const horseId = await seedHorse(holder, 'Bramble')
      const senior = await seedProduct(holder, 'Senior')
      const rice = await seedProduct(holder, 'Rice Bran')

      await post(holder, '/feed-schedules', {
        horseId,
        shiftType: 'feed_am',
        validFrom: '2024-01-01',
        lines: [{ productId: senior, amount: '2 scoops', route: 'in_feed' }],
      })
      await post(holder, '/feed-schedules', {
        horseId,
        shiftType: 'feed_am',
        validFrom: '2024-03-01',
        lines: [{ productId: rice, amount: '1 scoop', route: 'in_feed' }],
      })

      const profile = await get(holder, `/horses/${horseId}`)
      const schedules = profile.body.feedSchedules as Record<string, unknown>[]
      expect(schedules).toHaveLength(1)
      expect(schedules[0]).toMatchObject({ validFrom: '2024-03-01' })
      const lines = schedules[0]?.lines as Record<string, unknown>[]
      expect(lines.map((line) => line.productName)).toEqual(['Rice Bran'])
    })

    it('carries a syringe medication visibly, not as an in-feed line', async () => {
      const holder = await horseCareHolder()
      const horseId = await seedHorse(holder, 'Comet')
      const bute = await seedProduct(holder, 'Bute', 'medication')

      await post(holder, '/feed-schedules', {
        horseId,
        shiftType: 'feed_pm',
        validFrom: '2024-01-01',
        lines: [{ productId: bute, amount: '1 dose', route: 'oral_syringe' }],
      })

      const profile = await get(holder, `/horses/${horseId}`)
      const schedules = profile.body.feedSchedules as Record<string, unknown>[]
      const lines = schedules[0]?.lines as Record<string, unknown>[]
      expect(lines[0]).toMatchObject({ route: 'oral_syringe', productKind: 'medication' })
    })

    it('exists for Lunch only for the horses that have one, absent for the horse that does not', async () => {
      const holder = await horseCareHolder()
      const dawson = await seedHorse(holder, 'Dawson')
      const finn = await seedHorse(holder, 'Finn')
      const senior = await seedProduct(holder, 'Senior')

      await post(holder, '/feed-schedules', {
        horseId: dawson,
        shiftType: 'lunch',
        validFrom: '2024-01-01',
        lines: [{ productId: senior, amount: '1 scoop', route: 'in_feed' }],
      })

      const dawsonProfile = await get(holder, `/horses/${dawson}`)
      expect((dawsonProfile.body.feedSchedules as unknown[]).length).toBe(1)

      const finnProfile = await get(holder, `/horses/${finn}`)
      expect(finnProfile.body.feedSchedules).toEqual([])
    })

    it('shows the New marker on a version published within the last 14 days, and not on an older one', async () => {
      const holder = await horseCareHolder()
      const horseId = await seedHorse(holder, 'Grady')
      const senior = await seedProduct(holder, 'Senior')

      const today = ((await get(holder, '/day')).body as { day: string }).day
      await post(holder, '/feed-schedules', {
        horseId,
        shiftType: 'feed_am',
        validFrom: today,
        lines: [{ productId: senior, amount: '2 scoops', route: 'in_feed' }],
      })
      await post(holder, '/feed-schedules', {
        horseId,
        shiftType: 'feed_pm',
        validFrom: '2000-01-01',
        lines: [{ productId: senior, amount: '2 scoops', route: 'in_feed' }],
      })

      const profile = await get(holder, `/horses/${horseId}`)
      const schedules = profile.body.feedSchedules as Record<string, unknown>[]
      expect(schedules.find((s) => s.shiftType === 'feed_am')).toMatchObject({ isNew: true })
      expect(schedules.find((s) => s.shiftType === 'feed_pm')).toMatchObject({ isNew: false })
    })

    it('retires a schedule as a version with no lines, rather than deleting one', async () => {
      const holder = await horseCareHolder()
      const horseId = await seedHorse(holder, 'Harriet')
      const senior = await seedProduct(holder, 'Senior')

      await post(holder, '/feed-schedules', {
        horseId,
        shiftType: 'lunch',
        validFrom: '2024-01-01',
        lines: [{ productId: senior, amount: '1 scoop', route: 'in_feed' }],
      })
      await post(holder, '/feed-schedules', {
        horseId,
        shiftType: 'lunch',
        validFrom: '2024-06-01',
        lines: [],
      })

      const profile = await get(holder, `/horses/${horseId}`)
      const schedules = profile.body.feedSchedules as Record<string, unknown>[]
      expect(schedules).toEqual([expect.objectContaining({ shiftType: 'lunch', lines: [] })])
    })

    it('refuses a Feed Schedule for a horse that does not exist', async () => {
      const holder = await horseCareHolder()
      const senior = await seedProduct(holder, 'Senior')
      const published = await post(holder, '/feed-schedules', {
        horseId: crypto.randomUUID(),
        shiftType: 'lunch',
        validFrom: '2024-01-01',
        lines: [{ productId: senior, amount: '1 scoop', route: 'in_feed' }],
      })
      expect(published.status).toBe(404)
      expect(published.body.error).toBe('horse_not_found')
    })

    it('refuses a Feed Schedule naming a Product that does not exist', async () => {
      const holder = await horseCareHolder()
      const horseId = await seedHorse(holder, 'Isla')
      const published = await post(holder, '/feed-schedules', {
        horseId,
        shiftType: 'lunch',
        validFrom: '2024-01-01',
        lines: [{ productId: crypto.randomUUID(), amount: '1 scoop', route: 'in_feed' }],
      })
      expect(published.status).toBe(404)
      expect(published.body.error).toBe('product_not_found')
    })

    it('refuses to publish a Feed Schedule without horse_care — supplies alone is not enough', async () => {
      const suppliesApi = await suppliesHolder()
      const holder = await horseCareHolder()
      const horseId = await seedHorse(holder, 'Juno')

      const published = await post(suppliesApi, '/feed-schedules', {
        horseId,
        shiftType: 'lunch',
        validFrom: '2024-01-01',
        lines: [],
      })
      expect(published.status).toBe(403)
    })
  })

  describe('Measurements', () => {
    it('appends a weight with a method, on the floor — any signed-in Volunteer', async () => {
      const holder = await horseCareHolder()
      const horseId = await seedHorse(holder, 'Kestrel')
      const volunteer = await reader()

      const recorded = await post(volunteer, '/measurements', {
        horseId,
        kind: 'weight',
        value: 950,
        method: 'tape',
        takenOn: '2024-01-01',
      })
      expect(recorded.status).toBe(201)

      const profile = await get(holder, `/horses/${horseId}`)
      expect(profile.body.measurements).toMatchObject({
        weights: [expect.objectContaining({ value: 950, method: 'tape', takenOn: '2024-01-01' })],
        bodyConditions: [],
      })
    })

    it('appends a body-condition entry with no method, and renders both as a series', async () => {
      const holder = await horseCareHolder()
      const horseId = await seedHorse(holder, 'Luna')
      const volunteer = await reader()

      await post(volunteer, '/measurements', {
        horseId,
        kind: 'weight',
        value: 900,
        takenOn: '2024-01-01',
      })
      await post(volunteer, '/measurements', {
        horseId,
        kind: 'weight',
        value: 923,
        takenOn: '2024-02-01',
      })
      await post(volunteer, '/measurements', {
        horseId,
        kind: 'body_condition',
        value: 5,
        takenOn: '2024-01-01',
      })

      const profile = await get(holder, `/horses/${horseId}`)
      const measurements = profile.body.measurements as {
        weights: Record<string, unknown>[]
        bodyConditions: Record<string, unknown>[]
      }
      expect(measurements.weights.map((entry) => entry.value)).toEqual([900, 923])
      expect(measurements.bodyConditions).toEqual([expect.objectContaining({ value: 5 })])
      expect(measurements.bodyConditions[0]).not.toHaveProperty('method')
    })

    it('refuses a measurement on a horse that does not exist', async () => {
      const recorded = await post(await reader(), '/measurements', {
        horseId: crypto.randomUUID(),
        kind: 'weight',
        value: 900,
        takenOn: '2024-01-01',
      })
      expect(recorded.status).toBe(404)
      expect(recorded.body.error).toBe('horse_not_found')
    })

    it('refuses a signed-out request, because a measurement must be attributed', async () => {
      const holder = await horseCareHolder()
      const horseId = await seedHorse(holder, 'Marnie')
      const anonymous = buildApi({ idempotency: postgresIdempotency() })

      const recorded = await post(anonymous, '/measurements', {
        horseId,
        kind: 'weight',
        value: 900,
        takenOn: '2024-01-01',
      })
      expect(recorded.status).toBe(401)
    })
  })

  describe('the tenancy guarantee', () => {
    it('has row-level security and a policy on every table this ticket added', async () => {
      const added = [
        'suppliers',
        'products',
        'feed_schedule_versions',
        'feed_schedule_lines',
        'horse_measurements',
      ]

      const rows = await owner`
        select c.relname as table, c.relrowsecurity as enabled, count(p.polname) as policies
        from pg_class c
        left join pg_policy p on p.polrelid = c.oid
        where c.relname in ${owner(added)}
        group by c.relname, c.relrowsecurity
      `

      expect(rows.map((row) => String(row.table)).sort()).toEqual([...added].sort())
      expect(
        Object.fromEntries(
          rows.map((row) => [
            String(row.table),
            { enabled: row.enabled, policies: Number(row.policies) },
          ]),
        ),
      ).toEqual(Object.fromEntries(added.map((table) => [table, { enabled: true, policies: 1 }])))
    })

    it('sees no Product of another organisation', async () => {
      const elsewhere = '00000000-0000-0000-0000-0000000000e8'
      await owner`delete from products where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
      await owner`
        insert into orgs (id, name, time_zone)
        values (${elsewhere}, 'Somebody Else', 'America/Chicago')
      `
      await owner`
        insert into products (id, org_id, name, kind, prescription)
        values (gen_random_uuid(), ${elsewhere}, 'Not Ours', 'feed', false)
      `

      const listed = await get(await horseCareHolder(), '/products')
      const names = (listed.body.products as Record<string, unknown>[]).map(
        (product) => product.name,
      )
      expect(names).not.toContain('Not Ours')

      await owner`delete from products where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
    })
  })
})
