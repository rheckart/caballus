/**
 * Closing a Shift, through the API application's own fetch entry (#32's
 * testing decisions, #45): assigning Items, Dropping and Not-doing, the close
 * gate, unmet Prep filing itself Not done, Shift Notes and their post-close
 * carve-out, and a Shift's own Observation Dispositions.
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

const FIELD_BARN = '00000000-0000-0000-0000-0000000000c5'
const TIME_ZONE = 'America/New_York'

describe.skipIf(!reachable)('Closing a Shift, through the API', () => {
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
    await owner`delete from shift_notes where org_id = ${FIELD_BARN}`
    await owner`delete from escalation_comments where org_id = ${FIELD_BARN}`
    await owner`delete from escalations where org_id = ${FIELD_BARN}`
    await owner`delete from observations where org_id = ${FIELD_BARN}`
    await owner`delete from attendance where org_id = ${FIELD_BARN}`
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

  async function rosterOnto(
    shiftId: string,
    volunteerId: string,
    position: 'lead' | 'volunteer' = 'volunteer',
  ): Promise<void> {
    const desk = await coordinator()
    const placed = await post(desk, '/shifts/roster', { shiftId, volunteerId, position })
    expect(placed.status).toBe(201)
  }

  /** One Discretionary rescue-wide Task with a tolerance of two, so Drop and overdue are both reachable. */
  async function groomTask(toleranceCount = 2): Promise<string> {
    const desk = await horseCareHolder()
    const created = await post(desk, '/tasks', {
      subjectKind: 'rescue',
      priority: 'discretionary',
      period: 'day',
      requiresMedicationAuthority: false,
      toleranceCount,
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

  async function rescueItemId(shiftId: string): Promise<string> {
    const checklist = shiftChecklist.parse(
      (await get(await coordinator(), `/shifts/${shiftId}`)).body,
    )
    const item = checklist.items.find((each) => each.subjectKind === 'rescue')
    if (item === undefined) throw new Error('The rescue-wide Item did not materialize.')
    return item.id
  }

  describe('assigning an Item — a hint, never a gate', () => {
    it('lets a rostered Volunteer self-claim', async () => {
      const shiftId = await todaysShift()
      await groomTask()
      await materialize()
      const beth = await volunteer('Beth Ann')
      await rosterOnto(shiftId, beth)
      const itemId = await rescueItemId(shiftId)

      const assigned = await post(apiAs(beth, []), '/items/assign', {
        shiftId,
        itemId,
        volunteerId: beth,
      })
      expect(assigned.status).toBe(204)

      const checklist = shiftChecklist.parse(
        (await get(await coordinator(), `/shifts/${shiftId}`)).body,
      )
      expect(checklist.items.find((each) => each.id === itemId)).toMatchObject({
        assignedToVolunteerId: beth,
        assignedToVolunteerName: 'Beth Ann',
      })
    })

    it('lets Shift Authority assign somebody else rostered, and refuses a plain Volunteer the same act', async () => {
      const shiftId = await todaysShift()
      await groomTask()
      await materialize()
      const lead = await volunteer('Lead Lucy')
      const beth = await volunteer('Beth Ann')
      await rosterOnto(shiftId, lead, 'lead')
      await rosterOnto(shiftId, beth)
      const itemId = await rescueItemId(shiftId)

      const refused = await post(apiAs(beth, []), '/items/assign', {
        shiftId,
        itemId,
        volunteerId: lead,
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('not_shift_authority')

      const assigned = await post(apiAs(lead, []), '/items/assign', {
        shiftId,
        itemId,
        volunteerId: beth,
      })
      expect(assigned.status).toBe(204)
    })
  })

  describe('Dropping Discretionary work', () => {
    it('records actor and time, and is refused for Essential work', async () => {
      const shiftId = await todaysShift()
      await groomTask()
      await materialize()
      const lead = await volunteer('Lead Lucy')
      await rosterOnto(shiftId, lead, 'lead')
      const itemId = await rescueItemId(shiftId)

      const dropped = await post(apiAs(lead, []), '/items/drop', {
        shiftId,
        itemId,
        reason: 'Rain — grooming skipped today.',
      })
      expect(dropped.status).toBe(201)

      const checklist = shiftChecklist.parse(
        (await get(apiAs(lead, []), `/shifts/${shiftId}`)).body,
      )
      expect(checklist.items.find((each) => each.id === itemId)).toMatchObject({
        outcome: 'dropped',
        outcomeReason: 'Rain — grooming skipped today.',
        outcomeByName: 'Lead Lucy',
      })
    })

    it('is refused to anybody who does not hold Shift Authority', async () => {
      const shiftId = await todaysShift()
      await groomTask()
      await materialize()
      const beth = await volunteer('Beth Ann')
      await rosterOnto(shiftId, beth)
      const itemId = await rescueItemId(shiftId)

      const refused = await post(apiAs(beth, []), '/items/drop', { shiftId, itemId })
      expect(refused.status).toBe(403)
    })

    it('is withdrawn once the Item reaches its Task’s tolerance, and Not done takes over', async () => {
      const shiftId = await todaysShift()
      const taskId = await groomTask(2)
      await materialize()
      const lead = await volunteer('Lead Lucy')
      await rosterOnto(shiftId, lead, 'lead')
      const itemId = await rescueItemId(shiftId)

      // One prior skip, on a materialized Item for the same Task and Subject —
      // a second dated Shift standing in for "yesterday's occurrence" without
      // needing the clock to move.
      const desk = await coordinator()
      const otherDay = await post(desk, '/shifts', {
        day: day(),
        startTime: '07:00',
        targetHeadcount: 1,
        purpose: 'Prior occurrence fixture',
      })
      expect(otherDay.status).toBe(201)
      await owner`
        insert into items
          (id, org_id, day, shift_id, kind, task_id, subject_kind, priority,
           requires_medication_authority, instruction_text, materialization_key)
        values
          (gen_random_uuid(), ${FIELD_BARN}, ${day()}, null, 'task', ${taskId}, 'rescue',
           'discretionary', false, 'Sweep the barn.', ${`prior-${newIdempotencyKey()}`})
      `

      const overdueChecklist = shiftChecklist.parse(
        (await get(apiAs(lead, []), `/shifts/${shiftId}`)).body,
      )
      expect(overdueChecklist.items.find((each) => each.id === itemId)?.overdue).toBe(true)

      const refusedDrop = await post(apiAs(lead, []), '/items/drop', { shiftId, itemId })
      expect(refusedDrop.status).toBe(409)
      expect(refusedDrop.body.error).toBe('overdue_drop_withdrawn')

      const notDone = await post(apiAs(lead, []), '/items/not-done', {
        shiftId,
        itemId,
        reason: 'Still not done — three in a row now.',
      })
      expect(notDone.status).toBe(201)
    })
  })

  describe('Not done', () => {
    it('is available to anybody rostered, and requires a reason', async () => {
      const shiftId = await todaysShift()
      await groomTask()
      await materialize()
      const beth = await volunteer('Beth Ann')
      await rosterOnto(shiftId, beth)
      const itemId = await rescueItemId(shiftId)

      const missingReason = await post(apiAs(beth, []), '/items/not-done', {
        shiftId,
        itemId,
        reason: '',
      })
      expect(missingReason.status).toBe(400)

      const notDone = await post(apiAs(beth, []), '/items/not-done', {
        shiftId,
        itemId,
        reason: 'It warmed up — we did not blanket.',
      })
      expect(notDone.status).toBe(201)
    })
  })

  describe('closing the Shift', () => {
    async function shiftWithLead(): Promise<{ shiftId: string; lead: string }> {
      const shiftId = await todaysShift()
      const lead = await volunteer('Lead Lucy')
      await rosterOnto(shiftId, lead, 'lead')
      return { shiftId, lead }
    }

    it('is blocked by an Open Attendance, and succeeds once it closes', async () => {
      const { shiftId, lead } = await shiftWithLead()
      await post(apiAs(lead, []), '/attendance/sign-in', { volunteerId: lead, shiftId })

      const blocked = await post(apiAs(lead, []), '/shifts/close', { shiftId })
      expect(blocked.status).toBe(409)
      expect(blocked.body.error).toBe('close_blocked')

      await post(apiAs(lead, []), '/attendance/sign-out', { volunteerId: lead, shiftId })
      const closed = await post(apiAs(lead, []), '/shifts/close', { shiftId })
      expect(closed.status).toBe(200)
      expect(typeof closed.body.closedAt).toBe('number')
    })

    it('is blocked by an undispositioned Observation, and succeeds once it is dispositioned', async () => {
      const { shiftId, lead } = await shiftWithLead()
      await post(apiAs(lead, []), '/attendance/sign-in', { volunteerId: lead, shiftId })
      const recorded = await post(apiAs(lead, []), '/observations', {
        shiftId,
        text: 'The gate latch is loose.',
      })
      expect(recorded.status).toBe(201)
      await post(apiAs(lead, []), '/attendance/sign-out', { volunteerId: lead, shiftId })

      const blocked = await post(apiAs(lead, []), '/shifts/close', { shiftId })
      expect(blocked.status).toBe(409)
      expect(blocked.body.error).toBe('close_blocked')

      const dispositioned = await post(apiAs(lead, []), '/observations/disposition', {
        shiftId,
        observationId: recorded.body.observationId,
        disposition: 'noted_no_action',
      })
      expect(dispositioned.status).toBe(204)

      const closed = await post(apiAs(lead, []), '/shifts/close', { shiftId })
      expect(closed.status).toBe(200)
    })

    it('curates an Observation into Shift Notes, visible on the next opening', async () => {
      const { shiftId, lead } = await shiftWithLead()
      await post(apiAs(lead, []), '/attendance/sign-in', { volunteerId: lead, shiftId })
      const recorded = await post(apiAs(lead, []), '/observations', {
        shiftId,
        text: 'Storm needs her stall re-bedded before PM.',
      })

      const curated = await post(apiAs(lead, []), '/observations/disposition', {
        shiftId,
        observationId: recorded.body.observationId,
        disposition: 'curated_into_shift_notes',
      })
      expect(curated.status).toBe(204)

      const checklist = shiftChecklist.parse(
        (await get(apiAs(lead, []), `/shifts/${shiftId}`)).body,
      )
      expect(checklist.shiftNotes.some((note) => note.text.includes('re-bedded'))).toBe(true)

      await post(apiAs(lead, []), '/attendance/sign-out', { volunteerId: lead, shiftId })
      const closed = await post(apiAs(lead, []), '/shifts/close', { shiftId })
      expect(closed.status).toBe(200)
    })

    it('files an unmet Prep as Not done, credited to whoever closed', async () => {
      const shiftId = await todaysShift()
      const lead = await volunteer('Lead Lucy')
      await rosterOnto(shiftId, lead, 'lead')

      const desk = await horseCareHolder()
      const prepTask = await post(desk, '/tasks', {
        subjectKind: 'rescue',
        priority: 'essential',
        period: 'day',
        requiresMedicationAuthority: false,
        prepForShiftType: 'feed_am',
        closing: false,
        instructionText: 'Soak beet pulp for the morning.',
      })
      expect(prepTask.status).toBe(201)
      await materialize()

      const checklist = shiftChecklist.parse(
        (await get(apiAs(lead, []), `/shifts/${shiftId}`)).body,
      )
      const prepItem = checklist.prepOwed.find((each) => each.instructionText.includes('beet pulp'))
      expect(prepItem).toBeDefined()
      expect(prepItem?.outcome).toBeNull()

      const closed = await post(apiAs(lead, []), '/shifts/close', { shiftId })
      expect(closed.status).toBe(200)

      const after = shiftChecklist.parse((await get(apiAs(lead, []), `/shifts/${shiftId}`)).body)
      const filed = [...after.items, ...after.prepOwed].find((each) =>
        each.instructionText.includes('beet pulp'),
      )
      expect(filed).toMatchObject({ outcome: 'not_done', outcomeByName: 'Lead Lucy' })
      expect(filed?.outcomeReason).toContain('Not done')
    })

    it('is immutable once closed: closing again is refused, and a closed Shift stays closed', async () => {
      const { shiftId, lead } = await shiftWithLead()
      const closed = await post(apiAs(lead, []), '/shifts/close', { shiftId })
      expect(closed.status).toBe(200)

      const again = await post(apiAs(lead, []), '/shifts/close', { shiftId })
      expect(again.status).toBe(409)
      expect(again.body.error).toBe('shift_already_closed')
    })
  })

  describe('Shift Notes', () => {
    it('is curated by Shift Authority, and shown to a later Shift the same day', async () => {
      const { shiftId, lead } = await shiftWithLeadFixture()
      const noted = await post(apiAs(lead, []), '/shifts/notes', {
        shiftId,
        text: 'Dawson is off his feed — watch him at Lunch.',
      })
      expect(noted.status).toBe(201)

      const desk = await coordinator()
      const lunch = await post(desk, '/shift-patterns', {
        weekday: weekdayOf(day(), TIME_ZONE),
        shiftType: 'lunch',
        startTime: '12:00',
        targetHeadcount: 1,
      })
      expect(lunch.status).toBe(201)
      await post(desk, '/shifts/generation')
      const listed = shiftList.parse((await get(desk, '/shifts')).body)
      const lunchId = listed.shifts.find(
        (shift) => shift.day === day() && shift.shiftType === 'lunch',
      )?.id
      expect(lunchId).toBeDefined()

      const lunchChecklist = shiftChecklist.parse(
        (await get(apiAs(lead, []), `/shifts/${lunchId}`)).body,
      )
      expect(lunchChecklist.shiftNotes.some((note) => note.text.includes('Dawson'))).toBe(true)
    })

    it('refuses Shift Authority alone once the Shift has closed, and takes `horse_care` instead', async () => {
      const { shiftId, lead } = await shiftWithLeadFixture()
      const closed = await post(apiAs(lead, []), '/shifts/close', { shiftId })
      expect(closed.status).toBe(200)

      const refused = await post(apiAs(lead, []), '/shifts/notes', {
        shiftId,
        text: 'I called the vet.',
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('shift_closed')

      const officer = await horseCareHolder()
      const posted = await post(officer, '/shifts/notes', { shiftId, text: 'I called the vet.' })
      expect(posted.status).toBe(201)
    })

    async function shiftWithLeadFixture(): Promise<{ shiftId: string; lead: string }> {
      const shiftId = await todaysShift()
      const lead = await volunteer('Lead Lucy')
      await rosterOnto(shiftId, lead, 'lead')
      return { shiftId, lead }
    }
  })

  describe('the tenancy guarantee', () => {
    it('has row-level security and a policy on shift_notes', async () => {
      const rows = await owner`
        select c.relname as table, c.relrowsecurity as enabled, count(p.polname) as policies
        from pg_class c
        left join pg_policy p on p.polrelid = c.oid
        where c.relname = 'shift_notes'
        group by c.relname, c.relrowsecurity
      `

      expect(rows).toHaveLength(1)
      expect(rows[0]?.enabled).toBe(true)
      expect(Number(rows[0]?.policies)).toBe(1)
    })
  })
})
