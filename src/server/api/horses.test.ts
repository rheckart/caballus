/**
 * Horses and Spaces, through the API application's own fetch entry — the same
 * primary seam and the same real-Postgres discipline
 * `src/server/api/roster.test.ts` uses, for the domain #35 adds (ADR 0002,
 * 0003).
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`,
 * then `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { closeDb, forOrg, type OrgId } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import type { DomainScope } from '../../shared/domain-scopes'
import { anonymousContext, currentOrgId } from '../request-context'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FIELD_BARN = '00000000-0000-0000-0000-0000000000e5'

describe.skipIf(!reachable)('horses and Spaces, through the API', () => {
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
    payload: Record<string, unknown>,
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
    process.env.APP_ORG_ID = FIELD_BARN
    await wipe()
    await owner`
      insert into orgs (id, name, time_zone)
      values (${FIELD_BARN}, 'Field Barn Horse Rescue', 'America/New_York')
    `
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await wipe({ keepOrg: true })
  })

  afterAll(async () => {
    await wipe()
    await owner.end()
    await closeDb()
  })

  async function wipe({ keepOrg = false }: { keepOrg?: boolean } = {}): Promise<void> {
    await owner`delete from audit_entries where org_id = ${FIELD_BARN}`
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

  /** A horse_care holder — every write in this domain needs the scope. */
  async function holder() {
    const id = await seedVolunteer('Priya Chandra', `priya-${newIdempotencyKey()}@barn.test`)
    return apiAs(id, ['horse_care'])
  }

  /** Anybody signed in, holding nothing — every Volunteer reads this domain (ADR 0010's floor). */
  async function reader() {
    const id = await seedVolunteer('Reader Volunteer', `reader-${newIdempotencyKey()}@barn.test`)
    return apiAs(id, [])
  }

  describe('Spaces', () => {
    it('creates a Space and reads it back, unoccupied', async () => {
      const api = await holder()
      const created = await post(api, '/spaces', { kind: 'stall', name: 'Stall 7' })
      expect(created.status).toBe(201)

      const listed = await get(api, '/spaces')
      expect(listed.body.spaces).toContainEqual(
        expect.objectContaining({ name: 'Stall 7', kind: 'stall', occupants: [] }),
      )
    })

    it('creates a run of Spaces in one act, with an audit entry each', async () => {
      const api = await holder()
      const created = await post(api, '/spaces/batch', {
        kind: 'stall',
        names: ['Run A 1', 'Run A 2', 'Run A 3'],
      })
      expect(created.status).toBe(201)
      expect(created.body.spaceIds).toHaveLength(3)
      expect(created.body.skipped).toEqual([])

      const listed = await get(api, '/spaces')
      for (const name of ['Run A 1', 'Run A 2', 'Run A 3']) {
        expect(listed.body.spaces).toContainEqual(
          expect.objectContaining({ name, kind: 'stall', occupants: [] }),
        )
      }

      const audited = await owner`
        select after from audit_entries
        where entity = 'space' and after like 'Run A %'`
      expect(audited.map((row) => row.after).sort()).toEqual(['Run A 1', 'Run A 2', 'Run A 3'])
    })

    it('skips a name the kind already carries rather than refusing the run', async () => {
      // The ordinary case, not a mistake: somebody added one stall by hand and
      // is now describing the barn they actually have.
      const api = await holder()
      await post(api, '/spaces', { kind: 'stall', name: 'Run B 1' })

      const created = await post(api, '/spaces/batch', {
        kind: 'stall',
        names: ['Run B 1', 'Run B 2'],
      })
      expect(created.status).toBe(201)
      expect(created.body.skipped).toEqual(['Run B 1'])
      expect(created.body.spaceIds).toHaveLength(1)

      // Counted in the table rather than in the answer: what must not happen
      // is two rows, and the read could hide that behind a dedupe of its own.
      const rows = await owner`select name from spaces where name = 'Run B 1'`
      expect(rows).toHaveLength(1)
    })

    it('creates a repeated name once, however many times the run says it', async () => {
      const api = await holder()
      const created = await post(api, '/spaces/batch', {
        kind: 'pasture',
        names: ['Run C', 'Run C'],
      })
      expect(created.status).toBe(201)
      expect(created.body.spaceIds).toHaveLength(1)
      expect(created.body.skipped).toEqual(['Run C'])
    })

    it('takes the same name under a different kind, since a kind is its own list', async () => {
      const api = await holder()
      await post(api, '/spaces/batch', { kind: 'stall', names: ['Run D'] })
      const created = await post(api, '/spaces/batch', { kind: 'barn', names: ['Run D'] })
      expect(created.status).toBe(201)
      expect(created.body.spaceIds).toHaveLength(1)
      expect(created.body.skipped).toEqual([])
    })

    it('refuses to create a run without horse_care', async () => {
      const api = await reader()
      const created = await post(api, '/spaces/batch', { kind: 'stall', names: ['Run E'] })
      expect(created.status).toBe(403)
    })

    it('refuses to create a Space without horse_care', async () => {
      const api = await reader()
      const created = await post(api, '/spaces', { kind: 'stall', name: 'Stall 8' })
      expect(created.status).toBe(403)
    })

    it('splits a joined Space by editing its name in place, with an audit entry', async () => {
      const api = await holder()
      const created = await post(api, '/spaces', { kind: 'stall', name: '2 & 3' })
      const spaceId = created.body.spaceId

      const edited = await post(api, '/spaces/edit', {
        spaceId,
        kind: 'stall',
        name: '2',
        reason: 'split for Blue',
      })
      expect(edited.status).toBe(204)

      const audited = await owner`
        select field, before, after, reason from audit_entries
        where entity = 'space' and entity_id = ${spaceId as string} and field = 'name'
      `
      expect(audited).toHaveLength(1)
      expect(audited[0]).toMatchObject({ before: '2 & 3', after: '2', reason: 'split for Blue' })
    })

    it('refuses to edit a Space that does not exist', async () => {
      const api = await holder()
      const edited = await post(api, '/spaces/edit', {
        spaceId: crypto.randomUUID(),
        kind: 'stall',
        name: 'Nowhere',
      })
      expect(edited.status).toBe(404)
      expect(edited.body.error).toBe('space_not_found')
    })

    it('refuses to change kind while a horse still holds the Space, so the assignment row can never go stale', async () => {
      const api = await holder()
      const stall = await post(api, '/spaces', { kind: 'stall', name: 'Stall 5' })
      const spaceId = stall.body.spaceId
      const horse = await post(api, '/horses', { name: 'Harriet' })
      await post(api, '/horses/space', { horseId: horse.body.horseId, kind: 'stall', spaceId })

      const changed = await post(api, '/spaces/edit', { spaceId, kind: 'pasture', name: 'Stall 5' })
      expect(changed.status).toBe(409)
      expect(changed.body.error).toBe('space_occupied')

      // The rename half of the same edit still works while occupied — only a
      // kind change is refused.
      const renamed = await post(api, '/spaces/edit', { spaceId, kind: 'stall', name: 'Stall 5A' })
      expect(renamed.status).toBe(204)
    })

    it('retires a Space with a date, never deleting the record', async () => {
      const api = await holder()
      const stall = await post(api, '/spaces', { kind: 'stall', name: 'Stall 6' })
      const spaceId = stall.body.spaceId as string

      const retired = await post(api, '/spaces/retirement', {
        spaceId,
        retiredOn: '2020-06-01',
        reason: 'torn out',
      })
      expect(retired.status).toBe(204)

      const listed = await get(api, '/spaces')
      const row = (listed.body.spaces as Record<string, unknown>[]).find((s) => s.id === spaceId)
      expect(row?.retiredOn).toBe('2020-06-01')

      const audited = await owner`
        select field, before, after, reason from audit_entries
        where entity = 'space' and entity_id = ${spaceId} and field = 'retired_on'
      `
      expect(audited).toHaveLength(1)
      expect(audited[0]).toMatchObject({ before: null, after: '2020-06-01', reason: 'torn out' })
    })

    it('corrects a mistaken Retirement by clearing the date', async () => {
      const api = await holder()
      const stall = await post(api, '/spaces', { kind: 'stall', name: 'Stall 7' })
      const spaceId = stall.body.spaceId as string
      await post(api, '/spaces/retirement', { spaceId, retiredOn: '2020-06-01' })

      const corrected = await post(api, '/spaces/retirement', { spaceId, retiredOn: null })
      expect(corrected.status).toBe(204)

      const listed = await get(api, '/spaces')
      const row = (listed.body.spaces as Record<string, unknown>[]).find((s) => s.id === spaceId)
      expect(row?.retiredOn).toBeNull()
    })

    it('refuses to retire a Space while a horse still holds it', async () => {
      const api = await holder()
      const stall = await post(api, '/spaces', { kind: 'stall', name: 'Stall 8' })
      const spaceId = stall.body.spaceId as string
      const horse = await post(api, '/horses', { name: 'Indigo' })
      await post(api, '/horses/space', { horseId: horse.body.horseId, kind: 'stall', spaceId })

      const retired = await post(api, '/spaces/retirement', { spaceId, retiredOn: '2020-06-01' })
      expect(retired.status).toBe(409)
      expect(retired.body.error).toBe('space_occupied')
    })

    it('refuses to retire a Space that does not exist', async () => {
      const api = await holder()
      const retired = await post(api, '/spaces/retirement', {
        spaceId: crypto.randomUUID(),
        retiredOn: '2020-06-01',
      })
      expect(retired.status).toBe(404)
      expect(retired.body.error).toBe('space_not_found')
    })
  })

  describe('Horses', () => {
    it('creates a Horse with an audit entry', async () => {
      const api = await holder()
      const created = await post(api, '/horses', { name: 'Apollo' })
      expect(created.status).toBe(201)
      const horseId = created.body.horseId

      const audited = await owner`
        select entity, entity_id, after from audit_entries
        where entity = 'horse' and entity_id = ${horseId as string}
      `
      expect(audited).toHaveLength(1)
      expect(audited[0]?.after).toBe('Apollo')
    })

    it('edits attributes in place, auditing only the field that changed', async () => {
      const api = await holder()
      const created = await post(api, '/horses', { name: 'Bramble', halterColour: 'blue' })
      const horseId = created.body.horseId as string

      const edited = await post(api, '/horses/attributes', {
        horseId,
        halterColour: 'green',
        reason: 'faded in the sun',
      })
      expect(edited.status).toBe(204)

      const audited = await owner`
        select field, before, after from audit_entries
        where entity = 'horse' and entity_id = ${horseId} and field = 'halter_colour'
      `
      expect(audited).toHaveLength(1)
      expect(audited[0]).toMatchObject({ before: 'blue', after: 'green' })

      const profile = await get(api, `/horses/${horseId}`)
      expect(profile.body).toMatchObject({ name: 'Bramble', halterColour: 'green' })
    })

    it('assigns a Horse to a Space of the matching kind, and refuses a mismatched one', async () => {
      const api = await holder()
      const horse = await post(api, '/horses', { name: 'Comet' })
      const horseId = horse.body.horseId as string
      const stall = await post(api, '/spaces', { kind: 'stall', name: 'Stall 4' })
      const pasture = await post(api, '/spaces', { kind: 'pasture', name: 'Pasture C' })

      const assigned = await post(api, '/horses/space', {
        horseId,
        kind: 'stall',
        spaceId: stall.body.spaceId,
      })
      expect(assigned.status).toBe(204)

      const mismatched = await post(api, '/horses/space', {
        horseId,
        kind: 'stall',
        spaceId: pasture.body.spaceId,
      })
      expect(mismatched.status).toBe(409)
      expect(mismatched.body.error).toBe('space_kind_mismatch')

      const profile = await get(api, `/horses/${horseId}`)
      expect(profile.body.spaces).toMatchObject({
        stall: { name: 'Stall 4' },
        pasture: null,
        paddock: null,
        barn: null,
      })

      const spaces = await get(api, '/spaces')
      const stallRow = (spaces.body.spaces as Record<string, unknown>[]).find(
        (row) => row.id === stall.body.spaceId,
      )
      expect(stallRow?.occupants).toEqual([{ id: horseId, name: 'Comet' }])
    })

    it('holds a Pasture and a Paddock at once, and a second Pasture replaces the first', async () => {
      // The whole of ADR 0002's amendment: a horse turned out is in both, so
      // one kind could not say it — and one-Space-per-kind is untouched, so
      // the second Pasture is a replacement rather than a second row.
      const api = await holder()
      const horse = await post(api, '/horses', { name: 'Blue' })
      const horseId = horse.body.horseId as string
      const pastureC = await post(api, '/spaces', { kind: 'pasture', name: 'Pasture C' })
      const pastureD = await post(api, '/spaces', { kind: 'pasture', name: 'Pasture D' })
      const paddockA = await post(api, '/spaces', { kind: 'paddock', name: 'Paddock A' })

      await post(api, '/horses/space', { horseId, kind: 'pasture', spaceId: pastureC.body.spaceId })
      await post(api, '/horses/space', { horseId, kind: 'paddock', spaceId: paddockA.body.spaceId })

      const both = await get(api, `/horses/${horseId}`)
      expect(both.body.spaces).toMatchObject({
        pasture: { name: 'Pasture C' },
        paddock: { name: 'Paddock A' },
      })

      await post(api, '/horses/space', { horseId, kind: 'pasture', spaceId: pastureD.body.spaceId })

      const moved = await get(api, `/horses/${horseId}`)
      expect(moved.body.spaces).toMatchObject({
        pasture: { name: 'Pasture D' },
        paddock: { name: 'Paddock A' },
      })

      const spaceRows = await get(api, '/spaces')
      const stillEmpty = (spaceRows.body.spaces as Record<string, unknown>[]).find(
        (row) => row.id === pastureC.body.spaceId,
      )
      expect(stillEmpty?.occupants).toEqual([])
    })

    it('clears a Space assignment, leaving the Space empty and visible', async () => {
      const api = await holder()
      const horse = await post(api, '/horses', { name: 'Dawson' })
      const horseId = horse.body.horseId as string
      const stall = await post(api, '/spaces', { kind: 'stall', name: 'Stall 9' })
      await post(api, '/horses/space', { horseId, kind: 'stall', spaceId: stall.body.spaceId })

      const cleared = await post(api, '/horses/space', { horseId, kind: 'stall', spaceId: null })
      expect(cleared.status).toBe(204)

      const profile = await get(api, `/horses/${horseId}`)
      expect(profile.body.spaces).toMatchObject({ stall: null })

      const spaces = await get(api, '/spaces')
      const stallRow = (spaces.body.spaces as Record<string, unknown>[]).find(
        (row) => row.id === stall.body.spaceId,
      )
      expect(stallRow?.occupants).toEqual([])
    })

    it('marks a Horse Departed with a date, never deleting the record', async () => {
      const api = await holder()
      const horse = await post(api, '/horses', { name: 'Elsie' })
      const horseId = horse.body.horseId as string

      const departed = await post(api, '/horses/departure', {
        horseId,
        departedOn: '2020-06-01',
        reason: 'adopted',
      })
      expect(departed.status).toBe(204)

      const listed = await get(api, '/horses')
      const row = (listed.body.horses as Record<string, unknown>[]).find((h) => h.id === horseId)
      expect(row?.departedOn).toBe('2020-06-01')

      // Departed hides from a work surface, never from history: the profile
      // stays reachable directly (#32).
      const profile = await get(api, `/horses/${horseId}`)
      expect(profile.status).toBe(200)
      expect(profile.body.departedOn).toBe('2020-06-01')
    })

    it('corrects a mistaken Departure by clearing the date', async () => {
      const api = await holder()
      const horse = await post(api, '/horses', { name: 'Finn' })
      const horseId = horse.body.horseId as string
      await post(api, '/horses/departure', { horseId, departedOn: '2020-06-01' })

      const corrected = await post(api, '/horses/departure', { horseId, departedOn: null })
      expect(corrected.status).toBe(204)

      const profile = await get(api, `/horses/${horseId}`)
      expect(profile.body.departedOn).toBeNull()
    })

    it('refuses horse writes without horse_care', async () => {
      const api = await reader()
      const created = await post(api, '/horses', { name: 'Grady' })
      expect(created.status).toBe(403)
    })

    it('answers 404 for a horse that does not exist', async () => {
      const api = await holder()
      const missing = await get(api, `/horses/${crypto.randomUUID()}`)
      expect(missing.status).toBe(404)
      expect(missing.body.error).toBe('horse_not_found')
    })
  })

  describe('the tenancy guarantee', () => {
    it('sees no Horse of another organisation', async () => {
      const elsewhere = '00000000-0000-0000-0000-0000000000e6'
      await owner`delete from horses where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
      await owner`
        insert into orgs (id, name, time_zone)
        values (${elsewhere}, 'Somebody Else', 'America/Chicago')
      `
      await owner`
        insert into horses (id, org_id, name)
        values (gen_random_uuid(), ${elsewhere}, 'Not Ours')
      `

      const api = await holder()
      const listed = await get(api, '/horses')
      const names = (listed.body.horses as Record<string, unknown>[]).map((horse) => horse.name)
      expect(names).not.toContain('Not Ours')

      await owner`delete from horses where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
    })

    it('has row-level security and a policy on every table this ticket added', async () => {
      // ADR 0007's one structural guarantee, asserted against the catalogue
      // rather than against behaviour, the same as roster.test.ts.
      const added = ['spaces', 'horses', 'horse_space_assignments']

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

    it('sees zero rows rather than every row when nothing set the scope', async () => {
      await holder()
      const unscoped = postgres(applicationUrl, { max: 1 })
      try {
        const rows = await unscoped`select count(*)::int as n from horses`
        expect(rows[0]?.n).toBe(0)
      } finally {
        await unscoped.end()
      }

      await post(await holder(), '/horses', { name: 'Scoped Read Check' })
      const scoped = await forOrg(orgId()).run((db) =>
        db.execute(`select count(*)::int as n from horses`),
      )
      expect((scoped as unknown as { n: number }[])[0]?.n).toBeGreaterThan(0)
    })
  })
})
