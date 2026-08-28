/**
 * The roster's front door, through the API application's own fetch entry.
 *
 * This is the spec's primary seam: the real contract, the real handlers, the
 * real tables, and a **supplied request context** — somebody put in the barn
 * rather than signed in, because where an actor comes from a real cookie is
 * `src/server/auth/sign-in.test.ts` and repeating it here would test Better
 * Auth twice and the gates once.
 *
 * Against a real Postgres, deliberately. Every claim below is a claim about
 * rows: that a policy scopes them, that an Orientation cannot be ticked twice,
 * that publishing a Version stales a signature without touching anybody. A fake
 * agrees with whatever it is asked.
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`, then
 * `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { closeDb, forOrg, type OrgId } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE } from '../../shared/api-client'
import type { DomainScope } from '../../shared/domain-scopes'
import { newIdempotencyKey } from '../../shared/api-client'
import { anonymousContext, currentOrgId } from '../request-context'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FRONT_BARN = '00000000-0000-0000-0000-0000000000d4'

describe.skipIf(!reachable)('the roster, through the API', () => {
  const owner = postgres(ownerUrl, { max: 1 })

  function orgId(): OrgId {
    process.env.APP_ORG_ID = FRONT_BARN
    return currentOrgId()
  }

  /**
   * The API with one person in the barn holding exactly these scopes.
   *
   * The actor is a Volunteer id and a scope list, which is what
   * `request-context` resolves from a session — so this is the same shape a
   * signed-in request produces, arrived at without a cookie.
   */
  function apiAs(volunteerId: string, scopes: readonly DomainScope[]) {
    return buildApi({
      idempotency: postgresIdempotency(),
      context: (request) => ({
        ...anonymousContext(request),
        actor: { volunteerId, domainScopes: scopes },
      }),
    })
  }

  const OFFICER_SCOPES: readonly DomainScope[] = ['roster', 'grants', 'horse_care']

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

  /** A write, with a fresh key — the client mints one per write (ADR 0005). */
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

  /**
   * The Coordinator herself — a Volunteer row, because every write records who
   * did it and the audit entry's foreign key is real.
   */
  let coordinatorId = ''

  beforeAll(async () => {
    process.env.APP_ORG_ID = FRONT_BARN
    await wipe()
    await owner`
      insert into orgs (id, name, time_zone)
      values (${FRONT_BARN}, 'Front Barn Horse Rescue', 'America/New_York')
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
    await owner`delete from audit_entries where org_id = ${FRONT_BARN}`
    await owner`delete from release_signatures where org_id = ${FRONT_BARN}`
    await owner`delete from release_versions where org_id = ${FRONT_BARN}`
    await owner`delete from volunteer_consents where org_id = ${FRONT_BARN}`
    await owner`delete from medication_authority where org_id = ${FRONT_BARN}`
    await owner`delete from volunteer_roles where org_id = ${FRONT_BARN}`
    await owner`delete from volunteer_accounts where org_id = ${FRONT_BARN}`
    await owner`delete from idempotency_keys where org_id = ${FRONT_BARN}`
    await owner`update volunteers set date_of_birth_recorded_by = null,
      orientation_recorded_by = null where org_id = ${FRONT_BARN}`
    await owner`delete from volunteers where org_id = ${FRONT_BARN}`
    if (!keepOrg) await owner`delete from orgs where id = ${FRONT_BARN}`
  }

  /** A Volunteer created outside the API, for the actor the API needs. */
  async function seedVolunteer(name: string, email: string): Promise<string> {
    const [row] = await owner`
      insert into volunteers (id, org_id, name, email)
      values (gen_random_uuid(), ${FRONT_BARN}, ${name}, ${email})
      returning id
    `
    return String(row?.id)
  }

  /** The Coordinator, freshly, since `afterEach` takes every Volunteer with it. */
  async function coordinator() {
    coordinatorId = await seedVolunteer('Grace Whittaker', `grace-${newIdempotencyKey()}@barn.test`)
    return apiAs(coordinatorId, OFFICER_SCOPES)
  }

  /** The current Release Version, published so a signature has something to cite. */
  async function publishVersion(
    api: ReturnType<typeof apiAs>,
    validFrom: string,
    obsoletesPrior = false,
  ): Promise<string> {
    const published = await post(api, '/release-versions', {
      label: `Updated ${validFrom.slice(0, 4)}`,
      validFrom,
      obsoletesPrior,
    })
    expect(published.status).toBe(201)
    return String(published.body.releaseVersionId)
  }

  /** One person out of the people list, by name. */
  async function personNamed(api: ReturnType<typeof apiAs>, name: string) {
    const listed = await get(api, '/volunteers')
    expect(listed.status).toBe(200)
    const people = listed.body.people as Record<string, unknown>[]
    const found = people.find((person) => person.name === name)
    if (found === undefined) throw new Error(`${name} is not on the people list`)
    return found
  }

  describe('creating a Volunteer', () => {
    it('makes a Candidate with neither Account nor login', async () => {
      const api = await coordinator()

      const created = await post(api, '/volunteers', {
        name: 'Beth Alderson',
        email: 'Beth@Example.Invalid',
        smsConsent: false,
      })
      expect(created.status).toBe(201)

      const beth = await personNamed(api, 'Beth Alderson')
      expect(beth.state).toBe('candidate')
      expect(beth.hasAccount).toBe(false)
      expect(beth.rosterable).toBe(false)
      // Both gates, not the first one: the screen shows what she is missing.
      expect(beth.gaps).toEqual(['no_orientation', 'no_current_release'])
    })

    it('refuses somebody who does not hold roster, naming the scope it wanted', async () => {
      const helper = await seedVolunteer('Terry Mott', 'terry@example.invalid')
      const api = apiAs(helper, ['maintenance'])

      const refused = await post(api, '/volunteers', {
        name: 'Beth Alderson',
        email: 'beth@example.invalid',
        smsConsent: false,
      })

      expect(refused.status).toBe(403)
      expect(refused.body).toMatchObject({ error: 'not_authorized', wanted: 'roster' })
    })

    it('refuses a second live Volunteer at one address', async () => {
      const api = await coordinator()
      await post(api, '/volunteers', {
        name: 'Beth',
        email: 'beth@example.invalid',
        smsConsent: false,
      })

      const again = await post(api, '/volunteers', {
        name: 'Beth Again',
        // The same address, spelled differently — normalised on the way in.
        email: ' BETH@example.invalid ',
        smsConsent: false,
      })

      expect(again.status).toBe(409)
      expect(again.body).toMatchObject({ error: 'email_taken' })
    })
  })

  describe('the three gates', () => {
    it('refuses an Orientation before a date of birth is established', async () => {
      const api = await coordinator()
      const created = await post(api, '/volunteers', {
        name: 'Beth',
        email: 'beth@example.invalid',
        smsConsent: false,
      })

      const refused = await post(api, '/volunteers/orientation', {
        volunteerId: created.body.volunteerId,
        orientedOn: '2026-08-17',
      })

      expect(refused.status).toBe(409)
      expect(refused.body).toMatchObject({ error: 'date_of_birth_not_established' })
    })

    it('opens every gate for an oriented adult with a current release', async () => {
      const api = await coordinator()
      const versionId = await publishVersion(api, '2020-01-01')
      const created = await post(api, '/volunteers', {
        name: 'Beth',
        email: 'beth@example.invalid',
        smsConsent: false,
      })
      const volunteerId = created.body.volunteerId

      expect(
        (
          await post(api, '/volunteers/date-of-birth', {
            volunteerId,
            dateOfBirth: '1984-05-06',
            provenance: 'photo_id',
          })
        ).status,
      ).toBe(204)
      expect(
        (await post(api, '/volunteers/orientation', { volunteerId, orientedOn: '2026-08-17' }))
          .status,
      ).toBe(204)
      expect(
        (
          await post(api, '/volunteers/release', {
            volunteerId,
            releaseVersionId: versionId,
            signedOn: '2026-08-17',
            byParent: false,
          })
        ).status,
      ).toBe(201)

      const beth = await personNamed(api, 'Beth')
      expect(beth.state).toBe('volunteer')
      expect(beth.rosterable).toBe(true)
      expect(beth.gaps).toEqual([])
    })

    it('never lets an Orientation be ticked twice, because it never lapses', async () => {
      const api = await coordinator()
      const created = await post(api, '/volunteers', {
        name: 'Beth',
        email: 'beth@example.invalid',
        smsConsent: false,
      })
      const volunteerId = created.body.volunteerId
      await post(api, '/volunteers/date-of-birth', {
        volunteerId,
        dateOfBirth: '1984-05-06',
        provenance: 'photo_id',
      })
      await post(api, '/volunteers/orientation', { volunteerId, orientedOn: '2026-08-17' })

      const again = await post(api, '/volunteers/orientation', {
        volunteerId,
        orientedOn: '2020-01-01',
      })

      expect(again.status).toBe(409)
      expect(again.body).toMatchObject({ error: 'already_oriented' })
    })

    it('refuses a release somebody recorded about themselves', async () => {
      const api = await coordinator()
      const versionId = await publishVersion(api, '2020-01-01')

      const refused = await post(api, '/volunteers/release', {
        volunteerId: coordinatorId,
        releaseVersionId: versionId,
        signedOn: '2026-08-17',
        byParent: false,
      })

      expect(refused.status).toBe(409)
      expect(refused.body).toMatchObject({ error: 'self_recorded' })
    })

    it('gates a minor on a Consent as well, and takes it when given', async () => {
      const api = await coordinator()
      const versionId = await publishVersion(api, '2020-01-01')
      const created = await post(api, '/volunteers', {
        name: 'Sophie',
        email: 'sophie@example.invalid',
        smsConsent: false,
      })
      const volunteerId = created.body.volunteerId
      await post(api, '/volunteers/date-of-birth', {
        volunteerId,
        // Fifteen for a good while yet, whenever this test runs.
        dateOfBirth: '2015-09-01',
        provenance: 'parent_provided',
      })
      await post(api, '/volunteers/orientation', { volunteerId, orientedOn: '2026-08-17' })
      await post(api, '/volunteers/release', {
        volunteerId,
        releaseVersionId: versionId,
        signedOn: '2026-08-17',
        byParent: true,
      })

      const beforeConsent = await personNamed(api, 'Sophie')
      expect(beforeConsent.isMinor).toBe(true)
      expect(beforeConsent.gaps).toEqual(['no_consent'])

      expect(
        (
          await post(api, '/volunteers/consent', {
            volunteerId,
            consentedOn: '2026-08-17',
            parentName: 'Helen Marsh',
          })
        ).status,
      ).toBe(204)

      const after = await personNamed(api, 'Sophie')
      expect(after.rosterable).toBe(true)
      expect(after.consentIsHistorical).toBe(false)
    })

    it('refuses a Consent for somebody who is not a minor', async () => {
      const api = await coordinator()
      const created = await post(api, '/volunteers', {
        name: 'Beth',
        email: 'beth@example.invalid',
        smsConsent: false,
      })
      const volunteerId = created.body.volunteerId
      await post(api, '/volunteers/date-of-birth', {
        volunteerId,
        dateOfBirth: '1984-05-06',
        provenance: 'photo_id',
      })

      const refused = await post(api, '/volunteers/consent', {
        volunteerId,
        consentedOn: '2026-08-17',
        parentName: 'Helen Marsh',
      })

      expect(refused.status).toBe(409)
      expect(refused.body).toMatchObject({ error: 'not_a_minor' })
    })
  })

  describe('a Release Version published to obsolete what came before', () => {
    it('stales the signature and flags the Volunteer without removing anything', async () => {
      const api = await coordinator()
      const oldVersion = await publishVersion(api, '2020-01-01')
      const created = await post(api, '/volunteers', {
        name: 'Beth',
        email: 'beth@example.invalid',
        smsConsent: false,
      })
      const volunteerId = created.body.volunteerId
      await post(api, '/volunteers/date-of-birth', {
        volunteerId,
        dateOfBirth: '1984-05-06',
        provenance: 'photo_id',
      })
      await post(api, '/volunteers/orientation', { volunteerId, orientedOn: '2020-02-01' })
      await post(api, '/volunteers/release', {
        volunteerId,
        releaseVersionId: oldVersion,
        signedOn: '2020-02-01',
        byParent: false,
      })
      expect((await personNamed(api, 'Beth')).rosterable).toBe(true)

      await publishVersion(api, '2026-01-01', true)

      const flagged = await personNamed(api, 'Beth')
      expect(flagged.rosterable).toBe(false)
      expect(flagged.gaps).toEqual(['no_current_release'])
      // Flagged, never removed: she is still a Volunteer, still oriented, and
      // the signature she gave is still on her record.
      expect(flagged.state).toBe('volunteer')
      const behind = flagged.behindRoster as Record<string, unknown>
      expect((behind.signatures as unknown[]).length).toBe(1)
    })

    it('writes no audit entry, because a versioned change is a version', async () => {
      const api = await coordinator()
      await publishVersion(api, '2026-01-01', true)

      const entries = await get(api, '/audit')
      const published = (entries.body.entries as Record<string, unknown>[]).filter(
        (entry) => entry.entity === 'release_version',
      )
      expect(published).toEqual([])
    })

    it('stales the old text even when the paper is recorded after the re-papering', async () => {
      // The Coordinator works a paper backlog, so a signature against the 2020
      // text can be recorded the week after counsel replaced it. Read off
      // `signedOn` it would look current; read off the Version it is the text
      // that was replaced.
      const api = await coordinator()
      const oldVersion = await publishVersion(api, '2020-01-01')
      await publishVersion(api, '2026-01-01', true)
      const created = await post(api, '/volunteers', {
        name: 'Beth',
        email: 'beth@example.invalid',
        smsConsent: false,
      })
      const volunteerId = created.body.volunteerId
      await post(api, '/volunteers/date-of-birth', {
        volunteerId,
        dateOfBirth: '1984-05-06',
        provenance: 'photo_id',
      })
      await post(api, '/volunteers/orientation', { volunteerId, orientedOn: '2020-02-01' })

      await post(api, '/volunteers/release', {
        volunteerId,
        releaseVersionId: oldVersion,
        // Signed today, against the text that has been replaced.
        signedOn: '2026-08-17',
        byParent: false,
      })

      expect((await personNamed(api, 'Beth')).gaps).toEqual(['no_current_release'])
    })

    it('revoking a signature fails the gate', async () => {
      const api = await coordinator()
      const versionId = await publishVersion(api, '2020-01-01')
      const created = await post(api, '/volunteers', {
        name: 'Beth',
        email: 'beth@example.invalid',
        smsConsent: false,
      })
      const volunteerId = created.body.volunteerId
      await post(api, '/volunteers/date-of-birth', {
        volunteerId,
        dateOfBirth: '1984-05-06',
        provenance: 'photo_id',
      })
      await post(api, '/volunteers/orientation', { volunteerId, orientedOn: '2020-02-01' })
      const signature = await post(api, '/volunteers/release', {
        volunteerId,
        releaseVersionId: versionId,
        signedOn: '2020-02-01',
        byParent: false,
      })

      const revoked = await post(api, '/volunteers/release-revocation', {
        signatureId: signature.body.signatureId,
        reason: 'revoked in writing, 2026',
      })
      expect(revoked.status).toBe(204)

      expect((await personNamed(api, 'Beth')).gaps).toEqual(['no_current_release'])
    })
  })

  describe('what a volunteer may read about another', () => {
    it('shows day and month to everyone and keeps the year behind roster', async () => {
      const officer = await coordinator()
      const created = await post(officer, '/volunteers', {
        name: 'Beth',
        email: 'beth@example.invalid',
        smsConsent: false,
      })
      await post(officer, '/volunteers/date-of-birth', {
        volunteerId: created.body.volunteerId,
        dateOfBirth: '1984-05-06',
        provenance: 'photo_id',
      })

      const asOfficer = await personNamed(officer, 'Beth')
      expect(asOfficer.birthday).toEqual({ month: 5, day: 6 })
      expect(asOfficer.behindRoster).toMatchObject({
        dateOfBirth: '1984-05-06',
        email: 'beth@example.invalid',
      })

      const floorReader = apiAs(coordinatorId, [])
      const asAnyone = await personNamed(floorReader, 'Beth')
      // The birthday, because the rescue has a party. Nothing else.
      expect(asAnyone.birthday).toEqual({ month: 5, day: 6 })
      expect(asAnyone.behindRoster).toBeNull()
      expect(asAnyone.isMinor).toBe(false)
    })

    it('keeps the audit log behind roster', async () => {
      await coordinator()
      const floorReader = apiAs(coordinatorId, ['horse_care'])

      const refused = await get(floorReader, '/audit')

      expect(refused.status).toBe(403)
      expect(refused.body).toMatchObject({ error: 'not_authorized', wanted: 'roster' })
    })
  })

  describe('Roles and Medication Authority', () => {
    it('grants a Role under grants and refuses it under roster alone', async () => {
      const officer = await coordinator()
      const created = await post(officer, '/volunteers', {
        name: 'Terry',
        email: 'terry@example.invalid',
        smsConsent: false,
      })
      const volunteerId = created.body.volunteerId

      const coordinatorOnly = apiAs(coordinatorId, ['roster'])
      const refused = await post(coordinatorOnly, '/volunteers/roles', {
        volunteerId,
        role: 'head_of_maintenance',
      })
      expect(refused.status).toBe(403)
      expect(refused.body).toMatchObject({ wanted: 'grants' })

      expect(
        (await post(officer, '/volunteers/roles', { volunteerId, role: 'head_of_maintenance' }))
          .status,
      ).toBe(204)

      const terry = await personNamed(officer, 'Terry')
      expect(terry.roles).toEqual(['head_of_maintenance'])
      // Enumerated from the constant, not a wildcard.
      expect(terry.domainScopes).toEqual(['maintenance'])
    })

    it('refuses to let anybody grant themselves a Role', async () => {
      const officer = await coordinator()

      const refused = await post(officer, '/volunteers/roles', {
        volunteerId: coordinatorId,
        role: 'president',
      })

      expect(refused.status).toBe(409)
      expect(refused.body).toMatchObject({ error: 'self_granted' })
    })

    it('refuses to revoke the last holder of grants', async () => {
      const officer = await coordinator()
      const other = await seedVolunteer('Val', 'val@example.invalid')
      await post(officer, '/volunteers/roles', { volunteerId: other, role: 'president' })

      const refused = await post(officer, '/volunteers/role-revocation', {
        volunteerId: other,
        role: 'president',
      })
      expect(refused.status).toBe(409)
      expect(refused.body).toMatchObject({ error: 'last_grants_holder' })

      // With a second officer it goes through, which is what makes the refusal
      // above a guard rather than a wall.
      const third = await seedVolunteer('Anne', 'anne@example.invalid')
      await post(officer, '/volunteers/roles', { volunteerId: third, role: 'board_member' })
      expect(
        (
          await post(officer, '/volunteers/role-revocation', {
            volunteerId: other,
            role: 'president',
          })
        ).status,
      ).toBe(204)
    })

    it('lets an officer holding two officer Roles give one up', async () => {
      // The guard is about `grants` surviving, not about one person keeping a
      // Role: somebody holding President *and* Board Member still holds
      // `grants` after one of them goes.
      const officer = await coordinator()
      const other = await seedVolunteer('Val', 'val@example.invalid')
      await post(officer, '/volunteers/roles', { volunteerId: other, role: 'president' })
      await post(officer, '/volunteers/roles', { volunteerId: other, role: 'board_member' })

      const revoked = await post(officer, '/volunteers/role-revocation', {
        volunteerId: other,
        role: 'president',
      })

      expect(revoked.status).toBe(204)
      expect((await personNamed(officer, 'Val')).roles).toEqual(['board_member'])
    })

    it('refuses to remove the last holder of grants from the rescue', async () => {
      // The second door to the same state, and it is `roster` rather than
      // `grants` — so without the guard here, revoking the role is refused and
      // removing the person is not (ADR 0010).
      const officer = await coordinator()
      const other = await seedVolunteer('Val', 'val@example.invalid')
      await post(officer, '/volunteers/roles', { volunteerId: other, role: 'president' })

      const refused = await post(officer, '/volunteers/removal', { volunteerId: other })
      expect(refused.status).toBe(409)
      expect(refused.body).toMatchObject({ error: 'last_grants_holder' })

      // Still here, and still an officer.
      expect((await personNamed(officer, 'Val')).roles).toEqual(['president'])

      // With a second officer it goes through.
      const third = await seedVolunteer('Anne', 'anne@example.invalid')
      await post(officer, '/volunteers/roles', { volunteerId: third, role: 'board_member' })
      expect((await post(officer, '/volunteers/removal', { volunteerId: other })).status).toBe(204)
    })

    it('grants Medication Authority under horse_care and audits it', async () => {
      const officer = await coordinator()
      const created = await post(officer, '/volunteers', {
        name: 'Val',
        email: 'val@example.invalid',
        smsConsent: false,
      })
      const volunteerId = created.body.volunteerId

      const rosterOnly = apiAs(coordinatorId, ['roster'])
      expect(
        (await post(rosterOnly, '/volunteers/medication-authority', { volunteerId, granted: true }))
          .status,
      ).toBe(403)

      expect(
        (await post(officer, '/volunteers/medication-authority', { volunteerId, granted: true }))
          .status,
      ).toBe(204)
      expect((await personNamed(officer, 'Val')).medicationAuthority).toBe(true)

      expect(
        (await post(officer, '/volunteers/medication-authority', { volunteerId, granted: false }))
          .status,
      ).toBe(204)
      expect((await personNamed(officer, 'Val')).medicationAuthority).toBe(false)

      const entries = (await get(officer, '/audit')).body.entries as Record<string, unknown>[]
      const about = entries.filter((entry) => entry.entity === 'medication_authority')
      expect(about.map((entry) => [entry.before, entry.after])).toEqual([
        ['granted', null],
        [null, 'granted'],
      ])
    })
  })

  describe('removing somebody from the rescue', () => {
    it('takes their grants with them and audits every one', async () => {
      const officer = await coordinator()
      const created = await post(officer, '/volunteers', {
        name: 'Terry',
        email: 'terry@example.invalid',
        smsConsent: false,
      })
      const volunteerId = created.body.volunteerId
      await post(officer, '/volunteers/roles', { volunteerId, role: 'head_of_maintenance' })

      expect((await post(officer, '/volunteers/removal', { volunteerId })).status).toBe(204)

      const listed = await get(officer, '/volunteers')
      const names = (listed.body.people as Record<string, unknown>[]).map((person) => person.name)
      expect(names).not.toContain('Terry')

      const entries = (await get(officer, '/audit')).body.entries as Record<string, unknown>[]
      expect(
        entries.some(
          (entry) => entry.entity === 'volunteer_role' && entry.before === 'head_of_maintenance',
        ),
      ).toBe(true)
    })
  })

  describe('the staffing question admin surfaces', () => {
    it('names the scopes no non-officer holds', async () => {
      const officer = await coordinator()
      const listed = await get(officer, '/volunteers')

      // Nobody but officers holds anything here, and `supplies` has no Role at
      // all — the standing example of the app asking a question the rescue has
      // not answered.
      expect(listed.body.unstaffedScopes).toContain('supplies')
    })
  })

  describe('the tenancy guarantee', () => {
    it('sees no Volunteer of another organisation', async () => {
      const elsewhere = '00000000-0000-0000-0000-0000000000d5'
      await owner`delete from volunteers where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
      await owner`
        insert into orgs (id, name, time_zone)
        values (${elsewhere}, 'Somebody Else', 'America/Chicago')
      `
      await owner`
        insert into volunteers (id, org_id, name, email)
        values (gen_random_uuid(), ${elsewhere}, 'Not Ours', 'not-ours@example.invalid')
      `

      const officer = await coordinator()
      const listed = await get(officer, '/volunteers')
      const names = (listed.body.people as Record<string, unknown>[]).map((person) => person.name)

      expect(names).not.toContain('Not Ours')

      await owner`delete from volunteers where org_id = ${elsewhere}`
      await owner`delete from orgs where id = ${elsewhere}`
    })

    it('has row-level security and a policy on every table this ticket added', async () => {
      // ADR 0007's one structural guarantee, asserted against the catalogue
      // rather than against behaviour — because the failure this catches is a
      // *future* table added without `enableRLS()`, which every test of
      // existing behaviour would still pass.
      const added = [
        'release_versions',
        'release_signatures',
        'volunteer_consents',
        'medication_authority',
        'audit_entries',
      ]

      const rows = await owner`
        select c.relname as table, c.relrowsecurity as enabled, count(p.polname) as policies
        from pg_class c
        left join pg_policy p on p.polrelid = c.oid
        where c.relname in ${owner(added)}
        group by c.relname, c.relrowsecurity
      `

      expect(rows.map((row) => String(row.table)).sort()).toEqual([...added].sort())
      // Asserted as one object so a failure names the table that is missing a
      // policy rather than saying `false is not true`.
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
      // `current_setting('app.org_id', true)` is null when nothing set it, and
      // `=` against null is null rather than true — so the failure mode is an
      // empty answer and never another organisation's rows (ADR 0007).
      await coordinator()
      const unscoped = postgres(applicationUrl, { max: 1 })
      try {
        const rows = await unscoped`select count(*)::int as n from volunteers`
        expect(rows[0]?.n).toBe(0)
      } finally {
        await unscoped.end()
      }

      const scoped = await forOrg(orgId()).run((db) =>
        db.execute(`select count(*)::int as n from volunteers`),
      )
      expect((scoped as unknown as { n: number }[])[0]?.n).toBeGreaterThan(0)
    })
  })
})
