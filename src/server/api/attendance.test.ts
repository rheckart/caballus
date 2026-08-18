/**
 * Attendance, through the API application's own fetch entry (#32's testing
 * decisions, #43): sign-in and sign-out, against a Shift and as a Visit,
 * recording for somebody else, the ledger behind `roster`, and the fourth
 * roster fact riding on the floor-readable schedule (ADR 0012).
 *
 * Skipped, loudly, on a machine with no database — see `shifts.test.ts`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { closeDb, type OrgId } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import { attendanceLedger, shiftList } from '../../shared/api-contract'
import type { DomainScope } from '../../shared/domain-scopes'
import type { DayString } from '../../shared/time'
import { anonymousContext, currentOrgId } from '../request-context'
import { today, weekdayOf } from '../time'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FIELD_BARN = '00000000-0000-0000-0000-0000000000ad'
const TIME_ZONE = 'America/New_York'

describe.skipIf(!reachable)('Attendance, through the API', () => {
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
    await owner`delete from attendance where org_id = ${FIELD_BARN}`
    await owner`delete from audit_entries where org_id = ${FIELD_BARN}`
    await owner`delete from shift_roster where org_id = ${FIELD_BARN}`
    await owner`delete from shifts where org_id = ${FIELD_BARN}`
    await owner`delete from shift_pattern_roster where org_id = ${FIELD_BARN}`
    await owner`delete from shift_patterns where org_id = ${FIELD_BARN}`
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
    const id = await volunteer('Priya Chandra')
    return { api: apiAs(id, ['roster']), volunteerId: id }
  }

  /** A Shift today, generated from a Pattern, with `who` rostered on it. */
  async function shiftWith(who: string): Promise<string> {
    const desk = await coordinator()
    const created = await post(desk.api, '/shift-patterns', {
      weekday: weekdayOf(day(), TIME_ZONE),
      shiftType: 'feed_am',
      startTime: '06:30',
      targetHeadcount: 3,
    })
    expect(created.status).toBe(201)
    await post(desk.api, '/shifts/generation')
    const listed = shiftList.parse((await get(desk.api, '/shifts')).body)
    const shiftId = listed.shifts.find((shift) => shift.day === day())?.id
    expect(shiftId).toBeDefined()
    await post(desk.api, '/shifts/roster', { shiftId, volunteerId: who, position: 'volunteer' })
    return shiftId ?? ''
  }

  describe('a Shift sign-in', () => {
    it('signs in and out against a Shift, with the category set by the server', async () => {
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth)
      const api = apiAs(beth, [])

      const signedIn = await post(api, '/attendance/sign-in', { volunteerId: beth, shiftId })
      expect(signedIn.status).toBe(201)

      const desk = await coordinator()
      const ledger = attendanceLedger.parse((await get(desk.api, '/attendance')).body)
      expect(ledger.entries).toHaveLength(1)
      expect(ledger.entries[0]).toMatchObject({
        volunteerId: beth,
        shiftId,
        category: 'shift',
        description: null,
        arrivedBy: beth,
        departedAt: null,
      })

      const signedOut = await post(api, '/attendance/sign-out', { volunteerId: beth, shiftId })
      expect(signedOut.status).toBe(204)

      const after = attendanceLedger.parse((await get(desk.api, '/attendance')).body)
      expect(after.entries[0]?.departedAt).not.toBeNull()
      expect(after.entries[0]?.departedBy).toBe(beth)
    })

    it('never invents a departure — an unsigned-out Attendance stays open until a person closes it', async () => {
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth)
      await post(apiAs(beth, []), '/attendance/sign-in', { volunteerId: beth, shiftId })

      const desk = await coordinator()
      const ledger = attendanceLedger.parse((await get(desk.api, '/attendance')).body)
      expect(ledger.entries[0]?.departedAt).toBeNull()
    })

    it('shows on the Shift it belongs to, and clears the fourth roster fact once signed in', async () => {
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth)

      const desk = await coordinator()
      const before = shiftList.parse((await get(desk.api, '/shifts')).body)
      const beforeShift = before.shifts.find((shift) => shift.id === shiftId)
      expect(beforeShift?.attendance).toEqual([])

      await post(apiAs(beth, []), '/attendance/sign-in', { volunteerId: beth, shiftId })

      const after = shiftList.parse((await get(desk.api, '/shifts')).body)
      const afterShift = after.shifts.find((shift) => shift.id === shiftId)
      expect(afterShift?.attendance).toHaveLength(1)
      expect(afterShift?.attendance[0]?.volunteerId).toBe(beth)
      expect(afterShift?.attendance[0]?.departedAt).toBeNull()
    })

    it('refuses a second open sign-in against the same Shift', async () => {
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth)
      const api = apiAs(beth, [])
      await post(api, '/attendance/sign-in', { volunteerId: beth, shiftId })

      const again = await post(api, '/attendance/sign-in', { volunteerId: beth, shiftId })
      expect(again.status).toBe(409)
      expect(again.body.error).toBe('already_signed_in')
    })

    it('refuses signing out of nothing open', async () => {
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth)
      const refused = await post(apiAs(beth, []), '/attendance/sign-out', {
        volunteerId: beth,
        shiftId,
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('not_signed_in')
    })
  })

  describe('a replayed sign-in never doubles', () => {
    it('answers the same key with the same recorded row, not a second one', async () => {
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth)
      const api = apiAs(beth, [])
      const key = newIdempotencyKey()

      const first = await post(api, '/attendance/sign-in', { volunteerId: beth, shiftId }, key)
      const replay = await post(api, '/attendance/sign-in', { volunteerId: beth, shiftId }, key)
      expect(replay.status).toBe(first.status)
      expect(replay.body).toEqual(first.body)

      const desk = await coordinator()
      const ledger = attendanceLedger.parse((await get(desk.api, '/attendance')).body)
      expect(ledger.entries).toHaveLength(1)
    })
  })

  describe('a Visit', () => {
    it('takes a description and a category, and no Shift', async () => {
      const beth = await volunteer('Beth Ann')
      const signedIn = await post(apiAs(beth, []), '/attendance/sign-in', {
        volunteerId: beth,
        description: 'Mowed the north field',
        category: 'maintenance',
      })
      expect(signedIn.status).toBe(201)

      const desk = await coordinator()
      const ledger = attendanceLedger.parse((await get(desk.api, '/attendance')).body)
      expect(ledger.entries[0]).toMatchObject({
        shiftId: null,
        description: 'Mowed the north field',
        category: 'maintenance',
      })
    })

    it('refuses a Visit with no description', async () => {
      const beth = await volunteer('Beth Ann')
      const refused = await post(apiAs(beth, []), '/attendance/sign-in', {
        volunteerId: beth,
        category: 'maintenance',
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('description_required')
    })

    it('refuses a Visit claiming the Shift category', async () => {
      const beth = await volunteer('Beth Ann')
      const refused = await post(apiAs(beth, []), '/attendance/sign-in', {
        volunteerId: beth,
        description: 'Mowed the north field',
        category: 'shift',
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('category_invalid')
    })

    it('closes the open Visit without needing an Attendance id, when no Shift is named', async () => {
      const beth = await volunteer('Beth Ann')
      const api = apiAs(beth, [])
      await post(api, '/attendance/sign-in', {
        volunteerId: beth,
        description: 'Mowed the north field',
        category: 'maintenance',
      })
      const signedOut = await post(api, '/attendance/sign-out', { volunteerId: beth })
      expect(signedOut.status).toBe(204)

      const desk = await coordinator()
      const ledger = attendanceLedger.parse((await get(desk.api, '/attendance')).body)
      expect(ledger.entries[0]?.departedAt).not.toBeNull()
    })
  })

  describe('recording for somebody else', () => {
    it('signs another Volunteer in and out, attributed to the actor rather than the subject', async () => {
      const beth = await volunteer('Beth Ann')
      const valerie = await volunteer('Valerie')
      const shiftId = await shiftWith(beth)

      const signedIn = await post(apiAs(valerie, []), '/attendance/sign-in', {
        volunteerId: beth,
        shiftId,
      })
      expect(signedIn.status).toBe(201)

      const desk = await coordinator()
      const ledger = attendanceLedger.parse((await get(desk.api, '/attendance')).body)
      expect(ledger.entries[0]).toMatchObject({ volunteerId: beth, arrivedBy: valerie })

      const signedOut = await post(apiAs(valerie, []), '/attendance/sign-out', {
        volunteerId: beth,
        shiftId,
      })
      expect(signedOut.status).toBe(204)

      const after = attendanceLedger.parse((await get(desk.api, '/attendance')).body)
      expect(after.entries[0]?.departedBy).toBe(valerie)
    })
  })

  describe('the Supervising Adult and the Attestation (#45)', () => {
    it('is captured at sign-out, distinct from who was merely present', async () => {
      const student = await volunteer('A Student')
      const adult = await volunteer('An Adult')
      const shiftId = await shiftWith(student)

      await post(apiAs(student, []), '/attendance/sign-in', { volunteerId: student, shiftId })
      const signedOut = await post(apiAs(adult, []), '/attendance/sign-out', {
        volunteerId: student,
        shiftId,
        supervisingAdultId: adult,
        supervisingAdultPhone: '410-555-0100',
        attestationRelationship: 'none',
      })
      expect(signedOut.status).toBe(204)

      const desk = await coordinator()
      const ledger = attendanceLedger.parse((await get(desk.api, '/attendance')).body)
      expect(ledger.entries[0]).toMatchObject({
        volunteerId: student,
        supervisingAdultId: adult,
        supervisingAdultPhone: '410-555-0100',
        attestationRelationship: 'none',
      })
      // Distinct fields: who was present (`volunteerId`) is not who supervised.
      expect(ledger.entries[0]?.volunteerId).not.toBe(ledger.entries[0]?.supervisingAdultId)
    })

    it('refuses an Attestation from a parent, a guardian or a relative', async () => {
      const student = await volunteer('Another Student')
      const parent = await volunteer('The Parent')
      const shiftId = await shiftWith(student)

      await post(apiAs(student, []), '/attendance/sign-in', { volunteerId: student, shiftId })
      const refused = await post(apiAs(parent, []), '/attendance/sign-out', {
        volunteerId: student,
        shiftId,
        supervisingAdultId: parent,
        supervisingAdultPhone: '410-555-0101',
        attestationRelationship: 'parent',
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('relative_may_not_attest')
    })

    it('refuses a Supervising Adult named with no relationship stated', async () => {
      const student = await volunteer('Yet Another Student')
      const adult = await volunteer('Some Adult')
      const shiftId = await shiftWith(student)

      await post(apiAs(student, []), '/attendance/sign-in', { volunteerId: student, shiftId })
      const refused = await post(apiAs(adult, []), '/attendance/sign-out', {
        volunteerId: student,
        shiftId,
        supervisingAdultId: adult,
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('attestation_relationship_required')
    })
  })

  describe('the ledger is behind `roster`', () => {
    it('refuses a reader who does not hold it', async () => {
      const beth = await volunteer('Beth Ann')
      const refused = await get(apiAs(beth, []), '/attendance')
      expect(refused.status).toBe(403)
    })

    it('is open to a reader who holds it', async () => {
      const desk = await coordinator()
      const read = await get(desk.api, '/attendance')
      expect(read.status).toBe(200)
    })
  })

  describe('the tenancy guarantee', () => {
    it('has row-level security and a policy on the table this ticket added', async () => {
      const rows = await owner`
        select c.relname as table, c.relrowsecurity as enabled, count(p.polname) as policies
        from pg_class c
        left join pg_policy p on p.polrelid = c.oid
        where c.relname = 'attendance'
        group by c.relname, c.relrowsecurity
      `
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ enabled: true })
      expect(Number(rows[0]?.policies)).toBe(1)
    })
  })
})
