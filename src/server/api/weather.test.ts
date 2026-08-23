/**
 * Thresholds, Conditions and Readings, through the API application's own fetch
 * entry — the same primary seam the rest of the domain uses (#32's testing
 * decisions, #38).
 *
 * What only a real request can settle is here: that the three-valued Threshold
 * survives the round trip and reads as three states rather than two, that a
 * Reading records who answered and what it read, and — the case the ticket
 * names — that **a failed primary falls back and says so**. The providers are
 * stubbed at the network boundary rather than injected, so the real URLs, the
 * real parsing and the real fallback order all run (`src/test/api-stub.ts`
 * makes the same call for the browser).
 *
 * The arithmetic itself is not retested here: `src/shared/conditions.test.ts`
 * is the exhaustive table, and this asserts that the wire carries what it
 * decided.
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`,
 * then `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeDb, type OrgId } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import { board, thresholds, weather } from '../../shared/api-contract'
import type { DomainScope } from '../../shared/domain-scopes'
import { instant, type DayString, type Instant } from '../../shared/time'
import { anonymousContext, currentOrgId } from '../request-context'
import { dayBounds, isoOf, today } from '../time'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FIELD_BARN = '00000000-0000-0000-0000-0000000000eb'
const TIME_ZONE = 'America/New_York'

/** Where the barn is, as configuration gives it to the provider module. */
const LATITUDE = '39.4143'
const LONGITUDE = '-77.4105'

const HOUR = 3_600_000

describe.skipIf(!reachable)('weather, through the API', () => {
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
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await api.fetch(new Request(url(path), { headers }))
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
    process.env.BARN_LATITUDE = LATITUDE
    process.env.BARN_LONGITUDE = LONGITUDE
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    delete process.env.BARN_LATITUDE
    delete process.env.BARN_LONGITUDE
    await wipe({ keepOrg: true })
  })

  afterAll(async () => {
    await wipe()
    await owner.end()
    await closeDb()
  })

  async function wipe({ keepOrg = false }: { keepOrg?: boolean } = {}): Promise<void> {
    await owner`delete from audit_entries where org_id = ${FIELD_BARN}`
    await owner`delete from weather_condition_resolutions where org_id = ${FIELD_BARN}`
    await owner`delete from weather_reading_hours where org_id = ${FIELD_BARN}`
    await owner`delete from weather_readings where org_id = ${FIELD_BARN}`
    await owner`delete from threshold_versions where org_id = ${FIELD_BARN}`
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

  /** Whoever sets the numbers: every write here is behind `horse_care`. */
  async function holder() {
    const id = await seedVolunteer('Priya Chandra', `priya-${newIdempotencyKey()}@barn.test`)
    return apiAs(id, ['horse_care'])
  }

  async function reader() {
    const id = await seedVolunteer('Reader Volunteer', `reader-${newIdempotencyKey()}@barn.test`)
    return apiAs(id, [])
  }

  async function seedHorse(api: ReturnType<typeof apiAs>, name: string): Promise<string> {
    const created = await post(api, '/horses', { name })
    return created.body.horseId as string
  }

  function day(): DayString {
    return today(TIME_ZONE)
  }

  /** The instant an hour of today begins, in the barn's own timezone. */
  function hourToday(hour: number): Instant {
    return instant(dayBounds(day(), TIME_ZONE).start + hour * HOUR)
  }

  /** The panel's numbers, as `horse_care` publishes them (ADR 0015). */
  async function publishPanel(api: ReturnType<typeof apiAs>): Promise<void> {
    for (const [kind, value] of [
      ['sheet', 40],
      ['blanket', 30],
      ['staying_in', 85],
      ['fly_sheet_max', 90],
      ['cold_and_wet', 45],
    ] as const) {
      const published = await post(api, '/thresholds', {
        horseId: null,
        kind,
        stance: 'overridden',
        value,
        validFrom: day(),
      })
      expect(published.status).toBe(201)
    }
  }

  /**
   * A forecast in Open-Meteo's shape, with an air and an apparent temperature
   * for each named hour of today.
   */
  function openMeteoAnswer(
    hours: readonly { hour: number; air: number; apparent: number; rain?: number }[],
  ): Record<string, unknown> {
    return {
      hourly: {
        time: hours.map((each) => Math.trunc(hourToday(each.hour) / 1000)),
        temperature_2m: hours.map((each) => each.air),
        apparent_temperature: hours.map((each) => each.apparent),
        precipitation: hours.map((each) => each.rain ?? 0),
      },
    }
  }

  /** The same day, in api.weather.gov's shape — air temperature and no apparent one. */
  function weatherGovAnswer(
    hours: readonly { hour: number; air: number; chance?: number }[],
  ): Record<string, unknown> {
    return {
      properties: {
        periods: hours.map((each) => ({
          startTime: isoOf(hourToday(each.hour), TIME_ZONE),
          temperature: each.air,
          temperatureUnit: 'F',
          probabilityOfPrecipitation: { value: each.chance ?? 0 },
        })),
      },
    }
  }

  /**
   * Stubs the network. Each provider is answered — or refused — by what its URL
   * says it is, so the module under test picks its own order and does its own
   * parsing.
   */
  function stubProviders(answers: {
    openMeteo?: Record<string, unknown> | 'fails'
    weatherGov?: Record<string, unknown> | 'fails'
  }): void {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const asked = String(input)

      if (asked.includes('api.open-meteo.com')) {
        if (answers.openMeteo === undefined || answers.openMeteo === 'fails') {
          return Promise.reject(new Error('the network said no'))
        }
        return Promise.resolve(jsonResponse(answers.openMeteo))
      }

      if (asked.includes('api.weather.gov/points')) {
        if (answers.weatherGov === undefined || answers.weatherGov === 'fails') {
          return Promise.resolve(new Response('', { status: 503 }))
        }
        return Promise.resolve(
          jsonResponse({
            properties: { forecastHourly: 'https://api.weather.gov/gridpoints/LWX/1,1/hourly' },
          }),
        )
      }

      if (asked.includes('api.weather.gov/gridpoints')) {
        if (answers.weatherGov === undefined || answers.weatherGov === 'fails') {
          return Promise.resolve(new Response('', { status: 503 }))
        }
        return Promise.resolve(jsonResponse(answers.weatherGov))
      }

      return Promise.reject(new Error(`Nothing stubbed for ${asked}`))
    })
  }

  function jsonResponse(body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  describe('the numbers, and the three states', () => {
    it('publishes the rescue default and reads it back', async () => {
      const api = await holder()
      await publishPanel(api)

      const listed = thresholds.parse((await get(api, '/thresholds')).body)
      expect(listed.defaults.map((record) => [record.kind, record.value])).toEqual([
        ['sheet', 40],
        ['blanket', 30],
        ['staying_in', 85],
        ['fly_sheet_max', 90],
        ['cold_and_wet', 45],
      ])
      // The metric comes from the kind, not from the form: cold is air
      // temperature and heat is real feel (ADR 0015).
      expect(listed.defaults.map((record) => [record.kind, record.metric])).toEqual([
        ['sheet', 'air_temp'],
        ['blanket', 'air_temp'],
        ['staying_in', 'apparent_temp'],
        ['fly_sheet_max', 'apparent_temp'],
        ['cold_and_wet', 'air_temp'],
      ])
      expect(listed.defaults.every((record) => record.provider === 'open_meteo')).toBe(true)
    })

    it('tells an override, a deliberate default and an undecided horse apart', async () => {
      const api = await holder()
      await publishPanel(api)
      const dawson = await seedHorse(api, 'Dawson')
      const blue = await seedHorse(api, 'Blue')
      await seedHorse(api, 'Mystery')

      await post(api, '/thresholds', {
        horseId: dawson,
        kind: 'sheet',
        stance: 'overridden',
        value: 50,
        validFrom: day(),
      })
      await post(api, '/thresholds', {
        horseId: blue,
        kind: 'sheet',
        stance: 'follows_default',
        value: null,
        validFrom: day(),
      })

      const listed = thresholds.parse((await get(api, '/thresholds')).body)
      const byName = new Map(listed.horses.map((horse) => [horse.horseName, horse]))

      expect(byName.get('Dawson')?.records).toEqual([
        expect.objectContaining({ kind: 'sheet', stance: 'overridden', value: 50 }),
      ])
      // A horse deliberately on the rescue's number holds no number of its own:
      // one copied here would stop moving when the default did.
      expect(byName.get('Blue')?.records).toEqual([
        expect.objectContaining({ kind: 'sheet', stance: 'follows_default', value: null }),
      ])
      // The third state, and it is an unanswered question rather than agreement.
      expect(byName.get('Mystery')?.records).toEqual([])
      expect(byName.get('Mystery')?.undecided).toEqual(['sheet', 'blanket'])
      expect(byName.get('Dawson')?.undecided).toEqual(['blanket'])
      expect(byName.get('Blue')?.undecided).toEqual(['blanket'])
    })

    it('publishes a version rather than editing one, and marks the new one New', async () => {
      const api = await holder()
      await post(api, '/thresholds', {
        horseId: null,
        kind: 'sheet',
        stance: 'overridden',
        value: 40,
        validFrom: day(),
      })
      await post(api, '/thresholds', {
        horseId: null,
        kind: 'sheet',
        stance: 'overridden',
        value: 45,
        validFrom: day(),
      })

      const listed = thresholds.parse((await get(api, '/thresholds')).body)
      expect(listed.defaults).toEqual([
        expect.objectContaining({ kind: 'sheet', value: 45, isNew: true }),
      ])

      const [rows] = await owner`
        select count(*)::int as n from threshold_versions
        where org_id = ${FIELD_BARN} and kind = 'sheet'
      `
      // Both versions are still there: *what was her sheet number in January*
      // stays answerable (ADR 0003).
      expect(rows?.n).toBe(2)
    })

    it('refuses a per-horse row for a number that is one answer for the barn', async () => {
      const api = await holder()
      const dawson = await seedHorse(api, 'Dawson')
      const refused = await post(api, '/thresholds', {
        horseId: dawson,
        kind: 'staying_in',
        stance: 'overridden',
        value: 80,
        validFrom: day(),
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('threshold_not_per_horse')
    })

    it('refuses an override with no number', async () => {
      const api = await holder()
      const dawson = await seedHorse(api, 'Dawson')
      const refused = await post(api, '/thresholds', {
        horseId: dawson,
        kind: 'sheet',
        stance: 'overridden',
        value: null,
        validFrom: day(),
      })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toBe('threshold_value_required')
    })

    it('refuses a Threshold for a horse nobody can find', async () => {
      const api = await holder()
      const refused = await post(api, '/thresholds', {
        horseId: '11111111-1111-4111-8111-111111111111',
        kind: 'sheet',
        stance: 'overridden',
        value: 50,
        validFrom: day(),
      })
      expect(refused.status).toBe(404)
      expect(refused.body.error).toBe('horse_not_found')
    })

    it('lets every Volunteer read the numbers and only horse_care set them', async () => {
      const desk = await holder()
      await publishPanel(desk)

      const volunteer = await reader()
      expect((await get(volunteer, '/thresholds')).status).toBe(200)

      const refused = await post(volunteer, '/thresholds', {
        horseId: null,
        kind: 'sheet',
        stance: 'overridden',
        value: 41,
        validFrom: day(),
      })
      expect(refused.status).toBe(403)
    })
  })

  describe('the Reading', () => {
    it('records who answered, what it read and what it resolved to', async () => {
      const api = await holder()
      await publishPanel(api)
      const storm = await seedHorse(api, 'Storm')
      await seedHorse(api, 'Blue')
      await post(api, '/thresholds', {
        horseId: storm,
        kind: 'sheet',
        stance: 'overridden',
        value: 35,
        validFrom: day(),
      })
      await post(api, '/thresholds', {
        horseId: storm,
        kind: 'blanket',
        stance: 'overridden',
        value: 20,
        validFrom: day(),
      })

      stubProviders({
        openMeteo: openMeteoAnswer([
          { hour: 6, air: 38, apparent: 33 },
          { hour: 13, air: 52, apparent: 55 },
        ]),
      })

      const recorded = await post(api, '/weather/readings')
      expect(recorded.status).toBe(201)
      expect(recorded.body).toMatchObject({ provider: 'open_meteo', stale: false })

      const answered = weather.parse((await get(api, '/weather')).body)
      const reading = answered.reading
      expect(reading).not.toBeNull()
      expect(reading?.provider).toBe('open_meteo')
      expect(reading?.fellBackFrom).toBeNull()
      expect(reading?.stale).toBe(false)
      // The raw hours, kept whole rather than as the decision they produced (#6).
      expect(reading?.hours.map((hour) => [hour.hour, hour.airTempF])).toEqual([
        [6, 38],
        [13, 52],
      ])

      // ADR 0015's own sentence, over the wire: at 38 °F the default horse gets
      // a sheet and Storm gets nothing.
      const sheets = reading?.conditions.filter(
        (resolution) => resolution.condition === 'sheet_weather',
      )
      expect(sheets?.find((each) => each.horseName === 'Blue')).toMatchObject({
        holds: true,
        thresholdValue: 40,
        thresholdSource: 'undecided',
        readingValue: 38,
        atHour: 6,
      })
      expect(sheets?.find((each) => each.horseName === 'Storm')).toMatchObject({
        holds: false,
        thresholdValue: 35,
        thresholdSource: 'override',
      })
    })

    it('answers the heat rule for the barn and not per horse', async () => {
      const api = await holder()
      await publishPanel(api)
      await seedHorse(api, 'Blue')
      stubProviders({
        openMeteo: openMeteoAnswer([
          { hour: 10, air: 84, apparent: 88 },
          { hour: 15, air: 92, apparent: 97 },
        ]),
      })
      await post(api, '/weather/readings')

      const answered = weather.parse((await get(api, '/weather')).body)
      const stayingIn = answered.reading?.conditions.filter(
        (resolution) => resolution.condition === 'staying_in',
      )
      expect(stayingIn).toHaveLength(1)
      expect(stayingIn?.[0]).toMatchObject({
        horseId: null,
        holds: true,
        scope: 'day',
        atHour: 10,
        readingValue: 88,
      })
    })

    it('says nothing has fixed today rather than answering with a calm day', async () => {
      const api = await holder()
      const answered = weather.parse((await get(api, '/weather')).body)
      expect(answered.reading).toBeNull()
    })

    it('refuses when nobody told this deployment where the barn is', async () => {
      delete process.env.BARN_LATITUDE
      delete process.env.BARN_LONGITUDE

      const api = await holder()
      const refused = await post(api, '/weather/readings')
      // 503 and not 409: a queue reads 409 as *stop*, and a deployment that
      // has not been told where the barn is will answer this write once it has.
      expect(refused.status).toBe(503)
      expect(refused.body.error).toBe('coordinates_not_set')
    })
  })

  describe('when the primary does not answer', () => {
    it('falls back, says so, and leaves the heat rule unresolved', async () => {
      const api = await holder()
      await publishPanel(api)
      await seedHorse(api, 'Blue')

      stubProviders({
        openMeteo: 'fails',
        weatherGov: weatherGovAnswer([
          { hour: 6, air: 38 },
          { hour: 14, air: 66 },
        ]),
      })

      const recorded = await post(api, '/weather/readings')
      expect(recorded.status).toBe(201)
      expect(recorded.body.provider).toBe('nws')

      const answered = weather.parse((await get(api, '/weather')).body)
      expect(answered.reading).toMatchObject({ provider: 'nws', fellBackFrom: 'open_meteo' })
      expect(answered.reading?.fellBackBecause).not.toBeNull()

      // The cold rules still resolve, because air temperature is air temperature.
      expect(
        answered.reading?.conditions.find((resolution) => resolution.condition === 'sheet_weather'),
      ).toMatchObject({ holds: true, readingValue: 38 })

      // The heat rule does not, because this provider carries no apparent
      // temperature and 85 was never calibrated against its scale (#6).
      expect(
        answered.reading?.conditions.find((resolution) => resolution.condition === 'staying_in'),
      ).toMatchObject({ holds: null, unresolved: 'no_metric' })
    })

    it('reuses the day’s last forecast and marks it stale when nobody answers', async () => {
      const api = await holder()
      await publishPanel(api)
      await seedHorse(api, 'Blue')

      stubProviders({ openMeteo: openMeteoAnswer([{ hour: 6, air: 38, apparent: 33 }]) })
      await post(api, '/weather/readings')

      stubProviders({ openMeteo: 'fails', weatherGov: 'fails' })
      const again = await post(api, '/weather/readings')
      expect(again.status).toBe(201)
      expect(again.body).toMatchObject({ provider: 'open_meteo', stale: true })

      const answered = weather.parse((await get(api, '/weather')).body)
      expect(answered.reading?.stale).toBe(true)
      // The hours are the ones that were read then, re-evaluated: a stale
      // Reading is honest about being an older answer to today's question.
      expect(answered.reading?.hours.map((hour) => hour.airTempF)).toEqual([38])
      expect(
        answered.reading?.conditions.find((resolution) => resolution.condition === 'sheet_weather')
          ?.holds,
      ).toBe(true)
    })

    it('refuses when nobody answers and there is nothing to reuse', async () => {
      const api = await holder()
      await publishPanel(api)
      stubProviders({ openMeteo: 'fails', weatherGov: 'fails' })

      const refused = await post(api, '/weather/readings')
      // The one refusal here that is genuinely worth retrying: both providers
      // were unreachable this minute, and a 409 would have the queue drop the
      // day's Reading over a minute's outage.
      expect(refused.status).toBe(503)
      expect(refused.body.error).toBe('forecast_unavailable')
    })
  })

  describe('the Board', () => {
    it('carries today’s Reading and what it resolved to', async () => {
      const api = await holder()
      await publishPanel(api)
      await seedHorse(api, 'Blue')
      stubProviders({
        openMeteo: openMeteoAnswer([
          { hour: 10, air: 86, apparent: 90 },
          { hour: 15, air: 94, apparent: 99 },
        ]),
      })
      await post(api, '/weather/readings')

      const grid = board.parse((await get(api, '/board')).body)
      expect(grid.weather?.provider).toBe('open_meteo')
      expect(
        grid.weather?.conditions.find((resolution) => resolution.condition === 'staying_in')?.holds,
      ).toBe(true)
    })

    it('shows a Board with no Reading rather than an empty one', async () => {
      const api = await holder()
      await seedHorse(api, 'Blue')
      const grid = board.parse((await get(api, '/board')).body)
      expect(grid.weather).toBeNull()
    })
  })

  describe('the tenancy guarantee', () => {
    it('has row-level security and a policy on every table this ticket added', async () => {
      // ADR 0007's one structural guarantee, asserted against the catalogue
      // rather than against behaviour, the same as horses.test.ts.
      const added = [
        'threshold_versions',
        'weather_readings',
        'weather_reading_hours',
        'weather_condition_resolutions',
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

    it('sees no Threshold of another organisation', async () => {
      // An id no other test file owns. `...e7` was `products.test.ts`'s own
      // organisation, and the two files run in parallel against one Postgres:
      // the `delete from orgs` below was tearing that suite's rescue out from
      // under it whenever the timing lined up.
      const elsewhere = '00000000-0000-0000-0000-0000000000f0'
      await owner`delete from threshold_versions where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
      await owner`
        insert into orgs (id, name, time_zone)
        values (${elsewhere}, 'Somebody Else', 'America/Chicago')
      `
      await owner`
        insert into threshold_versions
          (id, org_id, horse_id, kind, stance, value_f, metric, provider, valid_from)
        values (gen_random_uuid(), ${elsewhere}, null, 'sheet', 'overridden', 99, 'air_temp',
                'open_meteo', ${day()})
      `

      const api = await holder()
      const listed = thresholds.parse((await get(api, '/thresholds')).body)
      expect(listed.defaults.map((record) => record.value)).not.toContain(99)

      await owner`delete from threshold_versions where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
    })
  })
})
