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
    await owner`delete from escalation_comments where org_id = ${FIELD_BARN}`
    await owner`delete from escalations where org_id = ${FIELD_BARN}`
    await owner`delete from observations where org_id = ${FIELD_BARN}`
    await owner`delete from attendance where org_id = ${FIELD_BARN}`
    await owner`delete from horse_measurements where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_lines where org_id = ${FIELD_BARN}`
    await owner`delete from feed_schedule_versions where org_id = ${FIELD_BARN}`
    await owner`delete from alerts where org_id = ${FIELD_BARN}`
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

    describe('a herd moved in one act (#99)', () => {
      async function herd(api: ReturnType<typeof apiAs>, names: readonly string[]) {
        const ids: string[] = []
        for (const name of names) {
          const horse = await post(api, '/horses', { name })
          ids.push(horse.body.horseId as string)
        }
        return ids
      }

      const EIGHT = ['Ash', 'Birch', 'Cedar', 'Dune', 'Elm', 'Fern', 'Gale', 'Hazel']

      it('turns eight horses out into one Pasture, one audit entry each, under one key', async () => {
        const api = await holder()
        const horseIds = await herd(api, EIGHT)
        const pasture = await post(api, '/spaces', { kind: 'pasture', name: 'North' })

        const moved = await post(api, '/horses/space/batch', {
          horseIds,
          kind: 'pasture',
          spaceId: pasture.body.spaceId,
        })
        expect(moved.status).toBe(200)
        expect(moved.body).toEqual({ assigned: horseIds, skipped: [] })

        const held = await owner`
          select horse_id from horse_space_assignments
          where org_id = ${FIELD_BARN} and kind = 'pasture' and space_id = ${pasture.body.spaceId as string}
        `
        expect(held).toHaveLength(8)
        const audited = await owner`
          select entity_id, after from audit_entries
          where org_id = ${FIELD_BARN} and entity = 'horse_space_assignment' and field = 'pasture'
        `
        expect(audited).toHaveLength(8)
        expect(audited.every((row) => row.after === 'North')).toBe(true)
        const keys = await owner`
          select route from idempotency_keys
          where org_id = ${FIELD_BARN} and route like '%/horses/space/batch'
        `
        expect(keys).toHaveLength(1)
      })

      it('brings the same eight in with spaceId null', async () => {
        const api = await holder()
        const horseIds = await herd(api, EIGHT)
        const pasture = await post(api, '/spaces', { kind: 'pasture', name: 'North' })
        await post(api, '/horses/space/batch', {
          horseIds,
          kind: 'pasture',
          spaceId: pasture.body.spaceId,
        })

        const cleared = await post(api, '/horses/space/batch', {
          horseIds,
          kind: 'pasture',
          spaceId: null,
        })
        expect(cleared.status).toBe(200)
        expect(cleared.body).toEqual({ assigned: horseIds, skipped: [] })
        const held = await owner`
          select 1 from horse_space_assignments where org_id = ${FIELD_BARN} and kind = 'pasture'
        `
        expect(held).toHaveLength(0)
      })

      it('skips a Departed horse and one not found, naming each, and lands the rest', async () => {
        const api = await holder()
        const horseIds = await herd(api, EIGHT)
        const departedId = horseIds[3] as string
        await post(api, '/horses/departure', { horseId: departedId, departedOn: '2026-01-01' })
        const missingId = crypto.randomUUID()
        const paddock = await post(api, '/spaces', { kind: 'paddock', name: 'Paddock A' })

        const moved = await post(api, '/horses/space/batch', {
          horseIds: [...horseIds, missingId],
          kind: 'paddock',
          spaceId: paddock.body.spaceId,
        })
        expect(moved.status).toBe(200)
        expect(moved.body).toEqual({
          assigned: horseIds.filter((id) => id !== departedId),
          skipped: [
            { horseId: departedId, because: 'horse_departed' },
            { horseId: missingId, because: 'horse_not_found' },
          ],
        })
      })

      it('refuses the whole batch for a Space of another kind, since it is the same for everyone', async () => {
        const api = await holder()
        const horseIds = await herd(api, ['Ivy'])
        const barn = await post(api, '/spaces', { kind: 'barn', name: 'Big Barn' })

        const mismatched = await post(api, '/horses/space/batch', {
          horseIds,
          kind: 'pasture',
          spaceId: barn.body.spaceId,
        })
        expect(mismatched.status).toBe(409)
        expect(mismatched.body.error).toBe('space_kind_mismatch')
      })

      it('refuses a stall in the contract, and more than two hundred at once', async () => {
        const api = await holder()
        const horseIds = await herd(api, ['Juniper'])
        const stall = await post(api, '/spaces', { kind: 'stall', name: 'Stall 1' })

        const stalled = await post(api, '/horses/space/batch', {
          horseIds,
          kind: 'stall',
          spaceId: stall.body.spaceId,
        })
        expect(stalled.status).toBe(400)

        const tooMany = await post(api, '/horses/space/batch', {
          horseIds: Array.from({ length: 201 }, () => crypto.randomUUID()),
          kind: 'pasture',
          spaceId: null,
        })
        expect(tooMany.status).toBe(400)
      })

      it('refuses a roster-only holder', async () => {
        const id = await seedVolunteer('Rosa Roster', `rosa-${newIdempotencyKey()}@barn.test`)
        const api = apiAs(id, ['roster'])
        const refused = await post(api, '/horses/space/batch', {
          horseIds: [crypto.randomUUID()],
          kind: 'pasture',
          spaceId: null,
        })
        expect(refused.status).toBe(403)
      })
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

  describe('Alerts', () => {
    async function horseCalled(api: ReturnType<typeof apiAs>, name: string): Promise<string> {
      const created = await post(api, '/horses', { name })
      return created.body.horseId as string
    }

    it('raises one, and it stands in full at the top of the profile', async () => {
      const api = await holder()
      const horseId = await horseCalled(api, 'Biter')

      const raised = await post(api, '/alerts', {
        horseId,
        kind: 'prohibition',
        text: 'No treats by hand — she bites.',
      })
      expect(raised.status).toBe(201)

      const profile = await get(api, `/horses/${horseId}`)
      expect(profile.body.alerts).toEqual([
        expect.objectContaining({
          kind: 'prohibition',
          // The full words, never a count: that is the whole of ADR 0024.
          text: 'No treats by hand — she bites.',
          raisedByName: 'Priya Chandra',
          endedAt: null,
          endingReason: null,
        }),
      ])
      expect(profile.body.endedAlerts).toEqual([])

      const audited = await owner`
        select field, after from audit_entries
        where entity = 'alert' and entity_id = ${raised.body.alertId as string}
      `
      expect(audited).toHaveLength(1)
      expect(audited[0]).toMatchObject({ field: null, after: 'No treats by hand — she bites.' })
    })

    it('orders prohibition, then care, then allergy — the same on every surface', async () => {
      const api = await holder()
      const horseId = await horseCalled(api, 'Ordered')
      await post(api, '/alerts', { horseId, kind: 'allergy', text: 'Bee stings' })
      await post(api, '/alerts', { horseId, kind: 'care', text: 'Left eye drops' })
      await post(api, '/alerts', { horseId, kind: 'prohibition', text: 'No treats' })

      const profile = await get(api, `/horses/${horseId}`)
      expect((profile.body.alerts as { kind: string }[]).map((entry) => entry.kind)).toEqual([
        'prohibition',
        'care',
        'allergy',
      ])
    })

    it("reaches the Board in the horse's own cell, in full", async () => {
      const api = await holder()
      const horseId = await horseCalled(api, 'On The Wall')
      await post(api, '/alerts', { horseId, kind: 'care', text: 'Ties in the aisle only' })

      const grid = await get(api, '/board')
      const sections = grid.body.sections as { rows: { horse: Record<string, unknown> | null }[] }[]
      const found = sections
        .flatMap((section) => section.rows)
        .map((row) => row.horse)
        .find((horse) => horse?.id === horseId)
      expect(found?.alerts).toEqual([
        expect.objectContaining({ kind: 'care', text: 'Ties in the aisle only' }),
      ])
    })

    it('edits text and kind in place, auditing only what changed', async () => {
      const api = await holder()
      const horseId = await horseCalled(api, 'Reclassified')
      const raised = await post(api, '/alerts', { horseId, kind: 'care', text: 'Watch the hind' })
      const alertId = raised.body.alertId as string

      const edited = await post(api, '/alerts/edit', {
        alertId,
        kind: 'prohibition',
        text: 'Watch the hind',
      })
      expect(edited.status).toBe(204)

      const audited = await owner`
        select field, before, after from audit_entries
        where entity = 'alert' and entity_id = ${alertId} and field is not null
      `
      expect(audited).toHaveLength(1)
      expect(audited[0]).toMatchObject({ field: 'kind', before: 'care', after: 'prohibition' })
    })

    it('ends one with a reason — the row stays, and it leaves the standing list', async () => {
      const api = await holder()
      const horseId = await horseCalled(api, 'Reformed')
      const raised = await post(api, '/alerts', { horseId, kind: 'prohibition', text: 'No treats' })
      const alertId = raised.body.alertId as string

      const ended = await post(api, '/alerts/end', {
        alertId,
        reason: 'Six months without an incident; the vet agrees.',
      })
      expect(ended.status).toBe(204)

      const rows = await owner`select count(*)::int as n from alerts where id = ${alertId}`
      expect(rows[0]?.n).toBe(1)

      const profile = await get(api, `/horses/${horseId}`)
      expect(profile.body.alerts).toEqual([])
      expect(profile.body.endedAlerts).toEqual([
        expect.objectContaining({
          text: 'No treats',
          endingReason: 'Six months without an incident; the vet agrees.',
          endedByName: 'Priya Chandra',
        }),
      ])

      const grid = await get(api, '/board')
      const sections = grid.body.sections as { rows: { horse: Record<string, unknown> | null }[] }[]
      const found = sections
        .flatMap((section) => section.rows)
        .map((row) => row.horse)
        .find((horse) => horse?.id === horseId)
      expect(found?.alerts).toEqual([])
    })

    it('refuses a second ending, and refuses editing what is already ended', async () => {
      const api = await holder()
      const horseId = await horseCalled(api, 'Twice Ended')
      const raised = await post(api, '/alerts', { horseId, kind: 'care', text: 'Slow feeder' })
      const alertId = raised.body.alertId as string
      await post(api, '/alerts/end', { alertId, reason: 'Eats normally now.' })

      const again = await post(api, '/alerts/end', { alertId, reason: 'Again.' })
      expect(again.status).toBe(409)
      expect(again.body.error).toBe('alert_already_ended')

      const edited = await post(api, '/alerts/edit', { alertId, kind: 'care', text: 'Rewritten' })
      expect(edited.status).toBe(409)
      expect(edited.body.error).toBe('alert_already_ended')
    })

    it('refuses an ending with no reason at the contract, before any handler', async () => {
      const api = await holder()
      const horseId = await horseCalled(api, 'Unreasoned')
      const raised = await post(api, '/alerts', { horseId, kind: 'care', text: 'Slow feeder' })
      const alertId = raised.body.alertId as string

      const blank = await post(api, '/alerts/end', { alertId, reason: '' })
      expect(blank.status).toBe(400)

      // And a reason of three spaces is not a reason: it would store as an
      // empty string and render as *Ended:* with nothing after it.
      const spaces = await post(api, '/alerts/end', { alertId, reason: '   ' })
      expect(spaces.status).toBe(400)

      const rows = await owner`select ended_at from alerts where id = ${alertId}`
      expect(rows[0]?.ended_at).toBeNull()
    })

    it('refuses a fourth kind — the fence is closed (ADR 0024)', async () => {
      const api = await holder()
      const horseId = await horseCalled(api, 'Fenced')
      const refused = await post(api, '/alerts', {
        horseId,
        kind: 'behaviour',
        text: 'Not a kind this build knows',
      })
      expect(refused.status).toBe(400)
    })

    it('refuses all three writes from a Volunteer holding nothing, who still reads every Alert', async () => {
      const api = await holder()
      const horseId = await horseCalled(api, 'Read By All')
      const raised = await post(api, '/alerts', { horseId, kind: 'care', text: 'Slow feeder' })
      const alertId = raised.body.alertId as string

      const volunteer = await reader()
      // The floor's own door is the Observation, which escalates and mails
      // this Scope's holders — never a wall anybody may post to (ADR 0024).
      for (const attempt of [
        post(volunteer, '/alerts', { horseId, kind: 'care', text: 'Mine' }),
        post(volunteer, '/alerts/edit', { alertId, kind: 'care', text: 'Mine' }),
        post(volunteer, '/alerts/end', { alertId, reason: 'Mine' }),
      ]) {
        expect((await attempt).status).toBe(403)
      }

      const profile = await get(volunteer, `/horses/${horseId}`)
      expect(profile.body.alerts).toHaveLength(1)
    })

    it("keeps a Departed horse's Alerts standing on her profile — she is gone, not cured", async () => {
      const api = await holder()
      const horseId = await horseCalled(api, 'Departed With A Warning')
      await post(api, '/alerts', { horseId, kind: 'prohibition', text: 'No treats' })
      await post(api, '/horses/departure', { horseId, departedOn: '2026-08-01' })

      const profile = await get(api, `/horses/${horseId}`)
      expect(profile.body.alerts).toHaveLength(1)
      expect(profile.body.endedAlerts).toEqual([])
    })

    it('refuses raising one on a horse that does not exist', async () => {
      const api = await holder()
      const refused = await post(api, '/alerts', {
        horseId: crypto.randomUUID(),
        kind: 'care',
        text: 'Nobody',
      })
      expect(refused.status).toBe(404)
      expect(refused.body.error).toBe('horse_not_found')
    })
  })

  /**
   * The Timeline, and the list of horses with something going on (#74).
   *
   * The claims are the ticket's own acceptance: one section, newest first,
   * composed from records that already exist; every entry naming who and when;
   * an Escalation under the Observation it framed rather than beside it; a
   * Departed horse keeping her Timeline and leaving the list; and the list
   * derived, so closing an Escalation or ending an Alert drops her out with
   * nothing to clear.
   */
  describe('the Timeline', () => {
    /** The `horse_care` holder `holder()` seeded, whose acts the Timeline names. */
    async function priyaId(): Promise<string> {
      const rows = (await owner`
        select id from volunteers where org_id = ${FIELD_BARN} and name = 'Priya Chandra'
      `) as { id: string }[]
      return String(rows[0]?.id)
    }

    /** An Observation about a horse, recorded against an Attendance of its own. */
    async function observationAbout(
      horseId: string,
      volunteerId: string,
      text: string,
    ): Promise<string> {
      const [attendance] = await owner`
        insert into attendance (id, org_id, volunteer_id, category, description,
                                arrived_at, arrived_recorded_by)
        values (gen_random_uuid(), ${FIELD_BARN}, ${volunteerId}, 'other', 'Checking in',
                now(), ${volunteerId})
        returning id
      `
      const [observation] = await owner`
        insert into observations (id, org_id, attendance_id, text, subject_kind, subject_id,
                                  subject_label, recorded_by, observed_by)
        values (gen_random_uuid(), ${FIELD_BARN}, ${String(attendance?.id)}, ${text},
                'horse', ${horseId}, 'Storm', ${volunteerId}, ${volunteerId})
        returning id
      `
      return String(observation?.id)
    }

    async function escalate(
      observationId: string,
      volunteerId: string,
      framing: string,
      closed = false,
    ): Promise<string> {
      const [row] = await owner`
        insert into escalations (id, org_id, observation_id, scope, framing, escalated_by,
                                 closed_at, closed_by, closing_note)
        values (gen_random_uuid(), ${FIELD_BARN}, ${observationId}, 'horse_care', ${framing},
                ${volunteerId}, ${closed ? owner`now()` : null},
                ${closed ? volunteerId : null}, ${closed ? 'The farrier came.' : null})
        returning id
      `
      return String(row?.id)
    }

    it('gathers what is scattered across four screens onto the horse, newest first', async () => {
      const api = await holder()
      const actorId = await priyaId()
      const created = await post(api, '/horses', { name: 'Storm' })
      const horseId = created.body.horseId as string

      // One of each kind, in the order they happened.
      const raised = await post(api, '/alerts', {
        horseId,
        kind: 'prohibition',
        text: 'No treats by hand — she bites.',
      })
      await post(api, '/measurements', {
        horseId,
        kind: 'weight',
        value: 1040,
        method: 'tape',
        takenOn: '2026-03-02',
      })
      const observationId = await observationAbout(horseId, actorId, 'Favouring the near hind.')
      await escalate(observationId, actorId, 'She needs the farrier this week.')
      await post(api, '/alerts/end', {
        alertId: raised.body.alertId as string,
        reason: 'She has been fine on the ground for a season.',
      })

      const profile = await get(api, `/horses/${horseId}`)
      const timeline = profile.body.timeline as {
        kind: string
        on: string
        byName: string | null
        escalations?: { framing: string; closedAt: number | null; commentCount: number }[]
      }[]

      // Newest first, and the Escalation is *not* a sixth entry — it rides
      // under the Observation it framed (#74).
      expect(timeline.map((entry) => entry.kind)).toEqual([
        'alert_ended',
        'observation',
        'measurement',
        'alert_raised',
      ])
      // Every entry names who and when.
      for (const entry of timeline) {
        expect(entry.byName).toBe('Priya Chandra')
        expect(entry.on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
      expect(timeline[1]?.escalations).toEqual([
        expect.objectContaining({
          framing: 'She needs the farrier this week.',
          closedAt: null,
          commentCount: 0,
        }),
      ])
    })

    it('carries the reason an Alert ended, which is the only thing that answers why', async () => {
      const api = await holder()
      const created = await post(api, '/horses', { name: 'Reformed' })
      const horseId = created.body.horseId as string
      const raised = await post(api, '/alerts', { horseId, kind: 'care', text: 'Left eye drops' })
      await post(api, '/alerts/end', {
        alertId: raised.body.alertId as string,
        reason: 'The eye healed in March.',
      })

      const profile = await get(api, `/horses/${horseId}`)
      expect(profile.body.timeline).toContainEqual(
        expect.objectContaining({ kind: 'alert_ended', reason: 'The eye healed in March.' }),
      )
    })

    it('keeps a Departed horse’s Timeline whole, and takes her off the list', async () => {
      const api = await holder()
      const created = await post(api, '/horses', { name: 'Old Timer' })
      const horseId = created.body.horseId as string
      await post(api, '/alerts', { horseId, kind: 'allergy', text: 'Bee stings' })

      await post(api, '/horses/departure', { horseId, departedOn: '2026-04-01' })

      const profile = await get(api, `/horses/${horseId}`)
      // The history must not go with the horse leaving (#35).
      expect(profile.body.timeline).toHaveLength(1)

      const listed = await get(api, '/horses')
      expect(listed.body.attention).toEqual([])
    })

    it('lists a horse with a standing Alert, and drops her when it ends', async () => {
      const api = await holder()
      const created = await post(api, '/horses', { name: 'Biter' })
      const horseId = created.body.horseId as string
      const raised = await post(api, '/alerts', {
        horseId,
        kind: 'prohibition',
        text: 'No treats by hand.',
      })

      const listed = await get(api, '/horses')
      expect(listed.body.attention).toEqual([
        expect.objectContaining({
          horseId,
          horseName: 'Biter',
          because: 'alert',
          text: 'No treats by hand.',
        }),
      ])

      await post(api, '/alerts/end', {
        alertId: raised.body.alertId as string,
        reason: 'She stopped.',
      })

      // Derived, never stored: nothing had to be cleared for her to leave.
      expect((await get(api, '/horses')).body.attention).toEqual([])
    })

    it('lists a horse with an open Escalation, and drops her when it closes', async () => {
      const api = await holder()
      const actorId = await priyaId()
      const created = await post(api, '/horses', { name: 'Dawson' })
      const horseId = created.body.horseId as string
      const observationId = await observationAbout(horseId, actorId, 'Would not weight it.')
      const escalationId = await escalate(observationId, actorId, 'The near hind needs looking at.')

      expect((await get(api, '/horses')).body.attention).toEqual([
        expect.objectContaining({
          horseId,
          because: 'escalation',
          text: 'The near hind needs looking at.',
        }),
      ])

      await owner`
        update escalations set closed_at = now(), closed_by = ${actorId},
                               closing_note = 'The farrier came.'
        where id = ${escalationId}
      `
      expect((await get(api, '/horses')).body.attention).toEqual([])
    })

    it('is read by any Volunteer, because the floor reads everything', async () => {
      const holding = await holder()
      const created = await post(holding, '/horses', { name: 'Read Me' })
      const horseId = created.body.horseId as string
      await post(holding, '/alerts', { horseId, kind: 'care', text: 'Left eye drops' })

      const plain = await reader()
      const profile = await get(plain, `/horses/${horseId}`)
      expect(profile.status).toBe(200)
      expect(profile.body.timeline).toHaveLength(1)
      expect((await get(plain, '/horses')).body.attention).toHaveLength(1)
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
      const added = ['spaces', 'horses', 'horse_space_assignments', 'alerts']

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
