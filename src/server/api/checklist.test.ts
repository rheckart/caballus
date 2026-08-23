/**
 * Tasks, Task Assignments and Item materialization, through the API
 * application's own fetch entry — the same primary seam the rest of the
 * domain uses (#32's testing decisions, #41).
 *
 * What only a real request can settle is here: that materializing today
 * writes real Items, that a Feed Schedule splits into Feed and Medicate
 * Items across the wire, that Task Assignment's tri-state reads as three
 * states rather than two on `/task-assignments`, and — the claim the ticket
 * names — that **materializing twice creates nothing twice**. The pure
 * arithmetic of what materializes is not retested here:
 * `src/shared/materialization.test.ts` is the exhaustive table.
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`,
 * then `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, type OrgId } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import { shiftChecklist, shiftList, taskAssignmentList, taskList } from '../../shared/api-contract'
import type { DomainScope } from '../../shared/domain-scopes'
import type { DayString } from '../../shared/time'
import { anonymousContext, currentOrgId } from '../request-context'
import { today, weekdayOf } from '../time'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FIELD_BARN = '00000000-0000-0000-0000-0000000000ee'
const TIME_ZONE = 'America/New_York'

describe.skipIf(!reachable)('Tasks, Task Assignments and Items, through the API', () => {
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

  beforeEach(() => {
    orgId()
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
    await owner`delete from audit_entries where org_id = ${FIELD_BARN}`
    await owner`delete from items where org_id = ${FIELD_BARN}`
    await owner`delete from task_assignments where org_id = ${FIELD_BARN}`
    await owner`delete from tasks where org_id = ${FIELD_BARN}`
    await owner`delete from weather_condition_resolutions where org_id = ${FIELD_BARN}`
    await owner`delete from weather_reading_hours where org_id = ${FIELD_BARN}`
    await owner`delete from weather_readings where org_id = ${FIELD_BARN}`
    await owner`delete from threshold_versions where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_lines where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_versions where org_id = ${FIELD_BARN}`
    await owner`delete from products where org_id = ${FIELD_BARN}`
    await owner`delete from shift_roster where org_id = ${FIELD_BARN}`
    await owner`delete from shifts where org_id = ${FIELD_BARN}`
    await owner`delete from shift_pattern_roster where org_id = ${FIELD_BARN}`
    await owner`delete from shift_patterns where org_id = ${FIELD_BARN}`
    await owner`delete from horse_space_assignments where org_id = ${FIELD_BARN}`
    await owner`delete from horses where org_id = ${FIELD_BARN}`
    await owner`delete from spaces where org_id = ${FIELD_BARN}`
    await owner`delete from idempotency_keys where org_id = ${FIELD_BARN}`
    await owner`delete from volunteers where org_id = ${FIELD_BARN}`
    if (!keepOrg) await owner`delete from orgs where id = ${FIELD_BARN}`
  }

  function day(): DayString {
    return today(TIME_ZONE)
  }

  async function seedVolunteer(name: string): Promise<string> {
    const [row] = await owner`
      insert into volunteers (id, org_id, name, email)
      values (gen_random_uuid(), ${FIELD_BARN}, ${name}, ${`${name}-${newIdempotencyKey()}@barn.test`})
      returning id
    `
    return String(row?.id)
  }

  /** Whoever edits the catalogue: every write here is behind `horse_care`. */
  async function holder() {
    const id = await seedVolunteer('Priya Chandra')
    return apiAs(id, ['horse_care'])
  }

  async function reader() {
    const id = await seedVolunteer('Reader Volunteer')
    return apiAs(id, [])
  }

  async function seedHorse(api: ReturnType<typeof apiAs>, name: string): Promise<string> {
    const created = await post(api, '/horses', { name })
    return created.body.horseId as string
  }

  async function seedSpace(api: ReturnType<typeof apiAs>, name: string): Promise<string> {
    const created = await post(api, '/spaces', { kind: 'pasture', name })
    return created.body.spaceId as string
  }

  async function seedProduct(
    api: ReturnType<typeof apiAs>,
    name: string,
    kind: 'feed' | 'medication',
  ): Promise<string> {
    const created = await post(api, '/products', { name, kind, prescription: false })
    return created.body.productId as string
  }

  /** A Shift on today, generated from a Pattern whose weekday is today's — materialization's whole subject. */
  async function todaysShift(): Promise<string> {
    const roster = apiAs(await seedVolunteer('The Coordinator'), ['roster'])
    const created = await post(roster, '/shift-patterns', {
      weekday: weekdayOf(day(), TIME_ZONE),
      shiftType: 'feed_am',
      startTime: '06:30',
      targetHeadcount: 3,
    })
    expect(created.status).toBe(201)
    const generated = await post(roster, '/shifts/generation')
    expect(generated.status).toBe(201)

    const listed = shiftList.parse((await get(roster, '/shifts')).body)
    const shift = listed.shifts.find((each) => each.day === day())
    if (shift === undefined) throw new Error('Generation did not make today’s Shift.')
    return shift.id
  }

  describe('Tasks', () => {
    it('creates a Task with exactly the fields the rescue may choose among', async () => {
      const created = await post(await holder(), '/tasks', {
        subjectKind: 'space',
        priority: 'essential',
        period: 'day',
        requiresMedicationAuthority: false,
        closing: false,
        instructionText: 'Muck the stalls.',
      })
      expect(created.status).toBe(201)

      const listed = taskList.parse((await get(await reader(), '/tasks')).body)
      expect(listed.tasks).toEqual([
        expect.objectContaining({ subjectKind: 'space', period: 'day', priority: 'essential' }),
      ])
    })

    it('refuses to create a Task without horse_care', async () => {
      const created = await post(await reader(), '/tasks', {
        subjectKind: 'rescue',
        priority: 'discretionary',
        period: 'day',
        requiresMedicationAuthority: false,
        closing: false,
        instructionText: 'Sweep the barn.',
      })
      expect(created.status).toBe(403)
    })
  })

  describe('Task Assignments', () => {
    async function muckTask(api: ReturnType<typeof apiAs>): Promise<string> {
      const created = await post(api, '/tasks', {
        subjectKind: 'space',
        priority: 'essential',
        period: 'day',
        requiresMedicationAuthority: false,
        closing: false,
        instructionText: 'Muck the stalls.',
      })
      return created.body.taskId as string
    }

    it('publishes an assignment naming a Shift Type', async () => {
      const desk = await holder()
      const taskId = await muckTask(desk)
      const fieldC = await seedSpace(desk, 'Field C')

      const published = await post(desk, '/task-assignments', {
        taskId,
        horseId: null,
        spaceId: fieldC,
        stance: 'assigned',
        shiftType: 'feed_am',
        validFrom: day(),
      })
      expect(published.status).toBe(201)

      const listed = taskAssignmentList.parse((await get(await reader(), '/task-assignments')).body)
      const forTask = listed.tasks.find((each) => each.taskId === taskId)
      expect(forTask?.assignments).toEqual([
        expect.objectContaining({ spaceId: fieldC, stance: 'assigned', shiftType: 'feed_am' }),
      ])
      expect(forTask?.undecided).toEqual([])
    })

    it('renders a Subject nobody has decided for as an unanswered question, not as no work', async () => {
      const desk = await holder()
      const taskId = await muckTask(desk)
      await seedSpace(desk, 'Field D')

      const listed = taskAssignmentList.parse((await get(await reader(), '/task-assignments')).body)
      const forTask = listed.tasks.find((each) => each.taskId === taskId)
      expect(forTask?.assignments).toEqual([])
      expect(forTask?.undecided).toEqual([expect.objectContaining({ name: 'Field D' })])
    })

    it('refuses a Subject that does not match the Task’s subject kind', async () => {
      const desk = await holder()
      const taskId = await muckTask(desk)
      const horseId = await seedHorse(desk, 'Apollo')

      const refused = await post(desk, '/task-assignments', {
        taskId,
        horseId,
        spaceId: null,
        stance: 'assigned',
        shiftType: 'feed_am',
        validFrom: day(),
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('subject_kind_mismatch')
    })
  })

  describe('Materialization', () => {
    it('splits a Feed Schedule into Feed and Medicate Items, and Medicate needs Medication Authority', async () => {
      const desk = await holder()
      const shiftId = await todaysShift()
      const horseId = await seedHorse(desk, 'Dawson')
      const grain = await seedProduct(desk, 'Senior', 'feed')
      const bute = await seedProduct(desk, 'Bute', 'medication')

      await post(desk, '/feed-schedules', {
        horseId,
        shiftType: 'feed_am',
        validFrom: '2020-01-01',
        lines: [
          { productId: grain, amount: '2 scoops', route: 'in_feed' },
          { productId: bute, amount: '1 g', route: 'oral_syringe' },
        ],
      })

      const materialized = await post(desk, '/items/materialization')
      expect(materialized.status).toBe(200)
      expect(materialized.body.created).toBeGreaterThanOrEqual(2)
      expect(materialized.body.day).toBe(day())

      const checklist = shiftChecklist.parse((await get(desk, `/shifts/${shiftId}`)).body)
      expect(checklist.materialized).toBe(true)
      expect(checklist.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'feed',
            horseId,
            horseName: 'Dawson',
            requiresMedicationAuthority: false,
          }),
          expect.objectContaining({
            kind: 'medicate',
            horseId,
            horseName: 'Dawson',
            requiresMedicationAuthority: true,
          }),
        ]),
      )
    })

    it('creates nothing twice on a second run', async () => {
      const desk = await holder()
      const shiftId = await todaysShift()
      const horseId = await seedHorse(desk, 'Apollo')
      const grain = await seedProduct(desk, 'Senior', 'feed')
      await post(desk, '/feed-schedules', {
        horseId,
        shiftType: 'feed_am',
        validFrom: '2020-01-01',
        lines: [{ productId: grain, amount: '2 scoops', route: 'in_feed' }],
      })

      const first = await post(desk, '/items/materialization')
      expect(first.status).toBe(200)
      expect(Number(first.body.created)).toBeGreaterThan(0)

      const second = await post(desk, '/items/materialization')
      expect(second.status).toBe(200)
      expect(second.body.created).toBe(0)

      const checklist = shiftChecklist.parse((await get(desk, `/shifts/${shiftId}`)).body)
      const feedItems = checklist.items.filter(
        (item) => item.kind === 'feed' && item.horseId === horseId,
      )
      expect(feedItems).toHaveLength(1)
    })

    it('shows a Shift whose day nothing has materialized yet as honestly unmaterialized', async () => {
      const desk = await holder()
      const shiftId = await todaysShift()

      const checklist = shiftChecklist.parse((await get(desk, `/shifts/${shiftId}`)).body)
      expect(checklist.materialized).toBe(false)
      expect(checklist.items).toEqual([])
    })

    it('gives no Item for a Task deliberately assigned to none', async () => {
      const desk = await holder()
      const shiftId = await todaysShift()
      const created = await post(desk, '/tasks', {
        subjectKind: 'space',
        priority: 'discretionary',
        period: 'day',
        requiresMedicationAuthority: false,
        closing: false,
        instructionText: 'Groom.',
      })
      const taskId = created.body.taskId as string
      const fieldC = await seedSpace(desk, 'Field C')
      await post(desk, '/task-assignments', {
        taskId,
        horseId: null,
        spaceId: fieldC,
        stance: 'deliberately_none',
        shiftType: null,
        validFrom: day(),
      })

      await post(desk, '/items/materialization')
      const checklist = shiftChecklist.parse((await get(desk, `/shifts/${shiftId}`)).body)
      expect(checklist.items.some((item) => item.spaceId === fieldC)).toBe(false)
    })

    it('still materializes work for a Subject nobody has decided for, flagged rather than dropped', async () => {
      const desk = await holder()
      const shiftId = await todaysShift()
      const created = await post(desk, '/tasks', {
        subjectKind: 'space',
        priority: 'essential',
        period: 'day',
        requiresMedicationAuthority: false,
        closing: false,
        instructionText: 'Muck the stalls.',
      })
      const taskId = created.body.taskId as string
      const fieldC = await seedSpace(desk, 'Field C')
      void taskId

      await post(desk, '/items/materialization')
      const checklist = shiftChecklist.parse((await get(desk, `/shifts/${shiftId}`)).body)
      const item = checklist.items.find((each) => each.spaceId === fieldC)
      expect(item).toMatchObject({ assignmentUndecided: true, assignedShiftType: null })
    })
  })

  describe('the tenancy guarantee', () => {
    it('has row-level security and a policy on every table this ticket added', async () => {
      const added = ['tasks', 'task_assignments', 'items']

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

    it('sees no Task of another organisation', async () => {
      const elsewhere = '00000000-0000-0000-0000-0000000000e9'
      await owner`delete from tasks where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
      await owner`
        insert into orgs (id, name, time_zone)
        values (${elsewhere}, 'Somebody Else', 'America/Chicago')
      `
      await owner`
        insert into tasks
          (id, org_id, subject_kind, priority, period, requires_medication_authority, closing, instruction_text)
        values (gen_random_uuid(), ${elsewhere}, 'rescue', 'discretionary', 'day', false, false,
                'A task from another rescue entirely')
      `

      const listed = taskList.parse((await get(await reader(), '/tasks')).body)
      expect(listed.tasks.some((task) => task.instructionText.includes('another rescue'))).toBe(
        false,
      )

      await owner`delete from tasks where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
    })
  })
})
