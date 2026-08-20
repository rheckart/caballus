/**
 * `npm run bootstrap`, against a real Postgres — because the claim under test
 * is a claim about rows: that the founding President holds `president`, and
 * that they clear ADR 0017's release gate without anybody having recorded a
 * signature about them.
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`, then
 * `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { closeDb, forOrg, type OrgId } from '../../db/for-org'
import { peopleList } from '../roster/people'
import { publishReleaseVersion } from '../roster/releases'
import { dayString } from '../../shared/time'
import { bootstrap } from './bootstrap'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const FRONT_BARN = '00000000-0000-0000-0000-0000000000f1'

describe.skipIf(!reachable)('bootstrap', () => {
  const owner = postgres(ownerUrl, { max: 1 })

  function orgId(): OrgId {
    return FRONT_BARN as OrgId
  }

  afterEach(async () => {
    await wipe({ keepOrg: false })
  })

  afterAll(async () => {
    await owner.end()
    await closeDb()
  })

  async function wipe({ keepOrg }: { keepOrg: boolean }): Promise<void> {
    await owner`delete from audit_entries where org_id = ${FRONT_BARN}`
    await owner`delete from release_signatures where org_id = ${FRONT_BARN}`
    await owner`delete from release_versions where org_id = ${FRONT_BARN}`
    await owner`delete from volunteer_roles where org_id = ${FRONT_BARN}`
    await owner`delete from volunteers where org_id = ${FRONT_BARN}`
    if (!keepOrg) await owner`delete from orgs where id = ${FRONT_BARN}`
  }

  it('grants the founding President a release signature nobody else could ever record', async () => {
    const member = await bootstrap({
      orgId: FRONT_BARN as OrgId,
      organisation: 'Front Barn Horse Rescue',
      timeZone: 'America/New_York',
      name: 'Grace Whittaker',
      email: 'grace@barn.test',
    })

    const [person] = await forOrg(orgId()).run((db) =>
      peopleList(db, dayString('2025-01-01'), true),
    )
    expect(person?.id).toBe(member.volunteerId)
    expect(person?.roles).toContain('president')
    // The release gate is the one this fix closes: it must not appear among
    // the gaps, and it would with no signature on file.
    expect(person?.gaps).not.toContain('no_current_release')

    const [signature] = await owner`
      select recorded_by from release_signatures where org_id = ${FRONT_BARN}
    `
    // No actor: the bootstrap floor, not a volunteer vouching for themselves.
    expect(signature?.recorded_by).toBeNull()
  })

  it('signs against an already-published Release Version rather than inventing one', async () => {
    const orgRow = await owner`
      insert into orgs (id, name, time_zone)
      values (${FRONT_BARN}, 'Front Barn Horse Rescue', 'America/New_York')
      returning id
    `
    expect(orgRow.length).toBe(1)

    const published = await forOrg(orgId()).run((db) =>
      publishReleaseVersion(db, orgId(), null, {
        label: 'The real paperwork',
        validFrom: dayString('2020-01-01'),
        obsoletesPrior: false,
      }),
    )

    await bootstrap({
      orgId: FRONT_BARN as OrgId,
      organisation: 'Front Barn Horse Rescue',
      timeZone: 'America/New_York',
      name: 'Grace Whittaker',
      email: 'grace@barn.test',
    })

    const versions =
      await owner`select id, label from release_versions where org_id = ${FRONT_BARN}`
    expect(versions).toHaveLength(1)

    const [signature] = await owner`
      select release_version_id from release_signatures where org_id = ${FRONT_BARN}
    `
    expect(String(signature?.release_version_id)).toBe(published.id)
  })

  it('does not duplicate the signature on a second, idempotent run', async () => {
    const first = await bootstrap({
      orgId: FRONT_BARN as OrgId,
      organisation: 'Front Barn Horse Rescue',
      timeZone: 'America/New_York',
      name: 'Grace Whittaker',
      email: 'grace@barn.test',
    })

    const second = await bootstrap({
      orgId: FRONT_BARN as OrgId,
      organisation: 'Front Barn Horse Rescue',
      timeZone: 'America/New_York',
      name: 'Grace Whittaker',
      email: 'grace@barn.test',
    })
    expect(second.volunteerId).toBe(first.volunteerId)
    expect(second.created).toBe(false)

    const signatures = await owner`
      select id from release_signatures where org_id = ${FRONT_BARN}
    `
    expect(signatures).toHaveLength(1)
  })
})
