/**
 * The one-shot command that creates the first organisation and its first
 * member (ADR 0008), run once and recorded in the runbook beside the restore.
 *
 * It exists because **there is no god-mode**. The maintainer's elevated access
 * is President through the same role tables as everybody else, and a second
 * privileged path would be a second thing to secure and reliably the one
 * nobody audits. But somebody has to be able to grant the first role, and
 * nobody can grant themselves one — so the floor is a command with shell
 * access to the box, which is a level of access that already implies
 * everything this could do.
 *
 * It does not create an Account. The first President signs in with a code like
 * anybody else; this only makes them a Volunteer who holds `grants`.
 *
 *   npm run bootstrap -- "Front Barn Horse Rescue" America/New_York \
 *     "Grace Whittaker" grace@example.org
 *
 * **It mints the organisation id** (#112, ADR 0030). The rescue a request is
 * for comes from the host it arrives at, through `RESCUES`, so a deployment no
 * longer names one rescue it serves — and the command prints the `RESCUES`
 * entry to add, rather than requiring an id to be configured before it can
 * run. `--org <id>` names an existing organisation instead, which is how a
 * second run finishes a half-finished first one or grants President again:
 *
 *   npm run bootstrap -- --org 01a0… "Front Barn Horse Rescue" \
 *     America/New_York "Grace Whittaker" grace@example.org
 *
 * Idempotent on the organisation and on the role, so a second run with
 * `--org` finishes the job rather than failing. Without `--org`, every run is
 * a new rescue.
 */
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import { closeDb, forOrg, type OrgId } from '../../db/for-org'
import { orgs } from '../../db/schema'
import { isTimeZone } from '../time'
import type { Coordinates } from '../weather/providers'
import { createVolunteer, grantRole, recordFoundingRelease, volunteerByEmail } from './volunteers'

export interface FirstMember {
  readonly orgId: OrgId
  readonly volunteerId: string
  /** False when a run found the work already done — see the note on idempotency. */
  readonly created: boolean
}

/**
 * Creates the organisation if it is not there, then the first President.
 *
 * The organisation id is the caller's: `runBootstrap` mints a fresh one, or
 * takes `--org` for a rescue that already exists.
 */
export async function bootstrap(details: {
  readonly orgId: OrgId
  readonly organisation: string
  readonly timeZone: string
  readonly name: string
  readonly email: string
  readonly barn?: Coordinates
}): Promise<FirstMember> {
  if (!isTimeZone(details.timeZone)) {
    throw new Error(
      `Unknown timezone: ${details.timeZone}. Use an IANA name like America/New_York.`,
    )
  }

  await forOrg(details.orgId).run((db) =>
    db
      .insert(orgs)
      .values({ id: details.orgId, name: details.organisation, timeZone: details.timeZone })
      .onConflictDoNothing()
      .returning({ id: orgs.id }),
  )
  if (details.barn !== undefined) await placeBarn(details.orgId, details.barn)

  const existing = await volunteerByEmail(details.orgId, details.email)
  const volunteer =
    existing ?? (await createVolunteer(details.orgId, { name: details.name, email: details.email }))

  // President rather than a bespoke first-user role: ADR 0010 has the
  // President holding all seven scopes by enumeration, `grants` among them, so
  // this hands over the ability to make everybody else without inventing a
  // privilege that only one person has.
  await grantRole(details.orgId, volunteer.id, 'president')

  // Holding `grants` is not enough to be rostered: ADR 0017's release gate is
  // a hard block with no override, and the founding President is the only
  // person who could ever record it — recordFoundingRelease is the same
  // shell-access floor as the role grant above, applied to that one gate.
  await recordFoundingRelease(details.orgId, volunteer.id, details.timeZone)

  return { orgId: details.orgId, volunteerId: volunteer.id, created: existing === null }
}

/**
 * Where a rescue's barn is, for the weather (#113, ADR 0030).
 *
 * On the rescue's own `orgs` row, set on create or on any later run — which is
 * how the rescue that existed before #113 gets the coordinates it used to read
 * from the deployment's environment. Refuses an organisation that does
 * not exist rather than reporting a barn placed nowhere.
 */
export async function placeBarn(orgId: OrgId, barn: Coordinates): Promise<void> {
  const placed = await forOrg(orgId).run((db) =>
    db
      .update(orgs)
      .set({ barnLatitude: barn.latitude, barnLongitude: barn.longitude })
      .where(eq(orgs.id, orgId))
      .returning({ id: orgs.id }),
  )
  if (placed.length === 0) throw new Error(`There is no organisation ${orgId} to place a barn for.`)
}

/** A fresh organisation id, for a rescue that does not exist yet. */
export function newOrganisationId(): string {
  return uuidv7()
}

/**
 * The command itself.
 *
 * Exported rather than guarded by an entry-point check: `src/server/auth/bootstrap.cli.ts`
 * is the file the script runs, and it does nothing but call this. A module
 * that decides for itself whether it is the entry point behaves differently
 * under the bundler, the test runner and the loader — three answers to a
 * question a one-line file settles.
 */
export async function runBootstrap(argv: readonly string[]): Promise<void> {
  const parsed = parseArguments(argv)
  if (parsed === null) {
    process.stderr.write(USAGE)
    process.exitCode = 2
    return
  }

  try {
    if (parsed.kind === 'barn') {
      await placeBarn(parsed.org as OrgId, parsed.barn)
      process.stdout.write(
        `The barn for ${parsed.org} is at ${String(parsed.barn.latitude)}, ` +
          `${String(parsed.barn.longitude)}.\n`,
      )
      return
    }

    const { organisation, timeZone, name, email, barn } = parsed
    const orgId = (parsed.org ?? newOrganisationId()) as OrgId
    const member = await bootstrap({
      orgId,
      organisation,
      timeZone,
      name,
      email,
      ...(barn === null ? {} : { barn }),
    })
    process.stdout.write(
      member.created
        ? `Created ${organisation} and its first President, ${name} <${email}>.\n` +
            `They sign in with a code like anybody else; nothing here made them an account.\n`
        : `${name} <${email}> was already a volunteer here, and now holds President.\n`,
    )
    if (barn === null) {
      process.stdout.write(
        'No --barn given: the weather refuses for this rescue until one is (docs/deploy.md).\n',
      )
    }
    process.stdout.write(rescuesEntry(orgId))
  } finally {
    await closeDb()
  }
}

const USAGE =
  'Usage: npm run bootstrap -- [--org <id>] [--barn <lat>,<lon>] "<organisation>" <IANA/Zone> "<name>" <email>\n' +
  '       npm run bootstrap -- --org <id> --barn <lat>,<lon>\n' +
  '\nWithout --org a new organisation is created; with it, that one is finished or re-granted.\n' +
  'The second form only places the barn, for a rescue that already exists.\n'

/** What the operator adds to `RESCUES`, so the rescue is reachable at a host. */
function rescuesEntry(orgId: string): string {
  return (
    `\nAdd this rescue to RESCUES, under the host it is reached at (docs/deploy.md):\n` +
    `  "<host>": { "orgId": "${orgId}" }\n`
  )
}

type Parsed =
  | {
      readonly kind: 'rescue'
      readonly org: string | null
      readonly barn: Coordinates | null
      readonly organisation: string
      readonly timeZone: string
      readonly name: string
      readonly email: string
    }
  | { readonly kind: 'barn'; readonly org: string; readonly barn: Coordinates }

/** The four positional arguments, and `--org` and `--barn` wherever they appear. */
function parseArguments(argv: readonly string[]): Parsed | null {
  const positional: string[] = []
  let org: string | null = null
  let barn: Coordinates | null = null
  for (let at = 0; at < argv.length; at += 1) {
    const argument = argv[at] ?? ''
    if (argument === '--org') {
      const value = argv[at + 1]
      if (value === undefined || !GUID.test(value)) return null
      org = value
      at += 1
    } else if (argument === '--barn') {
      const value = parseBarn(argv[at + 1])
      if (value === null) return null
      barn = value
      at += 1
    } else {
      positional.push(argument)
    }
  }
  if (positional.length === 0 && org !== null && barn !== null) return { kind: 'barn', org, barn }

  const [organisation, timeZone, name, email] = positional
  if (
    positional.length !== 4 ||
    organisation === undefined ||
    timeZone === undefined ||
    name === undefined ||
    email === undefined
  ) {
    return null
  }
  return { kind: 'rescue', org, barn, organisation, timeZone, name, email }
}

/** `39.4143,-77.4105`: decimal degrees, latitude first, on the globe. */
function parseBarn(raw: string | undefined): Coordinates | null {
  const parts = (raw ?? '').split(',')
  if (parts.length !== 2) return null
  const [latitude, longitude] = parts.map((part) =>
    part.trim() === '' ? Number.NaN : Number(part),
  )
  if (latitude === undefined || longitude === undefined) return null
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
