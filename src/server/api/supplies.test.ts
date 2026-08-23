/**
 * Days-of-Supply readings and Reorders, through the API application's own
 * fetch entry — the same primary seam `src/server/api/products.test.ts` uses
 * for the catalogue this ticket forecasts against (ADR 0019, #47).
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`,
 * then `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { closeDb, type OrgId } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import { reorderList, shiftList, suppliesForecast } from '../../shared/api-contract'
import type { DomainScope } from '../../shared/domain-scopes'
import type { DayString } from '../../shared/time'
import { anonymousContext, currentOrgId } from '../request-context'
import { addDays, today, weekdayOf } from '../time'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FIELD_BARN = '00000000-0000-0000-0000-0000000000f7'
const TIME_ZONE = 'America/New_York'

describe.skipIf(!reachable)('Days-of-Supply and Reorders, through the API', () => {
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
    payload: Record<string, unknown> = {},
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
      values (${FIELD_BARN}, 'Field Barn Horse Rescue', ${TIME_ZONE})
    `
  })

  afterEach(async () => {
    await wipe({ keepOrg: true })
  })

  afterAll(async () => {
    await wipe()
    await owner.end()
    await closeDb()
  })

  async function wipe({ keepOrg = false }: { keepOrg?: boolean } = {}): Promise<void> {
    await owner`delete from reorder_comments where org_id = ${FIELD_BARN}`
    await owner`delete from reorders where org_id = ${FIELD_BARN}`
    await owner`delete from days_of_supply_readings where org_id = ${FIELD_BARN}`
    await owner`delete from escalation_comments where org_id = ${FIELD_BARN}`
    await owner`delete from escalations where org_id = ${FIELD_BARN}`
    await owner`delete from observations where org_id = ${FIELD_BARN}`
    await owner`delete from attendance where org_id = ${FIELD_BARN}`
    await owner`delete from audit_entries where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_lines where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_versions where org_id = ${FIELD_BARN}`
    await owner`delete from horses where org_id = ${FIELD_BARN}`
    await owner`delete from products where org_id = ${FIELD_BARN}`
    await owner`delete from suppliers where org_id = ${FIELD_BARN}`
    await owner`delete from shift_roster where org_id = ${FIELD_BARN}`
    await owner`delete from shifts where org_id = ${FIELD_BARN}`
    await owner`delete from shift_pattern_roster where org_id = ${FIELD_BARN}`
    await owner`delete from shift_patterns where org_id = ${FIELD_BARN}`
    await owner`delete from release_signatures where org_id = ${FIELD_BARN}`
    await owner`delete from release_versions where org_id = ${FIELD_BARN}`
    await owner`delete from volunteer_roles where org_id = ${FIELD_BARN}`
    await owner`delete from idempotency_keys where org_id = ${FIELD_BARN}`
    await owner`delete from volunteers where org_id = ${FIELD_BARN}`
    if (!keepOrg) await owner`delete from orgs where id = ${FIELD_BARN}`
  }

  function day(): DayString {
    return today(TIME_ZONE)
  }

  let versionId: string | null = null

  async function releaseVersion(): Promise<string> {
    if (versionId !== null) {
      const rows = await owner`
        select id from release_versions where id = ${versionId} and org_id = ${FIELD_BARN}
      `
      if (rows.length > 0) return versionId
    }
    const [row] = await owner`
      insert into release_versions (id, org_id, label, valid_from, obsoletes_prior, published_by)
      values (gen_random_uuid(), ${FIELD_BARN}, 'The 2026 text', '2020-01-01', false, null)
      returning id
    `
    versionId = String(row?.id)
    return versionId
  }

  async function volunteer(name: string): Promise<string> {
    const [row] = await owner`
      insert into volunteers (id, org_id, name, email, date_of_birth, oriented_on)
      values (gen_random_uuid(), ${FIELD_BARN}, ${name},
              ${`${name.toLowerCase().replace(/\s/g, '-')}-${newIdempotencyKey()}@barn.test`},
              '1980-05-04', ${day()})
      returning id
    `
    const volunteerId = String(row?.id)
    const releaseVersionId = await releaseVersion()
    await owner`
      insert into release_signatures
        (id, org_id, volunteer_id, release_version_id, signed_on, by_parent, recorded_by)
      values (gen_random_uuid(), ${FIELD_BARN}, ${volunteerId}, ${releaseVersionId}, ${day()}, false,
              ${volunteerId})
    `
    return volunteerId
  }

  function suppliesHolder(name = 'Barn Manager') {
    return volunteer(name).then((id) => ({ volunteerId: id, api: apiAs(id, ['supplies']) }))
  }

  function reader(name = 'Reader Volunteer') {
    return volunteer(name).then((id) => apiAs(id, []))
  }

  async function coordinator() {
    const id = await volunteer('Priya Chandra')
    return apiAs(id, ['roster'])
  }

  async function seedProduct(
    name: string,
    reorderPointDays: number | null = null,
  ): Promise<string> {
    const holder = await suppliesHolder()
    const created = await post(holder.api, '/products', {
      name,
      kind: 'feed',
      prescription: false,
      reorderPointDays,
    })
    expect(created.status).toBe(201)
    return created.body.productId as string
  }

  /** A Shift today, generated from a Pattern, with `who` rostered as `position`. */
  async function shiftWith(who: string, position = 'lead'): Promise<string> {
    const desk = await coordinator()
    const created = await post(desk, '/shift-patterns', {
      weekday: weekdayOf(day(), TIME_ZONE),
      shiftType: 'feed_am',
      startTime: '06:30',
      targetHeadcount: 3,
    })
    expect(created.status).toBe(201)
    await post(desk, '/shifts/generation')
    const listed = shiftList.parse((await get(desk, '/shifts')).body)
    const shiftId = listed.shifts.find((shift) => shift.day === day())?.id
    expect(shiftId).toBeDefined()
    await post(desk, '/shifts/roster', { shiftId, volunteerId: who, position })
    return shiftId ?? ''
  }

  describe('recording a Days-of-Supply reading', () => {
    it('appends for a supplies holder, with recorder and date', async () => {
      const productId = await seedProduct('Senior')
      const holder = await suppliesHolder()

      const written = await post(holder.api, '/supplies/readings', {
        productId,
        daysRemaining: 14.5,
        countedOn: day(),
      })
      expect(written.status).toBe(201)

      const listed = suppliesForecast.parse((await get(await reader(), '/supplies')).body)
      const row = listed.products.find((product) => product.productId === productId)
      expect(row?.latestReading).toMatchObject({
        daysRemaining: 14.5,
        countedOn: day(),
        recordedBy: holder.volunteerId,
      })
      expect(row?.projectedDaysRemaining).toBe(14.5)
    })

    it('appends for Shift Authority over the Shift named, with no supplies scope', async () => {
      const productId = await seedProduct('Senior')
      const lead = await volunteer('Kate')
      const shiftId = await shiftWith(lead, 'lead')

      const written = await post(apiAs(lead, []), '/supplies/readings', {
        productId,
        daysRemaining: 10,
        countedOn: day(),
        shiftId,
      })
      expect(written.status).toBe(201)
    })

    it('refuses a Volunteer with neither supplies nor Shift Authority', async () => {
      const productId = await seedProduct('Senior')
      const refused = await post(await reader(), '/supplies/readings', {
        productId,
        daysRemaining: 10,
        countedOn: day(),
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('not_authorized_to_record_reading')
    })

    it('refuses a Volunteer rostered on the named Shift but not carrying its Authority', async () => {
      const productId = await seedProduct('Senior')
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth, 'volunteer')

      const refused = await post(apiAs(beth, []), '/supplies/readings', {
        productId,
        daysRemaining: 10,
        countedOn: day(),
        shiftId,
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('not_authorized_to_record_reading')
    })

    it('refuses a reading against a Product that does not exist', async () => {
      const holder = await suppliesHolder()
      const refused = await post(holder.api, '/supplies/readings', {
        productId: crypto.randomUUID(),
        daysRemaining: 10,
        countedOn: day(),
      })
      expect(refused.status).toBe(404)
      expect(refused.body.error).toBe('product_not_found')
    })
  })

  describe('a Retired Product', () => {
    async function retired(name: string): Promise<{ productId: string; holder: string }> {
      const productId = await seedProduct(name)
      const holder = await suppliesHolder()
      const gone = await post(holder.api, '/products/retirement', {
        productId,
        retiredOn: day(),
      })
      expect(gone.status).toBe(204)
      return { productId, holder: holder.volunteerId }
    }

    it('takes no new reading', async () => {
      const { productId } = await retired('Retired Senior')
      const holder = await suppliesHolder()

      const refused = await post(holder.api, '/supplies/readings', {
        productId,
        daysRemaining: 10,
        countedOn: day(),
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('product_retired')
    })

    it('opens no new Reorder', async () => {
      const { productId } = await retired('Retired Rice Bran')
      const holder = await suppliesHolder()

      const refused = await post(holder.api, '/reorders', { productId })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('product_retired')
    })

    it('lets a Reorder opened before the Retirement be threaded and closed', async () => {
      const productId = await seedProduct('Ordered Senior')
      const holder = await suppliesHolder()
      const opened = await post(holder.api, '/reorders', { productId })
      expect(opened.status).toBe(201)
      const reorderId = opened.body.reorderId as string

      await post(holder.api, '/products/retirement', { productId, retiredOn: day() })

      const threaded = await post(holder.api, '/reorders/comments', {
        reorderId,
        text: 'Chased. Arrives Friday.',
      })
      expect(threaded.status).toBe(201)

      const closed = await post(holder.api, '/reorders/close', {
        reorderId,
        note: 'Arrived. Last sack we will buy.',
      })
      expect(closed.status).toBe(204)
    })

    it('leaves the forecast, keeping the readings it already carries', async () => {
      const productId = await seedProduct('Counted Senior')
      const holder = await suppliesHolder()
      await post(holder.api, '/supplies/readings', {
        productId,
        daysRemaining: 4,
        countedOn: day(),
      })
      await post(holder.api, '/products/retirement', { productId, retiredOn: day() })

      const listed = suppliesForecast.parse((await get(await reader(), '/supplies')).body)
      expect(listed.products.find((product) => product.productId === productId)).toBeUndefined()

      const kept = await owner`
        select days_remaining from days_of_supply_readings where product_id = ${productId}
      `
      expect(kept).toHaveLength(1)
    })
  })

  describe("today's derived figure", () => {
    it('decrements the last reading by the days elapsed, floored at zero', async () => {
      const productId = await seedProduct('Senior')
      const holder = await suppliesHolder()
      const fiveDaysAgo = addDays(day(), -5, TIME_ZONE)

      await post(holder.api, '/supplies/readings', {
        productId,
        daysRemaining: 14.5,
        countedOn: fiveDaysAgo,
      })

      const listed = suppliesForecast.parse((await get(await reader(), '/supplies')).body)
      const row = listed.products.find((product) => product.productId === productId)
      expect(row?.projectedDaysRemaining).toBe(9.5)
      expect(row?.latestReading?.countedOn).toBe(fiveDaysAgo)
    })

    it('floors at zero rather than answering a negative figure', async () => {
      const productId = await seedProduct('Senior')
      const holder = await suppliesHolder()
      const wayBack = addDays(day(), -30, TIME_ZONE)

      await post(holder.api, '/supplies/readings', {
        productId,
        daysRemaining: 5,
        countedOn: wayBack,
      })

      const listed = suppliesForecast.parse((await get(await reader(), '/supplies')).body)
      const row = listed.products.find((product) => product.productId === productId)
      expect(row?.projectedDaysRemaining).toBe(0)
    })

    it('answers null, never zero, for a Product nobody has ever counted', async () => {
      const productId = await seedProduct('Rice Bran')
      const listed = suppliesForecast.parse((await get(await reader(), '/supplies')).body)
      const row = listed.products.find((product) => product.productId === productId)
      expect(row?.latestReading).toBeNull()
      expect(row?.projectedDaysRemaining).toBeNull()
      expect(row?.atOrBelowReorderPoint).toBe(false)
    })

    it('surfaces atOrBelowReorderPoint as a fact once the projection crosses it', async () => {
      const productId = await seedProduct('Senior', 7)
      const holder = await suppliesHolder()
      const sixDaysAgo = addDays(day(), -6, TIME_ZONE)

      await post(holder.api, '/supplies/readings', {
        productId,
        daysRemaining: 10,
        countedOn: sixDaysAgo,
      })

      const listed = suppliesForecast.parse((await get(await reader(), '/supplies')).body)
      const row = listed.products.find((product) => product.productId === productId)
      expect(row?.projectedDaysRemaining).toBe(4)
      expect(row?.atOrBelowReorderPoint).toBe(true)
    })

    it('never derives a figure from a Feed Schedule — the read carries no such join', async () => {
      // Structural: `/supplies` answers only what `days_of_supply_readings`
      // holds. A Product fed on a schedule but never counted still answers
      // `latestReading: null`, which the "nobody has ever counted" case above
      // already asserts; this is the same fact stated from the Feed Schedule
      // side, for a Product actually on one.
      const holder = await suppliesHolder()
      const horseId = (
        await post(apiAs(holder.volunteerId, ['horse_care', 'supplies']), '/horses', {
          name: 'Apollo',
        })
      ).body.horseId as string
      const productId = await seedProduct('Senior')
      await post(apiAs(holder.volunteerId, ['horse_care', 'supplies']), '/feed-schedules', {
        horseId,
        shiftType: 'feed_am',
        validFrom: day(),
        lines: [{ productId, amount: '2 wells', route: 'in_feed' }],
      })

      const listed = suppliesForecast.parse((await get(await reader(), '/supplies')).body)
      const row = listed.products.find((product) => product.productId === productId)
      expect(row?.latestReading).toBeNull()
      expect(row?.projectedDaysRemaining).toBeNull()
    })
  })

  describe('Reorders', () => {
    it('opens against one Product, under supplies, carrying no quantity and no horse', async () => {
      const productId = await seedProduct('Senior')
      const holder = await suppliesHolder()

      const opened = await post(holder.api, '/reorders', { productId })
      expect(opened.status).toBe(201)
      const reorderId = opened.body.reorderId as string

      const listed = reorderList.parse((await get(await reader(), '/reorders')).body)
      const row = listed.reorders.find((reorder) => reorder.id === reorderId)
      expect(row).toMatchObject({
        productId,
        openedBy: holder.volunteerId,
        closedAt: null,
        escalationId: null,
      })
    })

    it('refuses to open without supplies', async () => {
      const productId = await seedProduct('Senior')
      const refused = await post(await reader(), '/reorders', { productId })
      expect(refused.status).toBe(403)
    })

    it('threads a comment, under supplies alone — never floor-writable', async () => {
      const productId = await seedProduct('Senior')
      const holder = await suppliesHolder()
      const opened = await post(holder.api, '/reorders', { productId })
      const reorderId = opened.body.reorderId as string

      const commented = await post(holder.api, '/reorders/comments', {
        reorderId,
        text: 'Ordered from Allivet, arriving Thursday.',
      })
      expect(commented.status).toBe(201)

      const refused = await post(await reader(), '/reorders/comments', {
        reorderId,
        text: 'I saw the truck.',
      })
      expect(refused.status).toBe(403)

      const listed = reorderList.parse((await get(await reader(), '/reorders')).body)
      const row = listed.reorders.find((reorder) => reorder.id === reorderId)
      expect(row?.comments).toHaveLength(1)
      expect(row?.comments[0]).toMatchObject({ text: 'Ordered from Allivet, arriving Thursday.' })
    })

    it('closes with a note by a supplies holder, and there is no reopen', async () => {
      const productId = await seedProduct('Senior')
      const holder = await suppliesHolder()
      const opened = await post(holder.api, '/reorders', { productId })
      const reorderId = opened.body.reorderId as string

      const closed = await post(holder.api, '/reorders/close', {
        reorderId,
        note: 'Arrived Thursday, put away.',
      })
      expect(closed.status).toBe(204)

      const listed = reorderList.parse((await get(await reader(), '/reorders')).body)
      const row = listed.reorders.find((reorder) => reorder.id === reorderId)
      expect(row).toMatchObject({
        closedBy: holder.volunteerId,
        closingNote: 'Arrived Thursday, put away.',
      })

      const reclosed = await post(holder.api, '/reorders/close', { reorderId, note: 'Again' })
      expect(reclosed.status).toBe(409)
      expect(reclosed.body.error).toBe('already_closed')
    })

    it('refuses closing without a note', async () => {
      const productId = await seedProduct('Senior')
      const holder = await suppliesHolder()
      const opened = await post(holder.api, '/reorders', { productId })
      const reorderId = opened.body.reorderId as string

      // Whitespace, not empty — an empty string fails the contract's own
      // `min(1)` before ever reaching this domain-level trim check.
      const closed = await post(holder.api, '/reorders/close', { reorderId, note: '   ' })
      expect(closed.status).toBe(409)
      expect(closed.body.error).toBe('note_required')
    })

    it('links back to the Escalation it was created from, sharing no state with it', async () => {
      const productId = await seedProduct('Senior')
      const holder = await suppliesHolder()
      const beth = await volunteer('Beth Ann')
      // Shift Authority, so escalating needs no `supplies` grant of her own —
      // the same requirement `escalateObservation` checks.
      const shiftId = await shiftWith(beth, 'lead')
      await post(apiAs(beth, []), '/attendance/sign-in', { volunteerId: beth, shiftId })
      const observed = await post(apiAs(beth, []), '/observations', {
        shiftId,
        text: 'Down to the last bag of Senior',
      })
      const escalated = await post(apiAs(beth, []), '/escalations', {
        observationId: observed.body.observationId,
        scope: 'supplies',
        framing: 'Down to the last bag',
      })
      expect(escalated.status).toBe(201)
      const escalationId = escalated.body.escalationId as string

      const opened = await post(holder.api, '/reorders', { productId, escalationId })
      expect(opened.status).toBe(201)
      const reorderId = opened.body.reorderId as string

      const closedReorder = await post(holder.api, '/reorders/close', {
        reorderId,
        note: 'Arrived.',
      })
      expect(closedReorder.status).toBe(204)

      // Closing the Reorder never touches the Escalation it was created from.
      const stillOpenEscalation = await owner`
        select closed_at from escalations where id = ${escalationId}
      `
      expect(stillOpenEscalation[0]?.closed_at).toBeNull()

      const listed = reorderList.parse((await get(await reader(), '/reorders')).body)
      const row = listed.reorders.find((reorder) => reorder.id === reorderId)
      expect(row?.escalationId).toBe(escalationId)
    })

    it('refuses a Reorder naming an Escalation that does not exist', async () => {
      const productId = await seedProduct('Senior')
      const holder = await suppliesHolder()
      const refused = await post(holder.api, '/reorders', {
        productId,
        escalationId: crypto.randomUUID(),
      })
      expect(refused.status).toBe(404)
      expect(refused.body.error).toBe('escalation_not_found')
    })
  })

  describe('the tenancy guarantee', () => {
    it('has row-level security and a policy on every table this ticket added', async () => {
      const added = ['days_of_supply_readings', 'reorders', 'reorder_comments']

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

    it('sees no Reorder of another organisation', async () => {
      const productId = await seedProduct('Senior')
      const holder = await suppliesHolder()
      const opened = await post(holder.api, '/reorders', { productId })
      const reorderId = opened.body.reorderId as string

      const elsewhere = '00000000-0000-0000-0000-0000000000f8'
      await owner`delete from reorders where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
      await owner`
        insert into orgs (id, name, time_zone)
        values (${elsewhere}, 'Somebody Else', 'America/Chicago')
      `
      const [otherProduct] = await owner`
        insert into products (id, org_id, name, kind, prescription)
        values (gen_random_uuid(), ${elsewhere}, 'Not Ours', 'feed', false)
        returning id
      `
      await owner`
        insert into reorders (id, org_id, product_id, opened_by)
        values (gen_random_uuid(), ${elsewhere}, ${otherProduct?.id}, ${holder.volunteerId})
      `

      const listed = reorderList.parse((await get(await reader(), '/reorders')).body)
      expect(listed.reorders.map((reorder) => reorder.id)).toContain(reorderId)
      expect(listed.reorders.map((reorder) => reorder.productId)).not.toContain(otherProduct?.id)

      await owner`delete from reorders where org_id = ${elsewhere}`
      await owner`delete from products where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
    })
  })
})
