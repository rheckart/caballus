/**
 * The Whiteboard Read, through the API application's own fetch entry (ADR
 * 0023, #59).
 *
 * **Nothing here makes a paid call.** `setWhiteboardReader` is the seam —
 * the same shape `setEmailTransport` has, and for the same two reasons — so
 * every rule the feature rests on is proved against a reading somebody wrote
 * by hand: additive only, partial writes, the panel's own fence, and a key
 * that is not set failing closed in words.
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`,
 * then `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { closeDb, type OrgId } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import { whiteboardReport } from '../../shared/api-contract'
import type { DomainScope } from '../../shared/domain-scopes'
import { scopesForPanel } from '../../shared/whiteboard'
import { anonymousContext, currentOrgId } from '../request-context'
import { setWhiteboardReader, type WhiteboardReading } from '../whiteboard-read/model'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FIELD_BARN = '00000000-0000-0000-0000-0000000000fb'
const TIME_ZONE = 'America/New_York'

/** A one-pixel PNG. The bytes never leave this process — the reader is stubbed. */
const PHOTOGRAPH =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** An empty reading, so a test only writes down the part it is about. */
function nothingRead(overrides: Partial<WhiteboardReading> = {}): WhiteboardReading {
  return {
    spaces: [],
    horses: [],
    contacts: [],
    standingRules: [],
    blank: [],
    couldNotPlace: [],
    ...overrides,
  }
}

describe.skipIf(!reachable)('the Whiteboard Read, through the API', () => {
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
    const text = await response.text()
    return {
      status: response.status,
      body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
    }
  }

  /**
   * Shoots one panel. The answer is parsed against the contract rather than
   * read loosely: what the screen is promised is that schema (ADR 0021).
   */
  async function shoot(api: ReturnType<typeof apiAs>, panel: string) {
    const sent = await post(api, '/whiteboard-read', {
      panel,
      mediaType: 'image/png',
      image: PHOTOGRAPH,
    })
    return { status: sent.status, body: sent.body, report: () => whiteboardReport.parse(sent.body) }
  }

  let nextVolunteer = 0

  async function holder(scopes: readonly DomainScope[]) {
    nextVolunteer += 1
    const id = `00000000-0000-0000-0000-00000000${String(1000 + nextVolunteer)}`
    await owner`
      insert into volunteers (id, org_id, name, email)
      values (${id}, ${FIELD_BARN}, ${'Reader ' + String(nextVolunteer)}, ${`reader${String(nextVolunteer)}@barn.invalid`})
    `
    return apiAs(id, scopes)
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
    setWhiteboardReader(null)
    await wipe({ keepOrg: true })
  })

  afterAll(async () => {
    setWhiteboardReader(null)
    await wipe()
    await owner.end()
    await closeDb()
  })

  async function wipe({ keepOrg = false }: { keepOrg?: boolean } = {}): Promise<void> {
    await owner`delete from audit_entries where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_lines where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_versions where org_id = ${FIELD_BARN}`
    await owner`delete from horse_space_assignments where org_id = ${FIELD_BARN}`
    await owner`delete from horses where org_id = ${FIELD_BARN}`
    await owner`delete from products where org_id = ${FIELD_BARN}`
    await owner`delete from spaces where org_id = ${FIELD_BARN}`
    await owner`delete from contacts where org_id = ${FIELD_BARN}`
    await owner`delete from standing_rules where org_id = ${FIELD_BARN}`
    await owner`delete from idempotency_keys where org_id = ${FIELD_BARN}`
    await owner`delete from volunteers where org_id = ${FIELD_BARN}`
    if (!keepOrg) await owner`delete from orgs where id = ${FIELD_BARN}`
  }

  /** Two horses, their Spaces, their feed cells — one panel of a real board. */
  const GRID: WhiteboardReading = nothingRead({
    spaces: [
      { kind: 'stall', name: '2 & 3' },
      { kind: 'stall', name: '7' },
      { kind: 'barn', name: 'Small Barn' },
    ],
    horses: [
      {
        name: 'Blue',
        halterColour: 'green',
        blanketSize: '80',
        height: '15.2 hh',
        spaces: [
          { kind: 'stall', name: '2 & 3' },
          { kind: 'pasture', name: 'C' },
        ],
        feedings: [
          {
            shiftType: 'feed_am',
            lines: [
              {
                productName: 'Senior',
                productKind: 'feed',
                prescription: false,
                amount: '2 wells',
                route: 'in_feed',
              },
              {
                productName: 'Previcox',
                productKind: 'medication',
                prescription: true,
                amount: '1 tab',
                route: 'in_feed',
              },
            ],
          },
        ],
      },
      {
        name: 'Dawson',
        halterColour: null,
        blanketSize: null,
        height: null,
        spaces: [{ kind: 'barn', name: 'Small Barn' }],
        feedings: [],
      },
    ],
    blank: ['Row 6’s PM grain cell is smudged.'],
  })

  describe('who may run it', () => {
    it('refuses the grid panel to a caller holding roster but not horse care', async () => {
      setWhiteboardReader(() => Promise.resolve(GRID))
      const coordinator = await holder(['roster'])

      const sent = await shoot(coordinator, 'grid')
      expect(sent.status).toBe(409)
      expect(sent.body.error).toBe('not_authorized_for_panel')

      // And nothing was written on the way to being refused.
      const rows = await owner`select id from horses where org_id = ${FIELD_BARN}`
      expect(rows).toHaveLength(0)
    })

    it('takes the phone numbers from that same caller, because roster is what it writes into', async () => {
      setWhiteboardReader(() =>
        Promise.resolve(
          nothingRead({
            contacts: [
              {
                name: 'Damascus Equine',
                number: '301-555-0134',
                hours: '8–5 weekdays',
                purpose: 'The vet',
              },
            ],
          }),
        ),
      )
      const coordinator = await holder(['roster'])

      const sent = await shoot(coordinator, 'contacts')
      expect(sent.status).toBe(201)
      expect(sent.report().created).toEqual([
        { record: 'contact', name: 'Damascus Equine', id: expect.any(String) },
      ])
    })

    it('needs both Scopes for a panel that writes into both', () => {
      // The authorization argument in one line: a panel needs exactly the
      // Scopes it writes into, derived rather than listed (ADR 0023).
      expect(scopesForPanel('grid')).toEqual(['horse_care'])
      expect(scopesForPanel('contacts')).toEqual(['roster'])
      expect(scopesForPanel('hay')).toEqual(['horse_care', 'roster'])
    })
  })

  describe('with no key set', () => {
    it('refuses in words rather than failing obscurely', async () => {
      // `null` is exactly what an unset OPENROUTER_API_KEY resolves to.
      setWhiteboardReader(null)
      const api = await holder(['horse_care', 'roster'])

      const sent = await shoot(api, 'grid')
      expect(sent.status).toBe(409)
      expect(sent.body.error).toBe('whiteboard_reader_not_set')
    })
  })

  describe('the grid panel', () => {
    it('creates the Spaces, Horses, Products and Feed Schedule lines it can read', async () => {
      setWhiteboardReader(() => Promise.resolve(GRID))
      const api = await holder(['horse_care', 'roster'])

      const report = (await shoot(api, 'grid')).report()

      const named = (record: string) =>
        report.created.filter((entry) => entry.record === record).map((entry) => entry.name)
      expect(named('horse').sort()).toEqual(['Blue', 'Dawson'])
      // Named by kind, not by the word *Space*: stall 7 and pasture 7 are two
      // Spaces and the report has to be able to tell them apart.
      expect(named('space').sort()).toEqual([
        'barn Small Barn',
        'pasture C',
        'stall 2 & 3',
        'stall 7',
      ])
      expect(named('product').sort()).toEqual(['Previcox', 'Senior'])
      expect(named('feed_schedule')).toEqual(['Blue — Feed AM'])

      // `2 & 3` is ONE Space with a compound name, never two (ADR 0002).
      const stalls = await owner`
        select name from spaces where org_id = ${FIELD_BARN} and kind = 'stall' order by name
      `
      expect(stalls.map((row) => row.name)).toEqual(['2 & 3', '7'])

      // `amount` is free text, so the board's own `2 wells` lands as written
      // and nothing divides a sack (ADR 0019).
      const lines = await owner`
        select amount from feed_schedule_lines where org_id = ${FIELD_BARN} order by amount
      `
      expect(lines.map((row) => row.amount)).toEqual(['1 tab', '2 wells'])

      // A horse holds a Stall and a Pasture at once (#57).
      const placed = await owner`
        select kind from horse_space_assignments where org_id = ${FIELD_BARN} order by kind
      `
      expect(placed.map((row) => row.kind)).toEqual(['barn', 'pasture', 'stall'])
    })

    it('names every blank, and every created medication for a horse_care holder to check', async () => {
      setWhiteboardReader(() => Promise.resolve(GRID))
      const api = await holder(['horse_care', 'roster'])

      const report = (await shoot(api, 'grid')).report()
      expect(report.blank).toEqual(['Row 6’s PM grain cell is smudged.'])
      expect(report.check).toHaveLength(1)
      expect(report.check[0]).toContain('Previcox')
    })

    it('leaves one audit entry per created record, authored by the caller with its reason', async () => {
      setWhiteboardReader(() => Promise.resolve(GRID))
      const api = await holder(['horse_care', 'roster'])
      await shoot(api, 'grid')

      const entries = await owner`
        select entity, reason, actor_volunteer_id
        from audit_entries
        where org_id = ${FIELD_BARN} and entity = 'horse'
      `
      expect(entries).toHaveLength(2)
      for (const entry of entries) {
        expect(entry.reason).toBe('read from the whiteboard photograph')
        expect(entry.actor_volunteer_id).not.toBeNull()
      }

      // A Feed Schedule is versioned-tier and carries none (ADR 0003).
      const schedules = await owner`
        select id from audit_entries where org_id = ${FIELD_BARN} and entity = 'feed_schedule'
      `
      expect(schedules).toHaveLength(0)
    })

    it('creates nothing the second time, and names what it skipped', async () => {
      setWhiteboardReader(() => Promise.resolve(GRID))
      const api = await holder(['horse_care', 'roster'])

      await shoot(api, 'grid')
      const second = (await shoot(api, 'grid')).report()

      expect(second.created).toEqual([])
      const skipped = (record: string) =>
        second.skipped.filter((entry) => entry.record === record).map((entry) => entry.name)
      expect(skipped('horse').sort()).toEqual(['Blue', 'Dawson'])
      expect(skipped('product').sort()).toEqual(['Previcox', 'Senior'])

      // A horse already held is skipped **whole**, so a correction somebody
      // made to its feeding after the first run survives the second.
      const versions = await owner`
        select id from feed_schedule_versions where org_id = ${FIELD_BARN}
      `
      expect(versions).toHaveLength(1)
    })

    it('writes the nine horses it could read and reports the tenth', async () => {
      setWhiteboardReader(() =>
        Promise.resolve(
          nothingRead({
            horses: [
              ...GRID.horses,
              // A Shift Type nothing in this build knows: one horse lost
              // rather than the panel (ADR 0023).
              {
                name: 'Apollo',
                halterColour: null,
                blanketSize: null,
                height: null,
                spaces: [],
                feedings: [{ shiftType: 'supper', lines: [] }],
              },
            ],
          }),
        ),
      )
      const api = await holder(['horse_care', 'roster'])

      const report = (await shoot(api, 'grid')).report()
      expect(
        report.created
          .filter((entry) => entry.record === 'horse')
          .map((entry) => entry.name)
          .sort(),
      ).toEqual(['Blue', 'Dawson'])
      expect(report.couldNotPlace).toHaveLength(1)
      expect(report.couldNotPlace[0]).toContain('Apollo')
    })

    it('publishes one Feed Schedule per Shift Type, however many cells the board split it across', async () => {
      // AM GRAIN and AM MEDICAL are two columns of one feeding. Two versions
      // valid from the same day, created in the same transaction, would tie on
      // `created_at` and one column's lines would silently vanish.
      setWhiteboardReader(() =>
        Promise.resolve(
          nothingRead({
            horses: [
              {
                name: 'Blue',
                halterColour: null,
                blanketSize: null,
                height: null,
                spaces: [],
                feedings: [
                  {
                    shiftType: 'feed_am',
                    lines: [
                      {
                        productName: 'Senior',
                        productKind: 'feed',
                        prescription: false,
                        amount: '2 wells',
                        route: 'in_feed',
                      },
                    ],
                  },
                  {
                    shiftType: 'feed_am',
                    lines: [
                      {
                        productName: 'Previcox',
                        productKind: 'medication',
                        prescription: true,
                        amount: '1 tab',
                        route: 'in_feed',
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        ),
      )
      const api = await holder(['horse_care', 'roster'])

      const report = (await shoot(api, 'grid')).report()
      expect(report.created.filter((entry) => entry.record === 'feed_schedule')).toEqual([
        { record: 'feed_schedule', name: 'Blue — Feed AM', id: expect.any(String) },
      ])

      const versions = await owner`
        select id from feed_schedule_versions where org_id = ${FIELD_BARN}
      `
      expect(versions).toHaveLength(1)

      const lines = await owner`
        select amount from feed_schedule_lines where org_id = ${FIELD_BARN} order by amount
      `
      expect(lines.map((row) => row.amount)).toEqual(['1 tab', '2 wells'])
    })

    it('never invents a name for a row the board left nameless', async () => {
      // The failure this exists against: a panel with no horse-name column
      // produced `Unknown Horse Row 1` … `Row 8`, eight fabricated horses in a
      // real rescue. A nameless row is a blank to go and look at, not a horse
      // (ADR 0023 — *the app never fabricates*).
      setWhiteboardReader(() =>
        Promise.resolve(
          nothingRead({
            horses: [
              {
                name: null,
                halterColour: null,
                blanketSize: null,
                height: null,
                spaces: [{ kind: 'stall', name: '4' }],
                feedings: [],
              },
              {
                name: '   ',
                halterColour: null,
                blanketSize: null,
                height: null,
                spaces: [],
                feedings: [],
              },
            ],
          }),
        ),
      )
      const api = await holder(['horse_care', 'roster'])

      const report = (await shoot(api, 'grid')).report()
      expect(report.created.filter((entry) => entry.record === 'horse')).toEqual([])
      expect(report.blank).toHaveLength(2)
      expect(report.blank[0]).toContain('stall 4')

      const rows = await owner`select id from horses where org_id = ${FIELD_BARN}`
      expect(rows).toHaveLength(0)

      // The Stall on that row is still real and still created — the row named
      // no horse, it did not fail to be a row.
      const stalls = await owner`select name from spaces where org_id = ${FIELD_BARN}`
      expect(stalls.map((row) => row.name)).toEqual(['4'])
    })

    it('treats a name that differs only in case as already held', async () => {
      // A whiteboard is handwriting: `Cosequin` on one panel and `CoseQuin` on
      // the next are one Product, and creating both is additive-only failing
      // at the moment it was meant to hold.
      const reading = (spelling: string): WhiteboardReading =>
        nothingRead({
          spaces: [{ kind: 'barn', name: spelling === 'Cosequin' ? 'Small Barn' : 'SMALL BARN' }],
          horses: [
            {
              name: spelling === 'Cosequin' ? 'Blue' : 'BLUE',
              halterColour: null,
              blanketSize: null,
              height: null,
              spaces: [],
              feedings: [
                {
                  shiftType: 'feed_am',
                  lines: [
                    {
                      productName: spelling,
                      productKind: 'supplement',
                      prescription: false,
                      amount: '1 scoop',
                      route: 'in_feed',
                    },
                  ],
                },
              ],
            },
          ],
        })

      const api = await holder(['horse_care', 'roster'])
      setWhiteboardReader(() => Promise.resolve(reading('Cosequin')))
      await shoot(api, 'grid')

      setWhiteboardReader(() => Promise.resolve(reading('CoseQuin')))
      const second = (await shoot(api, 'grid')).report()

      expect(second.created).toEqual([])
      expect(second.skipped.map((entry) => entry.record).sort()).toEqual([
        'horse',
        'product',
        'space',
      ])

      // One of each, spelled the way the first panel had it.
      const products = await owner`select name from products where org_id = ${FIELD_BARN}`
      expect(products.map((row) => row.name)).toEqual(['Cosequin'])
      const horseRows = await owner`select name from horses where org_id = ${FIELD_BARN}`
      expect(horseRows.map((row) => row.name)).toEqual(['Blue'])
      const spaceRows = await owner`select name from spaces where org_id = ${FIELD_BARN}`
      expect(spaceRows.map((row) => row.name)).toEqual(['Small Barn'])
    })

    it('keeps the horse when one of its feed cells is unreadable', async () => {
      // The granularity ADR 0023 asks for, one level further down than the
      // horse: a smudged cell in the medical column costs that cell, not
      // Blue's whole record and not the grain beside it.
      setWhiteboardReader(() =>
        Promise.resolve(
          nothingRead({
            horses: [
              {
                name: 'Blue',
                halterColour: null,
                blanketSize: null,
                height: null,
                spaces: [],
                feedings: [
                  {
                    shiftType: 'feed_am',
                    lines: [
                      {
                        productName: 'Senior',
                        productKind: 'feed',
                        prescription: false,
                        amount: '2 wells',
                        route: 'in_feed',
                      },
                      // A Route nothing in this build knows.
                      {
                        productName: 'Mystery',
                        productKind: 'feed',
                        prescription: false,
                        amount: '1 scoop',
                        route: 'by_hand',
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        ),
      )
      const api = await holder(['horse_care', 'roster'])

      const report = (await shoot(api, 'grid')).report()
      expect(report.created.some((entry) => entry.name === 'Blue')).toBe(true)
      expect(report.created.some((entry) => entry.name === 'Senior')).toBe(true)
      expect(report.created.some((entry) => entry.name === 'Mystery')).toBe(false)
      expect(report.couldNotPlace.join(' ')).toContain('Blue')

      const lines = await owner`
        select amount from feed_schedule_lines where org_id = ${FIELD_BARN}
      `
      expect(lines.map((row) => row.amount)).toEqual(['2 wells'])
    })

    it('calls a feed cell with no amount a blank, and still creates its Product', async () => {
      // A real board says `fly spray` in a feed cell with nothing beside it.
      // `/feed-schedules` requires an amount, so the line is dropped and named
      // — never given a quantity nobody wrote — while the Product still lands,
      // because Days of Supply wants to count fly spray (ADR 0019, ADR 0023).
      setWhiteboardReader(() =>
        Promise.resolve(
          nothingRead({
            horses: [
              {
                name: 'Apollo',
                halterColour: null,
                blanketSize: null,
                height: null,
                spaces: [],
                feedings: [
                  {
                    shiftType: 'feed_am',
                    lines: [
                      {
                        productName: 'fly spray',
                        productKind: 'topical',
                        prescription: false,
                        amount: '',
                        route: 'topical',
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        ),
      )
      const api = await holder(['horse_care', 'roster'])

      const report = (await shoot(api, 'grid')).report()
      expect(report.created.some((entry) => entry.name === 'Apollo')).toBe(true)
      expect(report.created.some((entry) => entry.name === 'fly spray')).toBe(true)
      expect(report.created.some((entry) => entry.record === 'feed_schedule')).toBe(false)
      expect(report.blank.join(' ')).toContain('no amount')

      const lines = await owner`
        select id from feed_schedule_lines where org_id = ${FIELD_BARN}
      `
      expect(lines).toHaveLength(0)
    })

    it('creates a topical Product, which generates no Item (#58)', async () => {
      setWhiteboardReader(() =>
        Promise.resolve(
          nothingRead({
            horses: [
              {
                name: 'Blue',
                halterColour: null,
                blanketSize: null,
                height: null,
                spaces: [],
                feedings: [
                  {
                    shiftType: 'feed_am',
                    lines: [
                      {
                        productName: 'Fly spray',
                        productKind: 'topical',
                        // The model proposed a prescription; a Topical is
                        // never one, whatever it said.
                        prescription: true,
                        amount: 'a good coat',
                        route: 'topical',
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        ),
      )
      const api = await holder(['horse_care', 'roster'])

      const report = (await shoot(api, 'grid')).report()
      expect(report.created.some((entry) => entry.name === 'Fly spray')).toBe(true)
      // Never named for checking: only a medication is.
      expect(report.check).toEqual([])

      const [product] = await owner`
        select kind, prescription from products where org_id = ${FIELD_BARN}
      `
      expect(product?.kind).toBe('topical')
      expect(product?.prescription).toBe(false)
    })
  })

  describe('the panel is the fence', () => {
    it('writes no horse from a contacts panel, and says so', async () => {
      setWhiteboardReader(() => Promise.resolve(GRID))
      const coordinator = await holder(['roster'])

      const report = (await shoot(coordinator, 'contacts')).report()
      expect(report.created).toEqual([])
      expect(report.couldNotPlace.join(' ')).toContain('Horse')

      const rows = await owner`select id from horses where org_id = ${FIELD_BARN}`
      expect(rows).toHaveLength(0)
    })

    it('takes the residue verbatim on the rules panel, and recognises it the second time', async () => {
      setWhiteboardReader(() =>
        Promise.resolve(
          nothingRead({
            standingRules: [{ text: 'HAY: 2 flakes per paddock, morning and night.' }],
          }),
        ),
      )
      const coordinator = await holder(['roster'])

      const first = (await shoot(coordinator, 'rules')).report()
      expect(first.created).toEqual([
        {
          record: 'standing_rule',
          name: 'HAY: 2 flakes per paddock, morning and night.',
          id: expect.any(String),
        },
      ])

      const second = (await shoot(coordinator, 'rules')).report()
      expect(second.created).toEqual([])
      expect(second.skipped).toHaveLength(1)
    })
  })

  describe('when the model will not answer', () => {
    it('refuses and writes nothing', async () => {
      const { ReadingFailed } = await import('../whiteboard-read/model')
      setWhiteboardReader(() => Promise.reject(new ReadingFailed('the model declined it')))
      const api = await holder(['horse_care', 'roster'])

      const sent = await shoot(api, 'grid')
      expect(sent.status).toBe(409)
      expect(sent.body.error).toBe('whiteboard_unreadable')
    })
  })
})
