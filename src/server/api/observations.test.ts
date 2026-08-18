/**
 * Observations and Escalations, through the API application's own fetch entry
 * (#32's testing decisions, #44): the Facebook group's reporting job, without
 * the scroll (ADR 0014).
 *
 * Skipped, loudly, on a machine with no database — see `shifts.test.ts`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, type OrgId } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import { escalationList, observationList, shiftList } from '../../shared/api-contract'
import type { DomainScope } from '../../shared/domain-scopes'
import type { DayString } from '../../shared/time'
import { forgetSendsForTest, setEmailTransport, type OutgoingEmail } from '../email'
import { anonymousContext, currentOrgId } from '../request-context'
import { today, weekdayOf } from '../time'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FIELD_BARN = '00000000-0000-0000-0000-0000000000f4'
const TIME_ZONE = 'America/New_York'

describe.skipIf(!reachable)('Observations and Escalations, through the API', () => {
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
    await owner`delete from escalation_comments where org_id = ${FIELD_BARN}`
    await owner`delete from escalations where org_id = ${FIELD_BARN}`
    await owner`delete from observations where org_id = ${FIELD_BARN}`
    await owner`delete from attendance where org_id = ${FIELD_BARN}`
    await owner`delete from horses where org_id = ${FIELD_BARN}`
    await owner`delete from audit_entries where org_id = ${FIELD_BARN}`
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

  /** A real grant, not a faked actor scope — routing resolution is tested against these (#44). */
  async function holderOf(
    role: string,
    name: string,
  ): Promise<{ volunteerId: string; email: string }> {
    const volunteerId = await volunteer(name)
    await owner`
      insert into volunteer_roles (org_id, volunteer_id, role)
      values (${FIELD_BARN}, ${volunteerId}, ${role})
    `
    const [row] = await owner`select email from volunteers where id = ${volunteerId}`
    return { volunteerId, email: String(row?.email) }
  }

  async function coordinator() {
    const id = await volunteer('Priya Chandra')
    return { api: apiAs(id, ['roster']), volunteerId: id }
  }

  /** A Shift today, generated from a Pattern, with `who` rostered as `position`. */
  async function shiftWith(who: string, position = 'volunteer'): Promise<string> {
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
    await post(desk.api, '/shifts/roster', { shiftId, volunteerId: who, position })
    return shiftId ?? ''
  }

  describe('recording an Observation', () => {
    it('queues, needs no Domain Scope, and attaches to the recorder’s Attendance', async () => {
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth)
      const api = apiAs(beth, [])
      await post(api, '/attendance/sign-in', { volunteerId: beth, shiftId })

      const written = await post(api, '/observations', {
        shiftId,
        text: 'Storm is off her left fore',
      })
      expect(written.status).toBe(201)

      const attendanceId = (
        await owner`select id from attendance where volunteer_id = ${beth} and shift_id = ${shiftId}`
      )[0]?.id as string
      const listed = observationList.parse((await get(api, `/observations/${attendanceId}`)).body)
      expect(listed.observations).toHaveLength(1)
      expect(listed.observations[0]).toMatchObject({
        attendanceId,
        text: 'Storm is off her left fore',
        recordedBy: beth,
        observedBy: beth,
      })
    })

    it('accepts a subject picked from wherever it was recorded', async () => {
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth)
      const api = apiAs(beth, [])
      await post(api, '/attendance/sign-in', { volunteerId: beth, shiftId })

      const [horse] = await owner`
        insert into horses (id, org_id, name) values (gen_random_uuid(), ${FIELD_BARN}, 'Storm')
        returning id
      `
      const written = await post(api, '/observations', {
        shiftId,
        text: 'Off her left fore',
        subjectKind: 'horse',
        subjectId: horse?.id,
      })
      expect(written.status).toBe(201)

      const attendanceId = (
        await owner`select id from attendance where volunteer_id = ${beth} and shift_id = ${shiftId}`
      )[0]?.id as string
      const listed = observationList.parse((await get(api, `/observations/${attendanceId}`)).body)
      expect(listed.observations[0]).toMatchObject({
        subjectKind: 'horse',
        subjectId: horse?.id,
        subjectLabel: 'Storm',
      })
    })

    it('refuses a recorder with nothing open to attach to', async () => {
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth)
      const refused = await post(apiAs(beth, []), '/observations', { shiftId, text: 'Anything' })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('attendance_not_found')
    })

    it('never edits or deletes once it reaches the server — no such endpoint exists in the contract', async () => {
      // Structural: `src/shared/api-contract.ts` declares no `/observations/edit`
      // and no delete. A caller attempting either fails to compile on the typed
      // client, which is the whole of "immutability at the client seam."
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth)
      const api = apiAs(beth, [])
      await post(api, '/attendance/sign-in', { volunteerId: beth, shiftId })
      const written = await post(api, '/observations', { shiftId, text: 'Original words' })
      expect(written.status).toBe(201)

      const editAttempt = await api.fetch(
        new Request(url('/observations/edit'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Rewritten' }),
        }),
      )
      expect(editAttempt.status).toBe(404)
    })
  })

  describe('Shift Authority recording on somebody else’s behalf', () => {
    it('names the rostered volunteer as observer, distinct from the recorder', async () => {
      const kate = await volunteer('Kate')
      const joy = await volunteer('Joy')
      const shiftId = await shiftWith(kate, 'lead')
      const desk = await coordinator()
      await post(desk.api, '/shifts/roster', { shiftId, volunteerId: joy, position: 'volunteer' })
      await post(apiAs(joy, []), '/attendance/sign-in', { volunteerId: joy, shiftId })
      await post(apiAs(kate, []), '/attendance/sign-in', { volunteerId: kate, shiftId })

      const api = apiAs(kate, [])
      const written = await post(api, '/observations', {
        shiftId,
        text: 'The trough in D is cracked',
        observerVolunteerId: joy,
      })
      expect(written.status).toBe(201)

      const attendanceId = (
        await owner`select id from attendance where volunteer_id = ${kate} and shift_id = ${shiftId}`
      )[0]?.id as string
      const listed = observationList.parse((await get(api, `/observations/${attendanceId}`)).body)
      expect(listed.observations[0]).toMatchObject({ recordedBy: kate, observedBy: joy })
    })

    it('refuses on-behalf recording without Shift Authority', async () => {
      const beth = await volunteer('Beth Ann')
      const joy = await volunteer('Joy')
      const shiftId = await shiftWith(beth)
      await post(apiAs(joy, []), '/attendance/sign-in', { volunteerId: joy, shiftId })
      await post(apiAs(beth, []), '/attendance/sign-in', { volunteerId: beth, shiftId })

      const refused = await post(apiAs(beth, []), '/observations', {
        shiftId,
        text: 'Anything',
        observerVolunteerId: joy,
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('not_shift_authority')
    })

    it('refuses naming an observer on a Visit — there is no Lead', async () => {
      const kate = await volunteer('Kate')
      const joy = await volunteer('Joy')
      await post(apiAs(kate, []), '/attendance/sign-in', {
        volunteerId: kate,
        description: 'Paperwork',
        category: 'administrative',
      })

      const refused = await post(apiAs(kate, []), '/observations', {
        text: 'Anything',
        observerVolunteerId: joy,
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('on_behalf_requires_shift')
    })
  })

  describe('Escalating', () => {
    beforeEach(() => {
      forgetSendsForTest()
    })
    afterEach(() => {
      setEmailTransport(null)
    })

    async function anObservation(recorder: string, shiftId: string | null): Promise<string> {
      const api = apiAs(recorder, [])
      if (shiftId === null) {
        await post(api, '/attendance/sign-in', {
          volunteerId: recorder,
          description: 'Checked on the horses',
          category: 'other',
        })
      } else {
        await post(api, '/attendance/sign-in', { volunteerId: recorder, shiftId })
      }
      const written = await post(api, '/observations', {
        shiftId,
        text: 'Third time this week, and she left half the bucket',
      })
      return String(written.body.observationId)
    }

    it('takes Shift Authority, and mails the destination Scope’s current holders', async () => {
      const posted: OutgoingEmail[] = []
      setEmailTransport((message) => {
        posted.push(message)
        return Promise.resolve()
      })

      const kate = await volunteer('Kate')
      const shiftId = await shiftWith(kate, 'lead')
      const observationId = await anObservation(kate, shiftId)
      const welfare = await holderOf('head_of_horse_welfare', 'Head Welfare')

      const escalated = await post(apiAs(kate, []), '/escalations', {
        observationId,
        scope: 'horse_care',
        framing: 'Third time this week, and she left half the bucket.',
      })
      expect(escalated.status).toBe(201)
      expect(posted).toHaveLength(1)
      expect(posted[0]?.to).toBe(welfare.email)
      expect(posted[0]?.text).toContain('Third time this week')
    })

    it('takes a Scope holder adopting a raw Observation into their own Scope', async () => {
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth)
      const observationId = await anObservation(beth, shiftId)
      const welfare = await holderOf('head_of_horse_welfare', 'Head Welfare')

      const escalated = await post(apiAs(welfare.volunteerId, ['horse_care']), '/escalations', {
        observationId,
        scope: 'horse_care',
        framing: 'Booking the farrier for Tuesday.',
      })
      expect(escalated.status).toBe(201)
    })

    it('refuses an actor with neither Shift Authority nor the named Scope', async () => {
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth)
      const observationId = await anObservation(beth, shiftId)

      const refused = await post(apiAs(beth, []), '/escalations', {
        observationId,
        scope: 'horse_care',
        framing: 'Anything',
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('not_authorized_to_escalate')
    })

    it('shares no state between two Escalations of the same Observation to different Scopes', async () => {
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth, 'lead')
      const observationId = await anObservation(beth, shiftId)

      const toWelfare = await post(apiAs(beth, []), '/escalations', {
        observationId,
        scope: 'horse_care',
        framing: 'For the Head of Horse Welfare.',
      })
      const toMaintenance = await post(apiAs(beth, []), '/escalations', {
        observationId,
        scope: 'maintenance',
        framing: 'For the Head of Maintenance too — the gate latch, separately.',
      })
      expect(toWelfare.status).toBe(201)
      expect(toMaintenance.status).toBe(201)
      expect(toWelfare.body.escalationId).not.toBe(toMaintenance.body.escalationId)

      const maintainer = await holderOf('head_of_maintenance', 'Head Maintenance')
      const closed = await post(
        apiAs(maintainer.volunteerId, ['maintenance']),
        '/escalations/close',
        {
          escalationId: toMaintenance.body.escalationId,
          note: 'Fixed the latch.',
        },
      )
      expect(closed.status).toBe(204)

      const listed = escalationList.parse((await get(apiAs(beth, []), '/escalations')).body)
      const welfareOne = listed.escalations.find((row) => row.id === toWelfare.body.escalationId)
      expect(welfareOne?.closedAt).toBeNull()
    })
  })

  describe('the thread', () => {
    beforeEach(() => {
      forgetSendsForTest()
      setEmailTransport(() => Promise.resolve())
    })
    afterEach(() => {
      setEmailTransport(null)
    })

    it('appends for anyone, before close and after', async () => {
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftWith(beth, 'lead')
      const api = apiAs(beth, [])
      await post(api, '/attendance/sign-in', { volunteerId: beth, shiftId })
      const written = await post(api, '/observations', { shiftId, text: 'Anything at all' })
      const observationId = String(written.body.observationId)
      const escalated = await post(api, '/escalations', {
        observationId,
        scope: 'horse_care',
        framing: 'Framing it.',
      })
      const escalationId = String(escalated.body.escalationId)

      const passerby = await volunteer('Passerby')
      const before = await post(apiAs(passerby, []), '/escalations/comments', {
        escalationId,
        text: 'Saw it too.',
      })
      expect(before.status).toBe(201)

      const maintainer = await holderOf('head_of_horse_welfare', 'Head Welfare')
      await post(apiAs(maintainer.volunteerId, ['horse_care']), '/escalations/close', {
        escalationId,
        note: 'Farrier booked.',
      })

      const after = await post(apiAs(passerby, []), '/escalations/comments', {
        escalationId,
        text: 'Still worse this morning.',
      })
      expect(after.status).toBe(201)

      const listed = escalationList.parse((await get(api, '/escalations')).body)
      const found = listed.escalations.find((row) => row.id === escalationId)
      expect(found?.comments.map((comment) => comment.text)).toEqual([
        'Saw it too.',
        'Still worse this morning.',
      ])
    })
  })

  describe('closing', () => {
    beforeEach(() => {
      forgetSendsForTest()
    })
    afterEach(() => {
      setEmailTransport(null)
    })

    it('takes a holder of the addressed Scope and a note, and mails the reporter in full', async () => {
      const posted: OutgoingEmail[] = []
      setEmailTransport((message) => {
        posted.push(message)
        return Promise.resolve()
      })

      const beth = await volunteer('Beth Ann')
      const [bethRow] = await owner`select email from volunteers where id = ${beth}`
      const bethEmail = String(bethRow?.email)
      const shiftId = await shiftWith(beth, 'lead')
      const api = apiAs(beth, [])
      await post(api, '/attendance/sign-in', { volunteerId: beth, shiftId })
      const written = await post(api, '/observations', { shiftId, text: 'Anything at all' })
      const escalated = await post(api, '/escalations', {
        observationId: written.body.observationId,
        scope: 'horse_care',
        framing: 'Framing it.',
      })
      const escalationId = String(escalated.body.escalationId)

      const refused = await post(apiAs(beth, []), '/escalations/close', {
        escalationId,
        note: 'Nope',
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('not_the_addressed_scope')

      const welfare = await holderOf('head_of_horse_welfare', 'Head Welfare')
      const closed = await post(apiAs(welfare.volunteerId, ['horse_care']), '/escalations/close', {
        escalationId,
        note: 'Farrier booked for Tuesday.',
      })
      expect(closed.status).toBe(204)
      expect(
        posted.some(
          (message) => message.to === bethEmail && message.text === 'Farrier booked for Tuesday.',
        ),
      ).toBe(true)

      const reclose = await post(apiAs(welfare.volunteerId, ['horse_care']), '/escalations/close', {
        escalationId,
        note: 'Again',
      })
      expect(reclose.status).toBe(409)
      expect(reclose.body.error).toBe('already_closed')
    })
  })

  describe('a Visit’s Observations, dispositioned by their recorder at sign-out', () => {
    beforeEach(() => {
      forgetSendsForTest()
      setEmailTransport(() => Promise.resolve())
    })
    afterEach(() => {
      setEmailTransport(null)
    })

    it('blocks sign-out until every Observation on it is dispositioned', async () => {
      const beth = await volunteer('Beth Ann')
      const api = apiAs(beth, [])
      await post(api, '/attendance/sign-in', {
        volunteerId: beth,
        description: 'Checked on the horses',
        category: 'other',
      })
      await post(api, '/observations', { text: 'Everything looked fine except the west gate' })

      const blocked = await post(api, '/attendance/sign-out', { volunteerId: beth })
      expect(blocked.status).toBe(409)
      expect(blocked.body.error).toBe('observations_undispositioned')
    })

    it('Escalate — adopting into a held Scope — dispositions it and clears sign-out', async () => {
      const beth = await volunteer('Beth Ann')
      await owner`
        insert into volunteer_roles (org_id, volunteer_id, role)
        values (${FIELD_BARN}, ${beth}, 'head_of_maintenance')
      `
      const api = apiAs(beth, ['maintenance'])
      await post(api, '/attendance/sign-in', {
        volunteerId: beth,
        description: 'Checked on the horses',
        category: 'other',
      })
      const written = await post(api, '/observations', { text: 'The west gate latch is broken' })

      const escalated = await post(api, '/escalations', {
        observationId: written.body.observationId,
        scope: 'maintenance',
        framing: 'The west gate latch is broken.',
      })
      expect(escalated.status).toBe(201)

      const signedOut = await post(api, '/attendance/sign-out', { volunteerId: beth })
      expect(signedOut.status).toBe(204)
    })

    it('noted, no action — the recorder’s own call, needing no Scope — dispositions it too', async () => {
      const beth = await volunteer('Beth Ann')
      const api = apiAs(beth, [])
      await post(api, '/attendance/sign-in', {
        volunteerId: beth,
        description: 'Checked on the horses',
        category: 'other',
      })
      const written = await post(api, '/observations', { text: 'Nothing worth escalating' })

      const noted = await post(api, '/observations/note', {
        observationId: written.body.observationId,
      })
      expect(noted.status).toBe(204)

      const signedOut = await post(api, '/attendance/sign-out', { volunteerId: beth })
      expect(signedOut.status).toBe(204)
    })

    it('refuses noting an Observation that is not the actor’s own', async () => {
      const beth = await volunteer('Beth Ann')
      const other = await volunteer('Other')
      const api = apiAs(beth, [])
      await post(api, '/attendance/sign-in', {
        volunteerId: beth,
        description: 'Checked on the horses',
        category: 'other',
      })
      const written = await post(api, '/observations', { text: 'Anything' })

      const refused = await post(apiAs(other, []), '/observations/note', {
        observationId: written.body.observationId,
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('not_the_recorder')
    })
  })

  describe('the tenancy guarantee', () => {
    it('has row-level security and a policy on every table this ticket added', async () => {
      const added = ['observations', 'escalations', 'escalation_comments']
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
  })
})
