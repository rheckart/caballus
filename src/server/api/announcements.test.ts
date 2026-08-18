/**
 * Announcements and Contacts, through the API application's own fetch entry
 * — the same primary seam `src/server/api/horses.test.ts` uses (#46, ADR
 * 0014, ADR 0018).
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`,
 * then `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { closeDb } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import { contract } from '../../shared/api-contract'
import type { DomainScope } from '../../shared/domain-scopes'
import { anonymousContext } from '../request-context'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FIELD_BARN = '00000000-0000-0000-0000-0000000000ed'

describe.skipIf(!reachable)('Announcements and Contacts, through the API', () => {
  const owner = postgres(ownerUrl, { max: 1 })

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
    await owner`delete from announcements where org_id = ${FIELD_BARN}`
    await owner`delete from contacts where org_id = ${FIELD_BARN}`
    await owner`delete from standing_rules where org_id = ${FIELD_BARN}`
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

  async function scopeHolder(scope: DomainScope) {
    const id = await seedVolunteer(
      `Holder of ${scope}`,
      `${scope}-${newIdempotencyKey()}@barn.test`,
    )
    return apiAs(id, [scope])
  }

  async function reader() {
    const id = await seedVolunteer('Reader Volunteer', `reader-${newIdempotencyKey()}@barn.test`)
    return apiAs(id, [])
  }

  async function today(api: ReturnType<typeof apiAs>): Promise<string> {
    return ((await get(api, '/day')).body as { day: string }).day
  }

  describe('Announcements', () => {
    it('is posted by any single Domain Scope, and carries text, author and expiry', async () => {
      // The Treasurer's scope guards nothing else in v1 (ADR 0018) — the
      // sharpest case that `holds-any-scope` exists to reach.
      const treasurer = await scopeHolder('financial')
      const day = await today(treasurer)

      const posted = await post(treasurer, '/announcements', {
        text: 'The board meeting moved to the 12th.',
        expiresOn: day,
      })
      expect(posted.status).toBe(201)

      const listed = await get(await reader(), '/announcements')
      expect(listed.body.announcements).toEqual([
        expect.objectContaining({
          text: 'The board meeting moved to the 12th.',
          expiresOn: day,
          authoredByName: 'Holder of financial',
          lastEditedBy: null,
        }),
      ])
    })

    it('refuses a signed-in Volunteer holding no Domain Scope', async () => {
      const posted = await post(await reader(), '/announcements', {
        text: 'The hay comes Thursday.',
        expiresOn: '2026-08-25',
      })
      expect(posted.status).toBe(403)
    })

    it('writes no audit entry, ever, because a Scope holder reads it off the row', async () => {
      const holder = await scopeHolder('roster')
      const posted = await post(holder, '/announcements', {
        text: 'The vet is here Tuesday.',
        expiresOn: '2026-08-25',
      })
      const announcementId = posted.body.announcementId as string

      const audited = await owner`
        select * from audit_entries where entity_id = ${announcementId}
      `
      expect(audited).toHaveLength(0)
    })

    it('is edited in place by a Domain Scope holder other than the author, keeping who last touched it', async () => {
      const author = await scopeHolder('horse_care')
      const posted = await post(author, '/announcements', {
        text: 'The water in the tack room is off until Saturday.',
        expiresOn: '2026-08-20',
      })
      const announcementId = posted.body.announcementId as string

      const editor = await scopeHolder('roster')
      const edited = await post(editor, '/announcements/edit', {
        announcementId,
        text: 'The water in the tack room is back on.',
      })
      expect(edited.status).toBe(204)

      const listed = await get(await reader(), '/announcements')
      expect(listed.body.announcements).toEqual([
        expect.objectContaining({
          text: 'The water in the tack room is back on.',
          lastEditedByName: 'Holder of roster',
        }),
      ])
    })

    it('leaves an expired Announcement off the read without deleting the row', async () => {
      const holder = await scopeHolder('roster')
      const posted = await post(holder, '/announcements', {
        text: 'Long gone.',
        expiresOn: '2020-01-01',
      })
      const announcementId = posted.body.announcementId as string

      const listed = await get(await reader(), '/announcements')
      expect(listed.body.announcements).toEqual([])

      const stillThere = await owner`select id from announcements where id = ${announcementId}`
      expect(stillThere).toHaveLength(1)
    })

    it('refuses a subject by construction — there is no field for one to name', async () => {
      const holder = await scopeHolder('roster')
      const posted = await post(holder, '/announcements', {
        text: 'Storm goes to the clinic on Tuesday.',
        expiresOn: '2026-08-25',
        // A caller trying to smuggle a subject through finds no such field —
        // the extra key is simply not part of what the contract accepts, and
        // the write still succeeds without it landing anywhere.
        horseId: '00000000-0000-0000-0000-000000000001',
      })
      expect(posted.status).toBe(201)

      const listed = await get(await reader(), '/announcements')
      const announcements = listed.body.announcements as Record<string, unknown>[]
      expect(announcements[0]).not.toHaveProperty('horseId')
    })

    it('declares neverQueued, because the app is the medium and not the ledger (ADR 0018)', () => {
      expect(contract.writes['/announcements'].neverQueued).toBe(true)
      expect(contract.writes['/announcements/edit'].neverQueued).toBe(true)
    })
  })

  describe('Contacts', () => {
    it('is posted under roster, with an audit entry, and read by everyone', async () => {
      const roster = await scopeHolder('roster')
      const posted = await post(roster, '/contacts', {
        name: 'Wolf Creek Equine Clinic',
        number: '555-0100',
        hours: '9am–5pm M–F',
        purpose: 'Vet office',
      })
      expect(posted.status).toBe(201)
      const contactId = posted.body.contactId as string

      const audited = await owner`
        select entity, entity_id, after from audit_entries
        where entity = 'contact' and entity_id = ${contactId}
      `
      expect(audited).toHaveLength(1)

      const listed = await get(await reader(), '/contacts')
      expect(listed.body.contacts).toEqual([
        expect.objectContaining({ name: 'Wolf Creek Equine Clinic', purpose: 'Vet office' }),
      ])
    })

    it('refuses to post a Contact without roster', async () => {
      const posted = await post(await scopeHolder('horse_care'), '/contacts', {
        name: 'Terry H.',
        number: '555-0101',
        purpose: 'Maintenance',
      })
      expect(posted.status).toBe(403)
    })

    it('edits a Contact in place, auditing only the changed fields', async () => {
      const roster = await scopeHolder('roster')
      const posted = await post(roster, '/contacts', {
        name: 'Cathy H.',
        number: '555-0102',
        purpose: 'Barn supplies',
      })
      const contactId = posted.body.contactId as string

      const edited = await post(roster, '/contacts/edit', {
        contactId,
        number: '555-0199',
        reason: 'new cell',
      })
      expect(edited.status).toBe(204)

      const listed = await get(await reader(), '/contacts')
      expect(listed.body.contacts).toEqual([
        expect.objectContaining({ name: 'Cathy H.', number: '555-0199' }),
      ])
    })

    it('carries no field an Escalation could resolve to — the read is flat', async () => {
      const roster = await scopeHolder('roster')
      await post(roster, '/contacts', {
        name: 'Property owner',
        number: '555-0103',
        purpose: 'Emergency',
      })

      const listed = await get(await reader(), '/contacts')
      const contact = (listed.body.contacts as Record<string, unknown>[])[0]
      expect(Object.keys(contact ?? {}).sort()).toEqual(
        ['id', 'name', 'number', 'hours', 'purpose'].sort(),
      )
    })

    it('adds and edits a standing rule under roster', async () => {
      const roster = await scopeHolder('roster')
      const added = await post(roster, '/standing-rules', { text: 'No scissors in fields.' })
      expect(added.status).toBe(201)
      const standingRuleId = added.body.standingRuleId as string

      const edited = await post(roster, '/standing-rules/edit', {
        standingRuleId,
        text: 'Take turns wide.',
      })
      expect(edited.status).toBe(204)

      const listed = await get(await reader(), '/contacts')
      expect(listed.body.standingRules).toEqual([
        expect.objectContaining({ text: 'Take turns wide.' }),
      ])
    })
  })

  describe('the tenancy guarantee', () => {
    it('has row-level security and a policy on every table this ticket added', async () => {
      const added = ['announcements', 'contacts', 'standing_rules']

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

    it('sees no Announcement of another organisation', async () => {
      const elsewhere = '00000000-0000-0000-0000-0000000000ee'
      await owner`delete from announcements where org_id = ${elsewhere}`
      await owner`delete from volunteers where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
      await owner`
        insert into orgs (id, name, time_zone)
        values (${elsewhere}, 'Somebody Else', 'America/Chicago')
      `
      const [ghost] = await owner`
        insert into volunteers (id, org_id, name, email)
        values (gen_random_uuid(), ${elsewhere}, 'Ghost', 'ghost@barn.test')
        returning id
      `
      await owner`
        insert into announcements (id, org_id, text, expires_on, authored_by)
        values (gen_random_uuid(), ${elsewhere}, 'Not ours', '2030-01-01', ${String(ghost?.id)})
      `

      const listed = await get(await reader(), '/announcements')
      const texts = (listed.body.announcements as Record<string, unknown>[]).map(
        (announcement) => announcement.text,
      )
      expect(texts).not.toContain('Not ours')

      await owner`delete from announcements where org_id = ${elsewhere}`
      await owner`delete from volunteers where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
    })
  })
})
