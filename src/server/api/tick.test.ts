/**
 * Ticking an Item Done, through the API application's own fetch entry (#32's
 * testing decisions, #42): the round trip against real Postgres that a queue
 * test at the typed-client seam cannot stand in for — the roster join, the
 * Medication Authority gate, credit to the actor, and the tenancy guarantee
 * on the new table (ADR 0005, ADR 0013).
 *
 * Skipped, loudly, on a machine with no database — see `shifts.test.ts`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { closeDb, type OrgId } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import { shiftChecklist, shiftList } from '../../shared/api-contract'
import type { DomainScope } from '../../shared/domain-scopes'
import type { DayString } from '../../shared/time'
import { anonymousContext, currentOrgId } from '../request-context'
import { today, weekdayOf } from '../time'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FIELD_BARN = '00000000-0000-0000-0000-0000000000c1'
const TIME_ZONE = 'America/New_York'

describe.skipIf(!reachable)('Ticking an Item, through the API', () => {
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
    idempotencyKey?: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await api.fetch(
      new Request(url(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, idempotencyKey: idempotencyKey ?? newIdempotencyKey() }),
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
    await owner`delete from item_outcomes where org_id = ${FIELD_BARN}`
    await owner`delete from items where org_id = ${FIELD_BARN}`
    await owner`delete from task_assignments where org_id = ${FIELD_BARN}`
    await owner`delete from tasks where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_lines where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_versions where org_id = ${FIELD_BARN}`
    await owner`delete from products where org_id = ${FIELD_BARN}`
    await owner`delete from medication_authority where org_id = ${FIELD_BARN}`
    await owner`delete from audit_entries where org_id = ${FIELD_BARN}`
    await owner`delete from shift_roster where org_id = ${FIELD_BARN}`
    await owner`delete from shifts where org_id = ${FIELD_BARN}`
    await owner`delete from shift_pattern_roster where org_id = ${FIELD_BARN}`
    await owner`delete from shift_patterns where org_id = ${FIELD_BARN}`
    await owner`delete from horses where org_id = ${FIELD_BARN}`
    await owner`delete from release_signatures where org_id = ${FIELD_BARN}`
    await owner`delete from release_versions where org_id = ${FIELD_BARN}`
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

  /** Fully rosterable — the gates #34 stands at both doors this file uses. */
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

  async function coordinator() {
    const id = await volunteer('Coordinator Cate')
    return apiAs(id, ['roster'])
  }

  async function horseCareHolder() {
    const id = await volunteer('Priya Chandra')
    return apiAs(id, ['horse_care'])
  }

  /** A Shift today, generated from a Pattern, with nobody rostered on it yet. */
  async function todaysShift(): Promise<string> {
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
    return shiftId ?? ''
  }

  async function rosterOnto(shiftId: string, volunteerId: string): Promise<void> {
    const desk = await coordinator()
    const placed = await post(desk, '/shifts/roster', {
      shiftId,
      volunteerId,
      position: 'volunteer',
    })
    expect(placed.status).toBe(201)
  }

  /** One rescue-wide Task, so an Item exists to tick without a Feed Schedule's Products in play. */
  async function sweepTask(): Promise<string> {
    const desk = await horseCareHolder()
    const created = await post(desk, '/tasks', {
      subjectKind: 'rescue',
      priority: 'essential',
      period: 'day',
      requiresMedicationAuthority: false,
      closing: false,
      instructionText: 'Sweep the barn.',
    })
    return created.body.taskId as string
  }

  async function materialize(): Promise<void> {
    const desk = await horseCareHolder()
    const materialized = await post(desk, '/items/materialization')
    expect(materialized.status).toBe(200)
  }

  async function sweepItemId(shiftId: string): Promise<string> {
    const checklist = shiftChecklist.parse(
      (await get(await coordinator(), `/shifts/${shiftId}`)).body,
    )
    const item = checklist.items.find((each) => each.subjectKind === 'rescue')
    if (item === undefined) throw new Error('The rescue-wide sweep Item did not materialize.')
    return item.id
  }

  it('ticks an Item Done, credited to the actor who ticked it', async () => {
    const shiftId = await todaysShift()
    await sweepTask()
    await materialize()
    const beth = await volunteer('Beth Ann')
    await rosterOnto(shiftId, beth)
    const itemId = await sweepItemId(shiftId)

    const ticked = await post(apiAs(beth, []), '/items/done', { shiftId, itemId })
    expect(ticked.status).toBe(201)
    expect(typeof ticked.body.itemOutcomeId).toBe('string')

    const checklist = shiftChecklist.parse(
      (await get(await coordinator(), `/shifts/${shiftId}`)).body,
    )
    const item = checklist.items.find((each) => each.id === itemId)
    expect(item).toMatchObject({ done: true, doneByName: 'Beth Ann' })
    expect(item?.doneAt).not.toBeNull()
  })

  it('records exactly one outcome for a repeated key, and lets a second real tap append a second claim', async () => {
    const shiftId = await todaysShift()
    await sweepTask()
    await materialize()
    const beth = await volunteer('Beth Ann')
    await rosterOnto(shiftId, beth)
    const itemId = await sweepItemId(shiftId)
    const api = apiAs(beth, [])
    const key = newIdempotencyKey()

    const first = await post(api, '/items/done', { shiftId, itemId }, key)
    const replayed = await post(api, '/items/done', { shiftId, itemId }, key)
    expect(first.status).toBe(201)
    expect(replayed.status).toBe(201)
    expect(replayed.body.itemOutcomeId).toBe(first.body.itemOutcomeId)

    const counted = await owner`
      select count(*)::int as count from item_outcomes where item_id = ${itemId}
    `
    expect(counted[0]?.count).toBe(1)

    // A second real tap — its own key — appends rather than being blocked:
    // ADR 0013 gives ticking no authorship axis to police re-ticking with.
    const second = await post(api, '/items/done', { shiftId, itemId })
    expect(second.status).toBe(201)
    expect(second.body.itemOutcomeId).not.toBe(first.body.itemOutcomeId)
  })

  it('refuses a Volunteer who is not rostered on the Shift named', async () => {
    const shiftId = await todaysShift()
    await sweepTask()
    await materialize()
    const itemId = await sweepItemId(shiftId)
    const stranger = await volunteer('Stranger Sam')

    const refused = await post(apiAs(stranger, []), '/items/done', { shiftId, itemId })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe('not_rostered')
  })

  it('refuses a Medicate Item to a Volunteer with no Medication Authority, and takes a holder’s tick', async () => {
    const shiftId = await todaysShift()
    const desk = await horseCareHolder()
    const horseId = (await post(desk, '/horses', { name: 'Dawson' })).body.horseId as string
    const bute = (
      await post(desk, '/products', { name: 'Bute', kind: 'medication', prescription: false })
    ).body.productId as string
    await post(desk, '/feed-schedules', {
      horseId,
      shiftType: 'feed_am',
      validFrom: '2020-01-01',
      lines: [{ productId: bute, amount: '1 g', route: 'oral_syringe' }],
    })
    await materialize()

    const checklist = shiftChecklist.parse((await get(desk, `/shifts/${shiftId}`)).body)
    const medicateItem = checklist.items.find((each) => each.kind === 'medicate')
    if (medicateItem === undefined) throw new Error('The Medicate Item did not materialize.')

    const unqualified = await volunteer('Unqualified Uma')
    await rosterOnto(shiftId, unqualified)
    const refused = await post(apiAs(unqualified, []), '/items/done', {
      shiftId,
      itemId: medicateItem.id,
    })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe('medication_authority_required')

    const qualified = await volunteer('Qualified Quinn')
    await rosterOnto(shiftId, qualified)
    // Medication Authority is `horse_care`'s to grant (ADR 0010).
    const grantor = await horseCareHolder()
    const granted = await post(grantor, '/volunteers/medication-authority', {
      volunteerId: qualified,
      granted: true,
    })
    expect(granted.status).toBe(204)

    const ticked = await post(apiAs(qualified, []), '/items/done', {
      shiftId,
      itemId: medicateItem.id,
    })
    expect(ticked.status).toBe(201)
  })

  it('lets a per-Day Item be ticked from either Shift that shares its day', async () => {
    const morning = await todaysShift()

    const desk = await coordinator()
    const afternoon = await post(desk, '/shift-patterns', {
      weekday: weekdayOf(day(), TIME_ZONE),
      shiftType: 'feed_pm',
      startTime: '17:00',
      targetHeadcount: 2,
    })
    expect(afternoon.status).toBe(201)
    await post(desk, '/shifts/generation')
    const listed = shiftList.parse((await get(desk, '/shifts')).body)
    const eveningId = listed.shifts.find(
      (shift) => shift.day === day() && shift.shiftType === 'feed_pm',
    )?.id
    if (eveningId === undefined) throw new Error('The PM Shift did not generate.')

    await sweepTask()
    await materialize()

    const beth = await volunteer('Beth Ann')
    // Rostered on the evening Shift only — the sweep Item belongs to the day.
    await rosterOnto(eveningId, beth)
    const itemId = await sweepItemId(morning)

    const ticked = await post(apiAs(beth, []), '/items/done', { shiftId: eveningId, itemId })
    expect(ticked.status).toBe(201)
  })

  it('refuses an Item that belongs to a different Shift entirely', async () => {
    const shiftId = await todaysShift()
    const stray = crypto.randomUUID()

    const refused = await post(apiAs(await volunteer('Beth Ann'), []), '/items/done', {
      shiftId,
      itemId: stray,
    })
    expect(refused.status).toBe(404)
    expect(refused.body.error).toBe('item_not_found')
  })

  describe('the tenancy guarantee', () => {
    it('has row-level security and a policy on item_outcomes', async () => {
      const rows = await owner`
        select c.relname as table, c.relrowsecurity as enabled, count(p.polname) as policies
        from pg_class c
        left join pg_policy p on p.polrelid = c.oid
        where c.relname = 'item_outcomes'
        group by c.relname, c.relrowsecurity
      `

      expect(rows).toHaveLength(1)
      expect(rows[0]?.enabled).toBe(true)
      expect(Number(rows[0]?.policies)).toBe(1)
    })

    it('sees no claim from another organisation', async () => {
      const shiftId = await todaysShift()
      await sweepTask()
      await materialize()
      const itemId = await sweepItemId(shiftId)

      const elsewhere = '00000000-0000-0000-0000-0000000000c2'
      await owner`delete from item_outcomes where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
      await owner`
        insert into orgs (id, name, time_zone)
        values (${elsewhere}, 'Somebody Else', 'America/Chicago')
      `
      await owner`
        insert into item_outcomes (id, org_id, item_id, shift_id, outcome, claimed_by)
        select gen_random_uuid(), ${elsewhere}, ${itemId}, ${shiftId}, 'done', id
        from volunteers where org_id = ${FIELD_BARN} limit 1
      `

      const checklist = shiftChecklist.parse(
        (await get(await coordinator(), `/shifts/${shiftId}`)).body,
      )
      const item = checklist.items.find((each) => each.id === itemId)
      expect(item?.done).toBe(false)

      await owner`delete from item_outcomes where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
    })
  })
})
