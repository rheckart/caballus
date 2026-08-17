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
 * Idempotent on the organisation and on the role, so a second run after a
 * half-finished first one finishes the job rather than failing.
 */
import { v7 as uuidv7 } from 'uuid'

import { closeDb, forOrg, type OrgId } from '../../db/for-org'
import { orgs } from '../../db/schema'
import { isTimeZone } from '../time'
import { createVolunteer, grantRole, volunteerByEmail } from './volunteers'

export interface FirstMember {
  readonly orgId: OrgId
  readonly volunteerId: string
  /** False when a run found the work already done — see the note on idempotency. */
  readonly created: boolean
}

/**
 * Creates the organisation if it is not there, then the first President.
 *
 * The organisation id is `APP_ORG_ID`, not a fresh one: the deployment already
 * names the rescue it serves (ADR 0007), and a bootstrap that minted its own
 * would leave somebody editing an environment file to match a uuid the command
 * printed.
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

  return { orgId: details.orgId, volunteerId: volunteer.id, created: existing === null }
}

/**
 * A fresh organisation id, for an operator who has no `APP_ORG_ID` yet and
 * needs one to put in the environment.
 */
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
  const [organisation, timeZone, name, email] = argv

  if (
    organisation === undefined ||
    timeZone === undefined ||
    name === undefined ||
    email === undefined
  ) {
    process.stderr.write(
      'Usage: npm run bootstrap -- "<organisation>" <IANA/Zone> "<name>" <email>\n' +
        `\nAPP_ORG_ID must be set. A fresh one: ${newOrganisationId()}\n`,
    )
    process.exitCode = 2
    return
  }

  const configured = process.env.APP_ORG_ID
  if (configured === undefined || configured === '') {
    process.stderr.write(`APP_ORG_ID is not set. A fresh one: ${newOrganisationId()}\n`)
    process.exitCode = 2
    return
  }

  const orgId = configured as OrgId
  try {
    const member = await bootstrap({ orgId, organisation, timeZone, name, email })
    process.stdout.write(
      member.created
        ? `Created ${organisation} and its first President, ${name} <${email}>.\n` +
            `They sign in with a code like anybody else; nothing here made them an account.\n`
        : `${name} <${email}> was already a volunteer here, and now holds President.\n`,
    )
  } finally {
    await closeDb()
  }
}
