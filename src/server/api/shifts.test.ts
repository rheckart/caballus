/**
 * Shift Patterns, generation, Cover and Drop — through the API application's
 * own fetch entry (#32's testing decisions, #39).
 *
 * The two claims the ticket names are here, and both need a real database.
 * **Roster-copy semantics**: a Shift keeps the roster and start time it was
 * generated with, and a Pattern edited afterwards reaches it only when somebody
 * says so (ADR 0001). **Generation idempotency**: running it twice creates
 * nothing twice, which is `shiftsToGenerate` deciding and the unique index
 * holding — and only the index can be tested here.
 *
 * The pure arithmetic of *which occurrences a horizon wants* is
 * `src/shared/generation.test.ts` and is not retested.
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`,
 * then `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, type OrgId } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import { contract, shiftList, shiftPatternList } from '../../shared/api-contract'
import type { DomainScope } from '../../shared/domain-scopes'
import { HORIZON_DAYS } from '../../shared/shifts'
import type { DayString } from '../../shared/time'
import { forgetSendsForTest, setEmailTransport, type OutgoingEmail } from '../email'
import { anonymousContext, currentOrgId } from '../request-context'
import { addDays, today, weekdayOf } from '../time'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FIELD_BARN = '00000000-0000-0000-0000-0000000000ec'
const TIME_ZONE = 'America/New_York'

describe.skipIf(!reachable)('Shift Patterns and Shifts, through the API', () => {
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
    await owner`delete from audit_entries where org_id = ${FIELD_BARN}`
    await owner`delete from shift_roster where org_id = ${FIELD_BARN}`
    await owner`delete from shifts where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_lines where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_versions where org_id = ${FIELD_BARN}`
    await owner`delete from products where org_id = ${FIELD_BARN}`
    await owner`delete from horses where org_id = ${FIELD_BARN}`
    await owner`delete from medication_authority where org_id = ${FIELD_BARN}`
    await owner`delete from volunteer_roles where org_id = ${FIELD_BARN}`
    await owner`delete from shift_pattern_roster where org_id = ${FIELD_BARN}`
    await owner`delete from shift_patterns where org_id = ${FIELD_BARN}`
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

  /** A day inside the horizon, and what weekday it is in the barn's own zone. */
  function inHorizon(ahead: number): { day: DayString; weekday: string } {
    const at = addDays(day(), ahead, TIME_ZONE)
    return { day: at, weekday: weekdayOf(at, TIME_ZONE) }
  }

  /**
   * A Volunteer who passes every #34 gate: oriented, and holding a current
   * signature against the Release Version below. The gates are the roster's,
   * and this is the shortest honest way through them.
   */
  async function rosterableVolunteer(name: string): Promise<string> {
    const [row] = await owner`
      insert into volunteers (id, org_id, name, email, date_of_birth, oriented_on)
      values (gen_random_uuid(), ${FIELD_BARN}, ${name},
              ${`${name.toLowerCase().replace(/\s/g, '-')}-${newIdempotencyKey()}@barn.test`},
              '1980-05-04', ${day()})
      returning id
    `
    const volunteerId = String(row?.id)
    const versionId = await releaseVersion()
    await owner`
      insert into release_signatures
        (id, org_id, volunteer_id, release_version_id, signed_on, by_parent, recorded_by)
      values (gen_random_uuid(), ${FIELD_BARN}, ${volunteerId}, ${versionId}, ${day()}, false,
              ${await recorder()})
    `
    return volunteerId
  }

  /** Somebody the barn knows and has not oriented — the gate's own case. */
  async function candidate(name: string): Promise<string> {
    const [row] = await owner`
      insert into volunteers (id, org_id, name, email)
      values (gen_random_uuid(), ${FIELD_BARN}, ${name},
              ${`${name.toLowerCase().replace(/\s/g, '-')}-${newIdempotencyKey()}@barn.test`})
      returning id
    `
    return String(row?.id)
  }

  let recorderId: string | null = null

  /**
   * Whoever holds the paper. A release is never self-recorded, and the column
   * says so by being not-null — so the fixture needs somebody at the desk.
   */
  async function recorder(): Promise<string> {
    if (recorderId !== null) {
      const rows = await owner`
        select id from volunteers where id = ${recorderId} and org_id = ${FIELD_BARN}
      `
      if (rows.length > 0) return recorderId
    }
    const [row] = await owner`
      insert into volunteers (id, org_id, name, email, oriented_on)
      values (gen_random_uuid(), ${FIELD_BARN}, 'The desk',
              ${`desk-${newIdempotencyKey()}@barn.test`}, ${day()})
      returning id
    `
    recorderId = String(row?.id)
    return recorderId
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

  /** The Coordinator: every write below but Cover and Drop is behind `roster`. */
  async function coordinator() {
    const id = await rosterableVolunteer('Priya Chandra')
    return { api: apiAs(id, ['roster']), volunteerId: id }
  }

  async function patternOn(
    api: ReturnType<typeof apiAs>,
    weekday: string,
    extra: { startTime?: string; targetHeadcount?: number } = {},
  ): Promise<string> {
    const created = await post(api, '/shift-patterns', {
      weekday,
      shiftType: 'feed_am',
      startTime: extra.startTime ?? '06:30',
      targetHeadcount: extra.targetHeadcount ?? 3,
    })
    expect(created.status).toBe(201)
    return created.body.shiftPatternId as string
  }

  /**
   * The qualification, which is a grant on the Volunteer and not a position on
   * a Shift (ADR 0010). Inserted directly: conferring it is `horse_care`'s act
   * and is `roster.test.ts`'s subject, not this file's.
   */
  async function qualify(volunteerId: string): Promise<void> {
    await owner`
      insert into medication_authority (org_id, volunteer_id)
      values (${FIELD_BARN}, ${volunteerId})
    `
  }

  /**
   * A Feed AM schedule with a medication Product on it — which is what makes
   * *nobody who can give medication* a thing this Shift Type can be missing.
   * One horse is enough: the question is about the Shift Type's whole feeding.
   */
  async function feedingWithMedication(): Promise<void> {
    const [horse] = await owner`
      insert into horses (id, org_id, name)
      values (gen_random_uuid(), ${FIELD_BARN}, ${`Alfie ${newIdempotencyKey()}`})
      returning id
    `
    const [product] = await owner`
      insert into products (id, org_id, name, kind)
      values (gen_random_uuid(), ${FIELD_BARN}, 'Bute', 'medication')
      returning id
    `
    const [version] = await owner`
      insert into feed_schedule_versions (id, org_id, horse_id, shift_type, valid_from)
      values (gen_random_uuid(), ${FIELD_BARN}, ${String(horse?.id)}, 'feed_am', '2020-01-01')
      returning id
    `
    await owner`
      insert into feed_schedule_lines (id, org_id, version_id, product_id, amount, route)
      values (gen_random_uuid(), ${FIELD_BARN}, ${String(version?.id)}, ${String(product?.id)},
              '1 g', 'oral_syringe')
    `
  }

  async function schedule(api: ReturnType<typeof apiAs>) {
    const read = await get(api, '/shifts')
    expect(read.status).toBe(200)
    // Parsed against the contract, never asserted loosely: what the phone is
    // promised is this schema (ADR 0021).
    return shiftList.parse(read.body)
  }

  describe('the Patterns and their Standing Rosters', () => {
    it('creates a Pattern and generates nothing by doing so', async () => {
      const desk = await coordinator()
      await patternOn(desk.api, 'tuesday')

      const listed = shiftPatternList.parse((await get(desk.api, '/shift-patterns')).body)
      expect(listed.patterns).toHaveLength(1)
      expect(listed.patterns[0]).toMatchObject({ weekday: 'tuesday', startTime: '06:30' })
      expect((await schedule(desk.api)).shifts).toEqual([])
    })

    it('takes a rosterable Volunteer onto a Standing Roster', async () => {
      const desk = await coordinator()
      const patternId = await patternOn(desk.api, 'tuesday')
      const beth = await rosterableVolunteer('Beth Ann')

      const assigned = await post(desk.api, '/shift-patterns/roster', {
        shiftPatternId: patternId,
        volunteerId: beth,
        position: 'volunteer',
        applyToScheduled: false,
      })
      expect(assigned.status).toBe(200)

      const listed = shiftPatternList.parse((await get(desk.api, '/shift-patterns')).body)
      expect(listed.patterns[0]?.roster).toEqual([
        expect.objectContaining({ name: 'Beth Ann', position: 'volunteer', rosterable: true }),
      ])
    })

    it('refuses somebody the Orientation gate has not opened for — no override', async () => {
      const desk = await coordinator()
      const patternId = await patternOn(desk.api, 'tuesday')
      const newcomer = await candidate('Nora Webb')

      const refused = await post(desk.api, '/shift-patterns/roster', {
        shiftPatternId: patternId,
        volunteerId: newcomer,
        position: 'volunteer',
        applyToScheduled: false,
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('not_rosterable')
    })

    it('refuses a second Lead, and keeps letting there be none', async () => {
      const desk = await coordinator()
      const patternId = await patternOn(desk.api, 'tuesday')
      const beth = await rosterableVolunteer('Beth Ann')
      const valerie = await rosterableVolunteer('Valerie Okonjo')

      await post(desk.api, '/shift-patterns/roster', {
        shiftPatternId: patternId,
        volunteerId: beth,
        position: 'lead',
        applyToScheduled: false,
      })
      const refused = await post(desk.api, '/shift-patterns/roster', {
        shiftPatternId: patternId,
        volunteerId: valerie,
        position: 'lead',
        applyToScheduled: false,
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('lead_already_held')

      // Co-Lead is a different position and is not limited.
      const coLed = await post(desk.api, '/shift-patterns/roster', {
        shiftPatternId: patternId,
        volunteerId: valerie,
        position: 'co_lead',
        applyToScheduled: false,
      })
      expect(coLed.status).toBe(200)
    })

    it('lets every Volunteer read the Patterns and only `roster` write them', async () => {
      const desk = await coordinator()
      await patternOn(desk.api, 'tuesday')

      const volunteer = apiAs(await rosterableVolunteer('Beth Ann'), [])
      expect((await get(volunteer, '/shift-patterns')).status).toBe(200)

      const refused = await post(volunteer, '/shift-patterns', {
        weekday: 'friday',
        shiftType: 'feed_pm',
        startTime: '16:00',
        targetHeadcount: 3,
      })
      expect(refused.status).toBe(403)
    })
  })

  describe('a week of Patterns in one act', () => {
    it('creates one Pattern per weekday sent', async () => {
      const desk = await coordinator()

      const added = await post(desk.api, '/shift-patterns/batch', {
        shiftType: 'feed_am',
        weekdays: ['monday', 'tuesday', 'wednesday'],
        startTime: '06:30',
        targetHeadcount: 3,
      })

      expect(added.status).toBe(201)
      expect((added.body.shiftPatternIds as string[]).length).toBe(3)
      expect(added.body.skipped).toEqual([])

      const listed = shiftPatternList.parse((await get(desk.api, '/shift-patterns')).body)
      expect(listed.patterns.map((pattern) => pattern.weekday).sort()).toEqual([
        'monday',
        'tuesday',
        'wednesday',
      ])
      // The whole point of the composer: the time and the headcount are the
      // one thing that does not vary within a Shift Type.
      expect(listed.patterns.every((pattern) => pattern.startTime === '06:30')).toBe(true)
      expect(listed.patterns.every((pattern) => pattern.targetHeadcount === 3)).toBe(true)
    })

    it('is safe to press twice — the second run creates nothing and names every day', async () => {
      const desk = await coordinator()
      const week = {
        shiftType: 'feed_am',
        weekdays: ['monday', 'tuesday'],
        startTime: '06:30',
        targetHeadcount: 3,
      }

      await post(desk.api, '/shift-patterns/batch', week)
      // A fresh idempotency key, so this is the *skip* rule holding rather
      // than ADR 0020's replay: pressing the button again a week later must
      // behave the same as pressing it twice in a minute.
      const again = await post(desk.api, '/shift-patterns/batch', week)

      expect(again.body.shiftPatternIds).toEqual([])
      expect(again.body.skipped).toEqual(['monday', 'tuesday'])

      const listed = shiftPatternList.parse((await get(desk.api, '/shift-patterns')).body)
      expect(listed.patterns.length).toBe(2)
    })

    it('creates the days that are missing and leaves the held one exactly as it was', async () => {
      const desk = await coordinator()
      await patternOn(desk.api, 'monday', { startTime: '07:15', targetHeadcount: 5 })

      const added = await post(desk.api, '/shift-patterns/batch', {
        shiftType: 'feed_am',
        weekdays: ['monday', 'tuesday', 'wednesday'],
        startTime: '06:30',
        targetHeadcount: 3,
      })

      expect((added.body.shiftPatternIds as string[]).length).toBe(2)
      expect(added.body.skipped).toEqual(['monday'])

      const listed = shiftPatternList.parse((await get(desk.api, '/shift-patterns')).body)
      const monday = listed.patterns.find((pattern) => pattern.weekday === 'monday')
      // Skipped means left alone: this write creates, and moving an existing
      // Pattern is `/shift-patterns/edit`'s act with its own prompt (ADR 0001).
      expect(monday?.startTime).toBe('07:15')
      expect(monday?.targetHeadcount).toBe(5)
    })

    it('does not skip a weekday whose only Pattern of that type is retired', async () => {
      const desk = await coordinator()
      const stopped = await patternOn(desk.api, 'monday')
      await post(desk.api, '/shift-patterns/retirement', {
        shiftPatternId: stopped,
        retired: true,
      })

      const added = await post(desk.api, '/shift-patterns/batch', {
        shiftType: 'feed_am',
        weekdays: ['monday'],
        startTime: '06:30',
        targetHeadcount: 3,
      })

      // Retirement means *make a new one if you need one*, as it does for a
      // Product and a Space; un-retiring is a person's own deliberate act and
      // a bulk add must not do it behind their back.
      expect((added.body.shiftPatternIds as string[]).length).toBe(1)
      expect(added.body.skipped).toEqual([])

      const listed = shiftPatternList.parse((await get(desk.api, '/shift-patterns')).body)
      expect(listed.patterns.filter((pattern) => pattern.retired).length).toBe(1)
      expect(listed.patterns.filter((pattern) => !pattern.retired).length).toBe(1)
    })

    it('does not skip a weekday held only by a different Shift Type', async () => {
      const desk = await coordinator()
      await patternOn(desk.api, 'monday')

      const added = await post(desk.api, '/shift-patterns/batch', {
        shiftType: 'lunch',
        weekdays: ['monday'],
        startTime: '12:00',
        targetHeadcount: 1,
      })

      expect(added.body.skipped).toEqual([])
      expect((added.body.shiftPatternIds as string[]).length).toBe(1)
    })

    it('records one audit entry per created Pattern and no batch record', async () => {
      const desk = await coordinator()

      await post(desk.api, '/shift-patterns/batch', {
        shiftType: 'feed_am',
        weekdays: ['monday', 'tuesday', 'wednesday'],
        startTime: '06:30',
        targetHeadcount: 3,
      })

      const entries = await owner`
        select entity from audit_entries
        where org_id = ${FIELD_BARN} and entity = 'shift_pattern'
      `
      // The created records are the log (#59). Three Patterns, three entries,
      // and nothing that would become a fifth hand-rolled table (ADR 0019).
      expect(entries.length).toBe(3)
    })

    it('refuses a plain Volunteer, like every other Pattern write', async () => {
      const plain = await rosterableVolunteer('Sam Okafor')

      const refused = await post(apiAs(plain, []), '/shift-patterns/batch', {
        shiftType: 'feed_am',
        weekdays: ['monday'],
        startTime: '06:30',
        targetHeadcount: 3,
      })

      expect(refused.status).toBe(403)
    })

    it('refuses a second live Pattern for the same weekday and Shift Type at the table', async () => {
      const desk = await coordinator()
      await patternOn(desk.api, 'monday')

      // The index rather than the batch: the single-add door has always allowed
      // this by accident, and two Monday mornings is a Board showing the barn a
      // morning it does not have.
      await expect(
        owner`
          insert into shift_patterns (id, org_id, weekday, shift_type, start_time, target_headcount)
          values (gen_random_uuid(), ${FIELD_BARN}, 'monday', 'feed_am', '06:30', 3)
        `,
      ).rejects.toThrow()
    })
  })

  describe('generation', () => {
    it('fills the horizon, copying the roster and the start time', async () => {
      const desk = await coordinator()
      const tuesday = inHorizon(1).weekday
      const patternId = await patternOn(desk.api, tuesday, { startTime: '06:30' })
      const beth = await rosterableVolunteer('Beth Ann')
      await post(desk.api, '/shift-patterns/roster', {
        shiftPatternId: patternId,
        volunteerId: beth,
        position: 'lead',
        applyToScheduled: false,
      })

      const generated = await post(desk.api, '/shifts/generation')
      expect(generated.status).toBe(201)
      // A fortnight holds two of any weekday.
      expect(generated.body.created).toBe(2)
      expect(generated.body.through).toBe(addDays(day(), HORIZON_DAYS - 1, TIME_ZONE))

      const listed = await schedule(desk.api)
      expect(listed.shifts).toHaveLength(2)
      expect(listed.shifts[0]).toMatchObject({
        patternId,
        shiftType: 'feed_am',
        startTime: '06:30',
        staffingMode: 'standing_roster',
        targetHeadcount: 3,
      })
      // The copy: the roster is on the Shift, not resolved from the Pattern.
      expect(listed.shifts[0]?.roster).toEqual([
        expect.objectContaining({ name: 'Beth Ann', position: 'lead', origin: 'standing_roster' }),
      ])
    })

    it('creates nothing the second time it runs', async () => {
      const desk = await coordinator()
      await patternOn(desk.api, inHorizon(2).weekday)

      const first = await post(desk.api, '/shifts/generation')
      const second = await post(desk.api, '/shifts/generation')

      expect(first.body.created).toBe(2)
      expect(second.body.created).toBe(0)
      expect((await schedule(desk.api)).shifts).toHaveLength(2)
    })

    it('generates nothing at all when there are no Patterns', async () => {
      const desk = await coordinator()
      const generated = await post(desk.api, '/shifts/generation')
      expect(generated.body.created).toBe(0)
    })

    it('copies somebody who has gone stale, rather than dropping them', async () => {
      // ADR 0011 rejected gating at generation outright: an assignment that
      // silently evaporates a fortnight later is the quiet wrongness ADR 0001's
      // prompt exists to prevent. She arrives on the Shift flagged instead.
      const desk = await coordinator()
      const patternId = await patternOn(desk.api, inHorizon(3).weekday)
      const beth = await rosterableVolunteer('Beth Ann')
      await post(desk.api, '/shift-patterns/roster', {
        shiftPatternId: patternId,
        volunteerId: beth,
        position: 'volunteer',
        applyToScheduled: false,
      })

      // Her release is revoked after the assignment and before generation.
      await owner`
        update release_signatures set revoked_at = now()
        where org_id = ${FIELD_BARN} and volunteer_id = ${beth}
      `

      await post(desk.api, '/shifts/generation')
      const listed = await schedule(desk.api)
      expect(listed.shifts[0]?.roster).toEqual([
        expect.objectContaining({
          name: 'Beth Ann',
          rosterable: false,
          gaps: ['no_current_release'],
        }),
      ])
    })
  })

  describe('editing a Pattern', () => {
    it('leaves the Shifts already generated alone when the answer is no', async () => {
      const desk = await coordinator()
      const patternId = await patternOn(desk.api, inHorizon(1).weekday, { startTime: '06:30' })
      await post(desk.api, '/shifts/generation')

      const edited = await post(desk.api, '/shift-patterns/edit', {
        shiftPatternId: patternId,
        startTime: '07:00',
        applyToScheduled: false,
      })
      expect(edited.body.scheduledTouched).toBe(0)

      const listed = await schedule(desk.api)
      // The copy is the point: what was planned stays what was planned.
      expect(listed.shifts.map((shift) => shift.startTime)).toEqual(['06:30', '06:30'])

      const patterns = shiftPatternList.parse((await get(desk.api, '/shift-patterns')).body)
      expect(patterns.patterns[0]?.startTime).toBe('07:00')
    })

    it('moves them when the answer is yes', async () => {
      const desk = await coordinator()
      const patternId = await patternOn(desk.api, inHorizon(1).weekday, { startTime: '06:30' })
      await post(desk.api, '/shifts/generation')

      const edited = await post(desk.api, '/shift-patterns/edit', {
        shiftPatternId: patternId,
        startTime: '07:00',
        applyToScheduled: true,
      })
      expect(edited.body.scheduledTouched).toBe(2)
      expect((await schedule(desk.api)).shifts.map((shift) => shift.startTime)).toEqual([
        '07:00',
        '07:00',
      ])
    })

    it('carries a roster change forward only when asked', async () => {
      const desk = await coordinator()
      const patternId = await patternOn(desk.api, inHorizon(1).weekday)
      await post(desk.api, '/shifts/generation')
      const valerie = await rosterableVolunteer('Valerie Okonjo')

      const notYet = await post(desk.api, '/shift-patterns/roster', {
        shiftPatternId: patternId,
        volunteerId: valerie,
        position: 'volunteer',
        applyToScheduled: false,
      })
      expect(notYet.body.scheduledTouched).toBe(0)
      expect((await schedule(desk.api)).shifts[0]?.roster).toEqual([])

      const carried = await post(desk.api, '/shift-patterns/roster', {
        shiftPatternId: patternId,
        volunteerId: valerie,
        position: 'volunteer',
        applyToScheduled: true,
      })
      expect(carried.body.scheduledTouched).toBe(2)
      expect((await schedule(desk.api)).shifts[0]?.roster).toHaveLength(1)
    })

    it('does not overrule a volunteer who has already dropped', async () => {
      const desk = await coordinator()
      const patternId = await patternOn(desk.api, inHorizon(1).weekday)
      const beth = await rosterableVolunteer('Beth Ann')
      await post(desk.api, '/shift-patterns/roster', {
        shiftPatternId: patternId,
        volunteerId: beth,
        position: 'volunteer',
        applyToScheduled: false,
      })
      await post(desk.api, '/shifts/generation')

      const listed = await schedule(desk.api)
      const shiftId = listed.shifts[0]?.id ?? ''
      const hers = apiAs(beth, [])
      await post(hers, '/shifts/drop', { shiftId, reason: 'away that week' })

      await post(desk.api, '/shift-patterns/roster', {
        shiftPatternId: patternId,
        volunteerId: beth,
        position: 'co_lead',
        applyToScheduled: true,
      })

      const after = await schedule(desk.api)
      expect(after.shifts[0]?.roster[0]).toMatchObject({
        endedAs: 'dropped',
        position: 'volunteer',
      })
    })
  })

  describe('what the review found', () => {
    it('never makes a second Lead by carrying a Pattern change forward', async () => {
      const desk = await coordinator()
      const patternId = await patternOn(desk.api, inHorizon(1).weekday)
      await post(desk.api, '/shifts/generation')
      const ann = await rosterableVolunteer('Ann Petrov')
      const beth = await rosterableVolunteer('Beth Ann')

      // Ann is Lead of next Thursday alone, by hand.
      const listed = await schedule(desk.api)
      const shiftId = listed.shifts[0]?.id ?? ''
      await post(desk.api, '/shifts/roster', { shiftId, volunteerId: ann, position: 'lead' })

      // The Pattern then gains Beth as its Lead, carried forward.
      const carried = await post(desk.api, '/shift-patterns/roster', {
        shiftPatternId: patternId,
        volunteerId: beth,
        position: 'lead',
        applyToScheduled: true,
      })
      // The other Shift takes her; Ann's does not, and it says so.
      expect(carried.body).toMatchObject({ scheduledTouched: 1, leadHeldOn: 1 })

      const after = await schedule(desk.api)
      const leads = (after.shifts.find((each) => each.id === shiftId)?.roster ?? []).filter(
        (member) => member.position === 'lead' && member.endedAs === null,
      )
      expect(leads.map((member) => member.name)).toEqual(['Ann Petrov'])
    })

    it('takes somebody off every roster when they leave the rescue', async () => {
      const desk = await coordinator()
      const patternId = await patternOn(desk.api, inHorizon(1).weekday)
      const beth = await rosterableVolunteer('Beth Ann')
      await post(desk.api, '/shift-patterns/roster', {
        shiftPatternId: patternId,
        volunteerId: beth,
        position: 'volunteer',
        applyToScheduled: true,
      })
      await post(desk.api, '/shifts/generation')

      const removed = await post(desk.api, '/volunteers/removal', {
        volunteerId: beth,
        reason: 'moved away',
      })
      expect(removed.status).toBe(204)

      // Off the Standing Roster, so nothing generates her onto a Shift again…
      const patterns = shiftPatternList.parse((await get(desk.api, '/shift-patterns')).body)
      expect(patterns.patterns[0]?.roster).toEqual([])

      // …and marked rather than deleted on the Shifts that already exist.
      const listed = await schedule(desk.api)
      expect(listed.shifts[0]?.roster[0]).toMatchObject({ name: 'Beth Ann', endedAs: 'removed' })

      const generated = await post(desk.api, '/shifts/generation')
      expect(generated.body.created).toBe(0)
    })

    it('stops generating a Pattern that has been retired, and keeps its Shifts', async () => {
      const desk = await coordinator()
      const patternId = await patternOn(desk.api, inHorizon(1).weekday)
      await post(desk.api, '/shifts/generation')

      const retired = await post(desk.api, '/shift-patterns/retirement', {
        shiftPatternId: patternId,
        retired: true,
      })
      expect(retired.status).toBe(204)

      // What it already made stands — *what were the Tuesday mornings before we
      // stopped* is still answerable.
      expect((await schedule(desk.api)).shifts).toHaveLength(2)

      await owner`delete from shifts where org_id = ${FIELD_BARN}`
      const again = await post(desk.api, '/shifts/generation')
      expect(again.body.created).toBe(0)

      await post(desk.api, '/shift-patterns/retirement', {
        shiftPatternId: patternId,
        retired: false,
      })
      expect((await post(desk.api, '/shifts/generation')).body.created).toBe(2)
    })

    it('writes no audit entry for a start time nobody changed', async () => {
      const desk = await coordinator()
      const patternId = await patternOn(desk.api, inHorizon(1).weekday, { startTime: '06:30' })

      // The form always posts the time it read back, which Postgres answered as
      // `06:30:00`. Changing only the headcount must not log a time change.
      await post(desk.api, '/shift-patterns/edit', {
        shiftPatternId: patternId,
        startTime: '06:30',
        targetHeadcount: 4,
        applyToScheduled: false,
      })

      const entries = await owner`
        select field from audit_entries
        where org_id = ${FIELD_BARN} and entity = 'shift_pattern' and field is not null
      `
      expect(entries.map((row) => String(row.field))).toEqual(['target_headcount'])
    })

    it('records a hand placement as assigned rather than as a copy', async () => {
      const desk = await coordinator()
      await patternOn(desk.api, inHorizon(1).weekday)
      await post(desk.api, '/shifts/generation')
      const shiftId = (await schedule(desk.api)).shifts[0]?.id ?? ''
      const beth = await rosterableVolunteer('Beth Ann')

      await post(desk.api, '/shifts/roster', {
        shiftId,
        volunteerId: beth,
        position: 'volunteer',
      })
      expect((await schedule(desk.api)).shifts[0]?.roster[0]?.origin).toBe('assigned')

      // And the Coordinator may move her position in place, rather than
      // recording a removal that never happened.
      const moved = await post(desk.api, '/shifts/roster', {
        shiftId,
        volunteerId: beth,
        position: 'co_lead',
      })
      expect(moved.status).toBe(201)
      expect((await schedule(desk.api)).shifts[0]?.roster[0]).toMatchObject({
        position: 'co_lead',
        endedAs: null,
      })
    })

    it('refuses a Cover on a day that is already over', async () => {
      const desk = await coordinator()
      const created = await post(desk.api, '/shifts', {
        day: addDays(day(), 1, TIME_ZONE),
        startTime: '13:00',
        targetHeadcount: 2,
        purpose: 'Welfare check',
      })
      const shiftId = created.body.shiftId as string
      // Moved into the past behind the app's back, which is the only way to get
      // one there while nothing closes a Shift.
      await owner`
        update shifts set day = ${addDays(day(), -2, TIME_ZONE)}
        where id = ${shiftId} and org_id = ${FIELD_BARN}
      `

      const hers = apiAs(await rosterableVolunteer('Valerie Okonjo'), [])
      const refused = await post(hers, '/shifts/cover', { shiftId })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('shift_is_over')
    })
  })

  describe('Drop', () => {
    async function rostered() {
      const desk = await coordinator()
      const patternId = await patternOn(desk.api, inHorizon(1).weekday)
      const beth = await rosterableVolunteer('Beth Ann')
      await post(desk.api, '/shift-patterns/roster', {
        shiftPatternId: patternId,
        volunteerId: beth,
        position: 'volunteer',
        applyToScheduled: false,
      })
      await post(desk.api, '/shifts/generation')
      const listed = await schedule(desk.api)
      return { desk, patternId, beth, shiftId: listed.shifts[0]?.id ?? '' }
    }

    it('marks the row rather than removing it, and keeps the reason', async () => {
      const { desk, beth, shiftId } = await rostered()

      const dropped = await post(apiAs(beth, []), '/shifts/drop', {
        shiftId,
        reason: 'away that week',
      })
      expect(dropped.status).toBe(204)

      const listed = await schedule(desk.api)
      expect(listed.shifts[0]?.roster[0]).toMatchObject({
        name: 'Beth Ann',
        endedAs: 'dropped',
        endedReason: 'away that week',
      })
      // Rostered-and-dropped is not never-rostered: the row is still there.
      expect(listed.shifts[0]?.roster).toHaveLength(1)
    })

    it('touches only that Shift, and never the Pattern behind it', async () => {
      const { desk, patternId, beth, shiftId } = await rostered()
      await post(apiAs(beth, []), '/shifts/drop', { shiftId })

      const listed = await schedule(desk.api)
      expect(listed.shifts[1]?.roster[0]?.endedAs).toBeNull()

      const patterns = shiftPatternList.parse((await get(desk.api, '/shift-patterns')).body)
      expect(patterns.patterns.find((pattern) => pattern.id === patternId)?.roster).toHaveLength(1)
    })

    it('needs no Domain Scope, because saying you cannot come is not authority', async () => {
      const { beth, shiftId } = await rostered()
      const hers = apiAs(beth, [])
      expect((await post(hers, '/shifts/drop', { shiftId })).status).toBe(204)
    })

    it('refuses a Drop from somebody who was never on it', async () => {
      const { shiftId } = await rostered()
      const stranger = apiAs(await rosterableVolunteer('Valerie Okonjo'), [])
      const refused = await post(stranger, '/shifts/drop', { shiftId })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('not_rostered')
    })
  })

  describe('Cover', () => {
    async function aShift() {
      const desk = await coordinator()
      await patternOn(desk.api, inHorizon(1).weekday)
      await post(desk.api, '/shifts/generation')
      const listed = await schedule(desk.api)
      return { desk, shiftId: listed.shifts[0]?.id ?? '' }
    }

    it('lands on the roster immediately, as a volunteer and marked as a Cover', async () => {
      const { desk, shiftId } = await aShift()
      const valerie = await rosterableVolunteer('Valerie Okonjo')

      const covered = await post(apiAs(valerie, []), '/shifts/cover', { shiftId })
      expect(covered.status).toBe(201)

      const listed = await schedule(desk.api)
      expect(listed.shifts[0]?.roster[0]).toMatchObject({
        name: 'Valerie Okonjo',
        position: 'volunteer',
        origin: 'cover',
        endedAs: null,
      })
    })

    it('takes somebody an unrelated gate is open on, and never refuses for what they lack', async () => {
      // ADR 0011: a Shift needing medication still takes somebody who cannot
      // give it. The release gap is flagged on the row and refuses nothing.
      const { desk, shiftId } = await aShift()
      const valerie = await rosterableVolunteer('Valerie Okonjo')
      await owner`
        update release_signatures set revoked_at = now()
        where org_id = ${FIELD_BARN} and volunteer_id = ${valerie}
      `

      const covered = await post(apiAs(valerie, []), '/shifts/cover', { shiftId })
      expect(covered.status).toBe(201)

      const listed = await schedule(desk.api)
      expect(listed.shifts[0]?.roster[0]).toMatchObject({
        rosterable: false,
        gaps: ['no_current_release'],
        origin: 'cover',
      })
    })

    it('refuses somebody with no Orientation, which is the one gate on it', async () => {
      const { shiftId } = await aShift()
      const newcomer = await candidate('Nora Webb')
      const refused = await post(apiAs(newcomer, []), '/shifts/cover', { shiftId })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('no_orientation')
    })

    it('brings back a row that was dropped rather than counting the person twice', async () => {
      const { desk, shiftId } = await aShift()
      const valerie = await rosterableVolunteer('Valerie Okonjo')
      const hers = apiAs(valerie, [])

      await post(hers, '/shifts/cover', { shiftId })
      await post(hers, '/shifts/drop', { shiftId, reason: 'changed my mind' })
      const again = await post(hers, '/shifts/cover', { shiftId })
      expect(again.status).toBe(201)

      const listed = await schedule(desk.api)
      expect(listed.shifts[0]?.roster).toHaveLength(1)
      expect(listed.shifts[0]?.roster[0]).toMatchObject({ endedAs: null, origin: 'cover' })
    })

    it('refuses a second Cover while the first still stands', async () => {
      const { shiftId } = await aShift()
      const hers = apiAs(await rosterableVolunteer('Valerie Okonjo'), [])
      await post(hers, '/shifts/cover', { shiftId })
      const twice = await post(hers, '/shifts/cover', { shiftId })
      expect(twice.status).toBe(409)
      expect(twice.body.error).toBe('already_rostered')
    })
  })

  describe('a Pop-up', () => {
    it('is a Shift like any other, staffed by Sign-up', async () => {
      const desk = await coordinator()
      const created = await post(desk.api, '/shifts', {
        day: addDays(day(), 1, TIME_ZONE),
        startTime: '13:00',
        targetHeadcount: 2,
        purpose: 'Hose the horses down — 96 today',
      })
      expect(created.status).toBe(201)

      const listed = await schedule(desk.api)
      expect(listed.shifts[0]).toMatchObject({
        patternId: null,
        shiftType: 'pop_up',
        staffingMode: 'sign_up',
        purpose: 'Hose the horses down — 96 today',
      })

      // The same Cover flow, nothing bespoke (ADR 0011).
      const valerie = await rosterableVolunteer('Valerie Okonjo')
      const covered = await post(apiAs(valerie, []), '/shifts/cover', {
        shiftId: listed.shifts[0]?.id ?? '',
      })
      expect(covered.status).toBe(201)
    })

    it('does not stop a Pattern generating on the same day', async () => {
      const desk = await coordinator()
      await patternOn(desk.api, inHorizon(1).weekday)
      await post(desk.api, '/shifts', {
        day: addDays(day(), 1, TIME_ZONE),
        startTime: '13:00',
        targetHeadcount: 2,
        purpose: 'Welfare check',
      })

      const generated = await post(desk.api, '/shifts/generation')
      expect(generated.body.created).toBe(2)
    })
  })

  describe('what a Shift is missing, and what a person declared about it', () => {
    /** A Shift tomorrow, generated from a Pattern wanting three people. */
    async function aShift(extra: { targetHeadcount?: number } = {}) {
      const desk = await coordinator()
      await patternOn(desk.api, inHorizon(1).weekday, {
        targetHeadcount: extra.targetHeadcount ?? 3,
      })
      await post(desk.api, '/shifts/generation')
      const listed = await schedule(desk.api)
      return { desk, shiftId: listed.shifts[0]?.id ?? '' }
    }

    async function onIt(
      desk: Awaited<ReturnType<typeof coordinator>>,
      shiftId: string,
      name: string,
      position: string,
    ) {
      const volunteerId = await rosterableVolunteer(name)
      const placed = await post(desk.api, '/shifts/roster', { shiftId, volunteerId, position })
      expect(placed.status).toBe(201)
      return volunteerId
    }

    async function staffingOf(desk: Awaited<ReturnType<typeof coordinator>>, shiftId: string) {
      const listed = await schedule(desk.api)
      return listed.shifts.find((shift) => shift.id === shiftId)
    }

    it('says nobody at all, and nothing else, for an empty Shift', async () => {
      const { desk, shiftId } = await aShift()
      // Unstaffed is every other gap at once, and four facts about an empty
      // Shift is one fact spelled four times (ADR 0011).
      expect((await staffingOf(desk, shiftId))?.staffing.gaps).toEqual(['unstaffed'])
    })

    it('leaves an Unstaffed Shift on the schedule rather than removing it', async () => {
      const { desk, shiftId } = await aShift()
      const listed = await schedule(desk.api)
      expect(listed.shifts.map((shift) => shift.id)).toContain(shiftId)
    })

    it('says no Lead and below target for a Shift with one volunteer on it', async () => {
      const { desk, shiftId } = await aShift()
      await onIt(desk, shiftId, 'Beth Ann', 'volunteer')

      expect((await staffingOf(desk, shiftId))?.staffing.gaps).toEqual([
        'no_lead',
        'below_target_headcount',
      ])
    })

    it('says nobody who can give medication only where the feeding needs it', async () => {
      const { desk, shiftId } = await aShift({ targetHeadcount: 1 })
      await onIt(desk, shiftId, 'Beth Ann', 'lead')
      expect((await staffingOf(desk, shiftId))?.staffing.gaps).toEqual([])

      await feedingWithMedication()
      expect((await staffingOf(desk, shiftId))?.staffing.gaps).toEqual(['no_medication_authority'])
    })

    it('takes the qualification from anybody rostered, Lead or not', async () => {
      const { desk, shiftId } = await aShift({ targetHeadcount: 1 })
      await feedingWithMedication()
      const valerie = await onIt(desk, shiftId, 'Valerie Okonjo', 'volunteer')
      expect((await staffingOf(desk, shiftId))?.staffing.gaps).toContain('no_medication_authority')

      await qualify(valerie)
      expect((await staffingOf(desk, shiftId))?.staffing.gaps).not.toContain(
        'no_medication_authority',
      )
    })

    it('still takes a Cover from somebody who cannot give it, and still says what it needs', async () => {
      // ADR 0011's sharpest instruction about this surface: turning away
      // somebody who is offering to come is the worst thing it could do.
      const { desk, shiftId } = await aShift({ targetHeadcount: 1 })
      await feedingWithMedication()
      const nora = await rosterableVolunteer('Nora Webb')

      const covered = await post(apiAs(nora, []), '/shifts/cover', { shiftId })
      expect(covered.status).toBe(201)

      const shift = await staffingOf(desk, shiftId)
      expect(shift?.roster[0]).toMatchObject({ origin: 'cover', medicationAuthority: false })
      expect(shift?.staffing.gaps).toContain('no_medication_authority')
    })
  })

  describe('Acting Lead', () => {
    async function leaderless() {
      const desk = await coordinator()
      await patternOn(desk.api, inHorizon(1).weekday, { targetHeadcount: 2 })
      await post(desk.api, '/shifts/generation')
      const shiftId = (await schedule(desk.api)).shifts[0]?.id ?? ''
      const beth = await rosterableVolunteer('Beth Ann')
      await post(desk.api, '/shifts/roster', { shiftId, volunteerId: beth, position: 'volunteer' })
      return { desk, shiftId, beth }
    }

    it('is claimed explicitly by a rostered volunteer, and stays distinct from Lead', async () => {
      const { desk, shiftId, beth } = await leaderless()

      const claimed = await post(apiAs(beth, []), '/shifts/acting-lead', { shiftId })
      expect(claimed.status).toBe(201)

      const listed = await schedule(desk.api)
      const shift = listed.shifts.find((one) => one.id === shiftId)
      // `acting_lead`, never `lead`: *this Shift had no real Lead* has to stay
      // answerable afterwards (ADR 0010).
      expect(shift?.roster[0]?.position).toBe('acting_lead')
      expect(shift?.staffing.gaps).not.toContain('no_lead')
    })

    it('confers no Medication Authority', async () => {
      const { desk, shiftId, beth } = await leaderless()
      await feedingWithMedication()
      await post(apiAs(beth, []), '/shifts/acting-lead', { shiftId })

      const shift = (await schedule(desk.api)).shifts.find((one) => one.id === shiftId)
      expect(shift?.roster[0]).toMatchObject({
        position: 'acting_lead',
        medicationAuthority: false,
      })
      expect(shift?.staffing.gaps).toContain('no_medication_authority')
    })

    it('suggests Medication Authority first, and takes the claim from anybody rostered', async () => {
      const { desk, shiftId, beth } = await leaderless()
      const valerie = await rosterableVolunteer('Valerie Okonjo')
      await post(desk.api, '/shifts/roster', {
        shiftId,
        volunteerId: valerie,
        position: 'volunteer',
      })
      await qualify(valerie)

      const suggested = (await schedule(desk.api)).shifts.find((one) => one.id === shiftId)
      expect(suggested?.staffing.suggestedActingLead).toBe(valerie)

      // A suggestion and not a restriction: Beth claims it anyway, because
      // restricting the claim leaves a Shift leaderless exactly when the
      // suggested person did not show (ADR 0010).
      expect((await post(apiAs(beth, []), '/shifts/acting-lead', { shiftId })).status).toBe(201)
    })

    it('refuses somebody who is not on the Shift', async () => {
      const { shiftId } = await leaderless()
      const stranger = await rosterableVolunteer('Nora Webb')
      const refused = await post(apiAs(stranger, []), '/shifts/acting-lead', { shiftId })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('not_rostered')
    })

    it('refuses a claim on a Shift that already has a Lead', async () => {
      const { desk, shiftId, beth } = await leaderless()
      const valerie = await rosterableVolunteer('Valerie Okonjo')
      await post(desk.api, '/shifts/roster', { shiftId, volunteerId: valerie, position: 'lead' })

      const refused = await post(apiAs(beth, []), '/shifts/acting-lead', { shiftId })
      expect(refused.status).toBe(409)
      // Its own refusal, not the Coordinator's `lead_already_held` — whose
      // advice is "take them off first", which a volunteer in a barn cannot do.
      expect(refused.body.error).toBe('already_led')
      expect((await schedule(desk.api)).shifts[0]?.staffing.suggestedActingLead).toBeNull()
    })
  })

  describe('Short, which is declared and never derived', () => {
    async function aShift() {
      const desk = await coordinator()
      await patternOn(desk.api, inHorizon(1).weekday, { targetHeadcount: 3 })
      await post(desk.api, '/shifts/generation')
      const shiftId = (await schedule(desk.api)).shifts[0]?.id ?? ''
      return { desk, shiftId }
    }

    it('is recorded with actor and time, and cleared by a person', async () => {
      const { desk, shiftId } = await aShift()

      expect((await post(desk.api, '/shifts/short', { shiftId, short: true })).status).toBe(204)
      const declared = (await schedule(desk.api)).shifts.find((one) => one.id === shiftId)
      expect(declared?.short).toMatchObject({ declaredBy: desk.volunteerId })
      expect(typeof declared?.short?.declaredAt).toBe('number')

      expect((await post(desk.api, '/shifts/short', { shiftId, short: false })).status).toBe(204)
      expect((await schedule(desk.api)).shifts.find((one) => one.id === shiftId)?.short).toBeNull()
    })

    it('is never declared or withdrawn by arithmetic', async () => {
      const { desk, shiftId } = await aShift()
      // Three of three, nothing missing — and still not Short, because the app
      // does not have an opinion about it (ADR 0011).
      for (const name of ['Beth Ann', 'Valerie Okonjo', 'Nora Webb']) {
        const volunteerId = await rosterableVolunteer(name)
        await post(desk.api, '/shifts/roster', { shiftId, volunteerId, position: 'volunteer' })
      }
      let shift = (await schedule(desk.api)).shifts.find((one) => one.id === shiftId)
      expect(shift?.staffing.gaps).toEqual(['no_lead'])
      expect(shift?.short).toBeNull()

      // And once a person declares it, a fourth volunteer Covering does not
      // take it back: the human already weighed who might turn up.
      await post(desk.api, '/shifts/short', { shiftId, short: true })
      const late = await rosterableVolunteer('Grace Adeyemi')
      await post(apiAs(late, []), '/shifts/cover', { shiftId })

      shift = (await schedule(desk.api)).shifts.find((one) => one.id === shiftId)
      expect(shift?.staffing.gaps).toEqual(['no_lead'])
      expect(shift?.short).not.toBeNull()
    })

    it('refuses a second declaration rather than overwriting whose judgement it was', async () => {
      const { desk, shiftId } = await aShift()
      await post(desk.api, '/shifts/short', { shiftId, short: true })

      const twice = await post(desk.api, '/shifts/short', { shiftId, short: true })
      expect(twice.status).toBe(409)
      expect(twice.body.error).toBe('already_short')

      const cleared = await post(desk.api, '/shifts/short', { shiftId, short: false })
      expect(cleared.status).toBe(204)
      const again = await post(desk.api, '/shifts/short', { shiftId, short: false })
      expect(again.status).toBe(409)
      expect(again.body.error).toBe('not_short')
    })

    describe('and who may declare it — the first Shift Authority check in the system', () => {
      it('takes a rostered Lead, who holds no Domain Scope at all', async () => {
        const { desk, shiftId } = await aShift()
        const beth = await rosterableVolunteer('Beth Ann')
        await post(desk.api, '/shifts/roster', { shiftId, volunteerId: beth, position: 'lead' })

        expect(
          (await post(apiAs(beth, []), '/shifts/short', { shiftId, short: true })).status,
        ).toBe(204)
      })

      it('takes an acting Lead, because the claim carries the full authority set', async () => {
        const { desk, shiftId } = await aShift()
        const beth = await rosterableVolunteer('Beth Ann')
        await post(desk.api, '/shifts/roster', {
          shiftId,
          volunteerId: beth,
          position: 'volunteer',
        })
        const hers = apiAs(beth, [])
        expect((await post(hers, '/shifts/short', { shiftId, short: true })).status).toBe(403)

        await post(hers, '/shifts/acting-lead', { shiftId })
        expect((await post(hers, '/shifts/short', { shiftId, short: true })).status).toBe(204)
      })

      it('refuses a rostered volunteer who leads nothing', async () => {
        const { desk, shiftId } = await aShift()
        const nora = await rosterableVolunteer('Nora Webb')
        await post(desk.api, '/shifts/roster', {
          shiftId,
          volunteerId: nora,
          position: 'volunteer',
        })

        const refused = await post(apiAs(nora, []), '/shifts/short', { shiftId, short: true })
        expect(refused.status).toBe(403)
        // The declaration names both doors, and the denial names what it
        // wanted rather than answering with an empty body (ADR 0010).
        expect(refused.body.wanted).toBe('shift authority or roster')
      })

      it('refuses a Lead whose position ended, because the row no longer authorizes', async () => {
        const { desk, shiftId } = await aShift()
        const beth = await rosterableVolunteer('Beth Ann')
        await post(desk.api, '/shifts/roster', { shiftId, volunteerId: beth, position: 'lead' })
        await post(apiAs(beth, []), '/shifts/drop', { shiftId })

        expect(
          (await post(apiAs(beth, []), '/shifts/short', { shiftId, short: true })).status,
        ).toBe(403)
      })

      it('takes `roster`, which is how officers reach a Shift they are not on', async () => {
        const { desk, shiftId } = await aShift()
        expect((await post(desk.api, '/shifts/short', { shiftId, short: true })).status).toBe(204)
      })
    })
  })

  describe('the evening digest — the one thing the app sends about staffing', () => {
    let posted: OutgoingEmail[] = []

    beforeEach(() => {
      posted = []
      forgetSendsForTest()
      setEmailTransport((message) => {
        posted.push(message)
        return Promise.resolve()
      })
    })

    afterEach(() => {
      setEmailTransport(null)
    })

    /**
     * Somebody whose actual job is the roster — the Role row, not the faked
     * actor scopes, because the digest resolves its recipients from the same
     * grants the rest of the application does.
     */
    async function rosterHolder(name: string): Promise<string> {
      const volunteerId = await rosterableVolunteer(name)
      await owner`
        insert into volunteer_roles (org_id, volunteer_id, role)
        values (${FIELD_BARN}, ${volunteerId}, 'volunteer_coordinator')
      `
      return volunteerId
    }

    async function aShiftTomorrow() {
      const desk = await coordinator()
      await patternOn(desk.api, inHorizon(1).weekday, { targetHeadcount: 3 })
      await post(desk.api, '/shifts/generation')
      return { desk, shiftId: (await schedule(desk.api)).shifts[0]?.id ?? '' }
    }

    it('mails the holders of `roster` the concrete facts, and nobody else', async () => {
      const { desk } = await aShiftTomorrow()
      await rosterHolder('Priya Nkemelu')
      // Somebody with no scope at all: the digest never mails the roster of
      // sixty (ADR 0011).
      await rosterableVolunteer('Beth Ann')

      const sent = await post(desk.api, '/shifts/digest')
      expect(sent.status).toBe(200)
      expect(sent.body).toMatchObject({ recipients: 1, sent: 1, shifts: 1 })
      expect(posted).toHaveLength(1)
      expect(posted[0]?.subject).toContain('Field Barn Horse Rescue')
      expect(posted[0]?.text).toContain('nobody at all')
    })

    it('names Short as a person’s call, beside what the app computed', async () => {
      const { desk, shiftId } = await aShiftTomorrow()
      await rosterHolder('Priya Nkemelu')
      const beth = await rosterableVolunteer('Beth Ann')
      await post(desk.api, '/shifts/roster', { shiftId, volunteerId: beth, position: 'lead' })
      await post(desk.api, '/shifts/short', { shiftId, short: true })

      await post(desk.api, '/shifts/digest')
      expect(posted[0]?.text).toContain('1 of 3 wanted')
      expect(posted[0]?.text).toContain('declared short by a person')
    })

    it('carries no volunteer’s name, the way the Facebook text does not', async () => {
      const { desk, shiftId } = await aShiftTomorrow()
      await rosterHolder('Priya Nkemelu')
      const beth = await rosterableVolunteer('Beth Ann')
      await post(desk.api, '/shifts/roster', { shiftId, volunteerId: beth, position: 'volunteer' })
      await post(apiAs(beth, []), '/shifts/drop', { shiftId, reason: 'nursery run' })

      await post(desk.api, '/shifts/digest')
      // *Beth dropped, we need somebody* reads as pressure, and the digest is
      // not where a Coordinator learns who let them down (ADR 0011).
      expect(posted[0]?.text).not.toContain('Beth')
      expect(posted[0]?.text).not.toContain('nursery run')
      expect(posted[0]?.text).toContain('nobody at all')
    })

    it('goes out even when nothing is missing, so that silence is never ambiguous', async () => {
      const desk = await coordinator()
      await rosterHolder('Priya Nkemelu')

      const sent = await post(desk.api, '/shifts/digest')
      expect(sent.body).toMatchObject({ shifts: 0, sent: 1 })
      expect(posted[0]?.text).toContain('Nothing is missing')
    })

    it('reports a send that failed rather than answering as though it left', async () => {
      const { desk } = await aShiftTomorrow()
      await rosterHolder('Priya Nkemelu')
      setEmailTransport(() => Promise.reject(new Error('smtp is down')))

      const sent = await post(desk.api, '/shifts/digest')
      expect(sent.body).toMatchObject({ recipients: 1, sent: 0 })
    })

    it('is refused to somebody who does not hold `roster`', async () => {
      const beth = await rosterableVolunteer('Beth Ann')
      const refused = await post(apiAs(beth, []), '/shifts/digest')
      expect(refused.status).toBe(403)
      expect(posted).toHaveLength(0)
    })
  })

  describe('what the contract says about queueing', () => {
    it('marks Cover and Drop as writes the phone must never queue', () => {
      // ADR 0011's carve-out from ADR 0005, restated by ADR 0018: the app
      // queues when it is the ledger and not when it is the medium. The queue
      // is a later ticket, and this is where it will read the rule (ADR 0021).
      expect(contract.writes['/shifts/cover'].neverQueued).toBe(true)
      expect(contract.writes['/shifts/drop'].neverQueued).toBe(true)
      // And a write that *is* a statement about the past carries no such mark.
      expect('neverQueued' in contract.writes['/measurements']).toBe(false)
    })

    it('sorts the two new writes by ADR 0018’s rule rather than by a fresh carve-out', () => {
      // "The app queues when it is the ledger, and does not queue when it is
      // the medium." A claim to be leading Thursday is not true until it
      // arrives — two volunteers each seeing that they are in charge is the
      // Cover failure with a different noun.
      expect(contract.writes['/shifts/acting-lead'].neverQueued).toBe(true)
      // And Short is on the other side of the same line: a Shift needing more
      // people is true in the barn whether or not the app knows, so the queue
      // is transport for a fact and misleads nobody about a commitment.
      expect('neverQueued' in contract.writes['/shifts/short']).toBe(false)
    })
  })

  describe('the tenancy guarantee', () => {
    it('has row-level security and a policy on every table this ticket added', async () => {
      const added = ['shift_patterns', 'shift_pattern_roster', 'shifts', 'shift_roster']

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

    it('refuses a second occurrence of one Pattern on one day, in the table itself', async () => {
      // The half of idempotency the application cannot decide: two runs at the
      // same moment, both finding the day empty.
      const desk = await coordinator()
      const patternId = await patternOn(desk.api, inHorizon(1).weekday)
      await post(desk.api, '/shifts/generation')

      const [existing] = await owner`
        select day from shifts where org_id = ${FIELD_BARN} and pattern_id = ${patternId} limit 1
      `
      await expect(
        owner`
          insert into shifts
            (id, org_id, pattern_id, day, shift_type, start_time, target_headcount, staffing_mode)
          values (gen_random_uuid(), ${FIELD_BARN}, ${patternId}, ${String(existing?.day)},
                  'feed_am', '06:30', 3, 'standing_roster')
        `,
      ).rejects.toThrow()
    })
  })
})
