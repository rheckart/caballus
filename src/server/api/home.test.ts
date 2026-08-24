/**
 * The home screen, composed by the server — through the API application's own
 * fetch entry (#32's testing decisions, #67).
 *
 * `/home` invents no derivation, so what is worth asserting here is not
 * arithmetic — `src/shared/staffing.ts` and `src/shared/announcements.ts` are
 * table-tested where they live — but **the filtering to the person asking**,
 * which only exists once the four sections are composed against a real
 * database. Four claims, and each one is a way the screen could quietly lie:
 * *my* next Shift is one I still stand on and have not Dropped and nobody has
 * closed; *my* cover is work I am not already on and would not be refused;
 * *my* Escalations are the ones addressed to a Scope I actually hold; and the
 * wall carries what has not expired.
 *
 * **The prominence window is asserted from both sides.** ADR 0011 puts the
 * whole horizon in front of `roster` and roughly the next 48 hours in front of
 * everybody else, and a window that is wrong in one direction is a phone
 * shouting about a fortnight while the other is a Shift nobody is asked to
 * cover — so both readers are exercised against the same Shift.
 *
 * Skipped, loudly, on a machine with no database — see `shifts.test.ts`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { closeDb, type OrgId } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import { homePage } from '../../shared/api-contract'
import type { DomainScope } from '../../shared/domain-scopes'
import { PROMINENT_DAYS } from '../../shared/staffing'
import type { DayString } from '../../shared/time'
import { setEmailTransport } from '../email'
import { anonymousContext, currentOrgId } from '../request-context'
import { addDays, today } from '../time'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FIELD_BARN = '00000000-0000-0000-0000-0000000000b0'
const TIME_ZONE = 'America/New_York'

describe.skipIf(!reachable)('The home screen, through the API', () => {
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

  /** Nobody: a request carrying no session, which is what a signed-out phone is. */
  function apiAsNobody() {
    return buildApi({ idempotency: postgresIdempotency(), context: anonymousContext })
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
    // Escalating mails the Scope's holders, and the transport is process-wide:
    // left set, one test's collector would still be the sender in the next.
    setEmailTransport(null)
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
    await owner`delete from announcements where org_id = ${FIELD_BARN}`
    await owner`delete from audit_entries where org_id = ${FIELD_BARN}`
    await owner`delete from shift_roster where org_id = ${FIELD_BARN}`
    await owner`delete from shifts where org_id = ${FIELD_BARN}`
    await owner`delete from shift_pattern_roster where org_id = ${FIELD_BARN}`
    await owner`delete from shift_patterns where org_id = ${FIELD_BARN}`
    await owner`delete from horses where org_id = ${FIELD_BARN}`
    await owner`delete from medication_authority where org_id = ${FIELD_BARN}`
    await owner`delete from volunteer_roles where org_id = ${FIELD_BARN}`
    await owner`delete from release_signatures where org_id = ${FIELD_BARN}`
    await owner`delete from release_versions where org_id = ${FIELD_BARN}`
    await owner`delete from volunteer_consents where org_id = ${FIELD_BARN}`
    await owner`delete from idempotency_keys where org_id = ${FIELD_BARN}`
    await owner`delete from volunteers where org_id = ${FIELD_BARN}`
    if (!keepOrg) await owner`delete from orgs where id = ${FIELD_BARN}`
  }

  function day(): DayString {
    return today(TIME_ZONE)
  }

  function inDays(ahead: number): DayString {
    return addDays(day(), ahead, TIME_ZONE)
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

  function addressOf(name: string): string {
    return `${name.toLowerCase().replace(/\s/g, '-')}-${newIdempotencyKey()}@barn.test`
  }

  /** Fully rosterable: oriented, and holding a current signature (#34's gates). */
  async function volunteer(name: string): Promise<string> {
    const volunteerId = await candidate(name, { orientedOn: day() })
    await owner`
      insert into release_signatures
        (id, org_id, volunteer_id, release_version_id, signed_on, by_parent, recorded_by)
      values (gen_random_uuid(), ${FIELD_BARN}, ${volunteerId}, ${await releaseVersion()},
              ${day()}, false, ${volunteerId})
    `
    return volunteerId
  }

  /** Somebody the barn knows and has not oriented — the one gate a Cover stands at. */
  async function candidate(
    name: string,
    { orientedOn = null }: { orientedOn?: DayString | null } = {},
  ): Promise<string> {
    const [row] = await owner`
      insert into volunteers (id, org_id, name, email, date_of_birth, oriented_on)
      values (gen_random_uuid(), ${FIELD_BARN}, ${name}, ${addressOf(name)}, '1980-05-04',
              ${orientedOn})
      returning id
    `
    return String(row?.id)
  }

  /** The desk: creating a Shift and placing somebody on one are both behind `roster`. */
  async function desk() {
    return apiAs(await volunteer('Coordinator Cate'), ['roster'])
  }

  /**
   * A Pop-up on a chosen day, which is the shortest honest way to a Shift on a
   * date this file names — a Pattern would put the date in the calendar's hands
   * rather than the test's, and `/home` reads a Pop-up exactly as it reads any
   * other Shift (ADR 0011).
   */
  async function shiftOn(on: DayString, targetHeadcount = 2): Promise<string> {
    const created = await post(await desk(), '/shifts', {
      day: on,
      startTime: '13:00',
      targetHeadcount,
      purpose: 'Hose the horses down',
    })
    expect(created.status).toBe(201)
    return created.body.shiftId as string
  }

  async function rosterOnto(
    shiftId: string,
    volunteerId: string,
    position: 'lead' | 'volunteer' = 'volunteer',
  ): Promise<void> {
    const placed = await post(await desk(), '/shifts/roster', { shiftId, volunteerId, position })
    expect(placed.status).toBe(201)
  }

  /** Parsed against the contract, never asserted loosely: this schema is the promise (ADR 0021). */
  async function home(api: ReturnType<typeof apiAs>) {
    const read = await get(api, '/home')
    expect(read.status).toBe(200)
    return homePage.parse(read.body)
  }

  describe('the next Shift', () => {
    it('is the earliest of your own, with the rest counted behind it', async () => {
      const beth = await volunteer('Beth Ann')
      const soon = await shiftOn(inDays(1))
      const later = await shiftOn(inDays(3))
      await rosterOnto(soon, beth)
      await rosterOnto(later, beth)

      const page = await home(apiAs(beth, []))
      expect(page.nextShift).toMatchObject({ id: soon, day: inDays(1), more: 1 })
    })

    it('is null for somebody rostered on nothing, though the Shifts exist', async () => {
      await shiftOn(inDays(1))
      const valerie = await volunteer('Valerie Okonjo')

      expect((await home(apiAs(valerie, []))).nextShift).toBeNull()
    })

    it('is not a Shift you have Dropped — the marked row is not a commitment', async () => {
      const beth = await volunteer('Beth Ann')
      const shiftId = await shiftOn(inDays(1))
      await rosterOnto(shiftId, beth)

      const dropped = await post(apiAs(beth, []), '/shifts/drop', {
        shiftId,
        reason: 'away that week',
      })
      expect(dropped.status).toBe(204)

      // The row is still there, marked (ADR 0011) — what changed is that the
      // commitment ended, and the screen must not still be offering it.
      expect((await home(apiAs(beth, []))).nextShift).toBeNull()
    })

    it('is not a closed Shift, and moves on to the next open one', async () => {
      const lucy = await volunteer('Lead Lucy')
      const tonight = await shiftOn(day())
      const later = await shiftOn(inDays(3))
      await rosterOnto(tonight, lucy, 'lead')
      await rosterOnto(later, lucy)

      const closed = await post(apiAs(lucy, []), '/shifts/close', { shiftId: tonight })
      expect(closed.status).toBe(200)

      const page = await home(apiAs(lucy, []))
      expect(page.nextShift).toMatchObject({ id: later, more: 0 })
    })
  })

  describe('the wall', () => {
    it('carries what is still posted and not what has expired', async () => {
      const holder = apiAs(await volunteer('Head Welfare'), ['horse_care'])
      const posted = await post(holder, '/announcements', {
        text: 'The hay comes Thursday.',
        expiresOn: inDays(30),
      })
      expect(posted.status).toBe(201)
      await post(holder, '/announcements', { text: 'Long gone.', expiresOn: '2020-01-01' })

      const page = await home(apiAs(await volunteer('Beth Ann'), []))
      expect(page.announcements.map((announcement) => announcement.text)).toEqual([
        'The hay comes Thursday.',
      ])
    })
  })

  describe('Shifts needing cover', () => {
    it('offers what you are not on, and never a Shift you already stand on', async () => {
      const beth = await volunteer('Beth Ann')
      const hers = await shiftOn(inDays(1), 3)
      const theirs = await shiftOn(inDays(1))
      // Hers is short two of the three it wants and has no Lead, so it is
      // missing something by any reading — and is still not offered, because
      // Covering a Shift you stand on is what `coverShift` refuses.
      await rosterOnto(hers, beth)

      const page = await home(apiAs(beth, []))
      expect(page.cover.map((shift) => shift.id)).toEqual([theirs])
      expect(page.cover[0]).toMatchObject({ gaps: ['unstaffed'], standing: 0, targetHeadcount: 2 })
    })

    it('offers nothing at all to somebody with no Orientation', async () => {
      await shiftOn(inDays(1))
      const nora = await candidate('Nora Webb')

      // ADR 0011's one gate on a Cover. Offering work the server would refuse
      // is worse than offering none, so the whole section goes.
      expect((await home(apiAs(nora, []))).cover).toEqual([])
    })

    it('is roughly the next 48 hours for a Volunteer and the whole horizon for roster', async () => {
      const near = await shiftOn(inDays(PROMINENT_DAYS))
      const far = await shiftOn(inDays(PROMINENT_DAYS + 1))

      const valerie = await home(apiAs(await volunteer('Valerie Okonjo'), []))
      expect(valerie.cover.map((shift) => shift.id)).toEqual([near])

      const coordinator = await home(apiAs(await volunteer('Priya Chandra'), ['roster']))
      expect(coordinator.cover.map((shift) => shift.id).sort()).toEqual([near, far].sort())
    })
  })

  describe('open Escalations', () => {
    /**
     * An Observation about a horse, recorded on a Visit, adopted into a Scope
     * by a holder of it — the second of the two doors `escalateObservation`
     * opens, and the one that needs no Shift.
     */
    async function anEscalation(scope: DomainScope, holderId: string): Promise<string> {
      setEmailTransport(() => Promise.resolve())
      const joy = await volunteer('Joy Alderson')
      const signedIn = await post(apiAs(joy, []), '/attendance/sign-in', {
        volunteerId: joy,
        description: 'Checked on the horses',
        category: 'other',
      })
      expect(signedIn.status).toBe(201)

      const [horse] = await owner`
        insert into horses (id, org_id, name) values (gen_random_uuid(), ${FIELD_BARN}, 'Storm')
        returning id
      `
      const written = await post(apiAs(joy, []), '/observations', {
        text: 'The paddock gate latch is loose.',
        subjectKind: 'horse',
        subjectId: String(horse?.id),
      })
      expect(written.status).toBe(201)

      const escalated = await post(apiAs(holderId, [scope]), '/escalations', {
        observationId: written.body.observationId,
        scope,
        framing: 'Somebody with a wrench, before Saturday.',
      })
      expect(escalated.status).toBe(201)
      return escalated.body.escalationId as string
    }

    it('are the ones addressed to a Scope you hold, with the thread counted rather than carried', async () => {
      const terry = await volunteer('Terry Mott')
      const escalationId = await anEscalation('maintenance', terry)
      const commented = await post(apiAs(terry, ['maintenance']), '/escalations/comments', {
        escalationId,
        text: 'Picking up a latch on the way in.',
      })
      expect(commented.status).toBe(201)

      const page = await home(apiAs(terry, ['maintenance']))
      expect(page.escalations).toEqual([
        expect.objectContaining({
          id: escalationId,
          scope: 'maintenance',
          framing: 'Somebody with a wrench, before Saturday.',
          observationText: 'The paddock gate latch is loose.',
          observationSubjectLabel: 'Storm',
          comments: 1,
        }),
      ])
    })

    it('are none of a Volunteer holding no Scope, and none of a holder of another', async () => {
      await anEscalation('maintenance', await volunteer('Terry Mott'))

      expect((await home(apiAs(await volunteer('Beth Ann'), []))).escalations).toEqual([])
      const welfare = apiAs(await volunteer('Head Welfare'), ['horse_care'])
      expect((await home(welfare)).escalations).toEqual([])
    })

    it('drop off the moment the Scope closes one', async () => {
      const terry = await volunteer('Terry Mott')
      const escalationId = await anEscalation('maintenance', terry)

      const closed = await post(apiAs(terry, ['maintenance']), '/escalations/close', {
        escalationId,
        note: 'New latch fitted.',
      })
      expect(closed.status).toBe(204)

      expect((await home(apiAs(terry, ['maintenance']))).escalations).toEqual([])
    })
  })

  describe('who may read it', () => {
    it('refuses a signed-out request explicitly, the way /me does', async () => {
      // Never an empty page: on a phone that is indistinguishable from a
      // morning with nothing on it (ADR 0010).
      const read = await get(apiAsNobody(), '/home')
      expect(read.status).toBe(401)
      expect(read.body).toMatchObject({ error: 'not_authorized', wanted: 'read' })
    })
  })
})
