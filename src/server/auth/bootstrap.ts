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
import { v7 as uuidv7 } from 'uuid'

import { closeDb, forOrg, type OrgId } from '../../db/for-org'
import { orgs } from '../../db/schema'
import { isTimeZone } from '../time'
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
  const { organisation, timeZone, name, email } = parsed
  const orgId = (parsed.org ?? newOrganisationId()) as OrgId

  try {
    const member = await bootstrap({ orgId, organisation, timeZone, name, email })
    process.stdout.write(
      member.created
        ? `Created ${organisation} and its first President, ${name} <${email}>.\n` +
            `They sign in with a code like anybody else; nothing here made them an account.\n`
        : `${name} <${email}> was already a volunteer here, and now holds President.\n`,
    )
    process.stdout.write(rescuesEntry(orgId))
  } finally {
    await closeDb()
  }
}

const USAGE =
  'Usage: npm run bootstrap -- [--org <id>] "<organisation>" <IANA/Zone> "<name>" <email>\n' +
  '\nWithout --org a new organisation is created; with it, that one is finished or re-granted.\n'

/** What the operator adds to `RESCUES`, so the rescue is reachable at a host. */
function rescuesEntry(orgId: string): string {
  return (
    `\nAdd this rescue to RESCUES, under the host it is reached at (docs/deploy.md):\n` +
    `  "<host>": { "orgId": "${orgId}" }\n`
  )
}

/** The four positional arguments, and `--org` wherever it appears. */
function parseArguments(argv: readonly string[]): {
  readonly org: string | null
  readonly organisation: string
  readonly timeZone: string
  readonly name: string
  readonly email: string
} | null {
  const positional: string[] = []
  let org: string | null = null
  for (let at = 0; at < argv.length; at += 1) {
    const argument = argv[at] ?? ''
    if (argument === '--org') {
      const value = argv[at + 1]
      if (value === undefined || !GUID.test(value)) return null
      org = value
      at += 1
    } else {
      positional.push(argument)
    }
  }
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
  return { org, organisation, timeZone, name, email }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
