/**
 * Which rescue a test's requests are for (#112, ADR 0030).
 *
 * The organisation comes from the host a request arrives at, through
 * `RESCUES`. A test puts the rescue it is about behind the one host its
 * requests are built at — `barn.invalid`, RFC 2606's, so nothing resolves it —
 * through the `setRescues` seam rather than by writing JSON into the
 * environment, and is handed back the `OrgId` minted the way a request mints
 * it: by `currentOrgId`, from a request at that host.
 *
 * Vitest gives each test file its own module graph, so a file's rescue is its
 * own and running beside another file cannot change it.
 */
import type { OrgId } from '../db/for-org'
import { currentOrgId } from '../server/request-context'
import { setRescues, type Rescue } from '../server/rescues'

/** The host every in-process test request is built at. */
export const TEST_HOST = 'barn.invalid'

/** What a test may say about a rescue beyond which organisation it is (#113). */
export type RescueOptions = Partial<Pick<Rescue, 'boardToken' | 'sms'>>

/** Serves `orgId` at `TEST_HOST`, and only that, and answers its `OrgId`. */
export function servingRescue(orgId: string, options: RescueOptions = {}): OrgId {
  return servingRescues({ [TEST_HOST]: orgId }, { [TEST_HOST]: options })[TEST_HOST] as OrgId
}

/**
 * Serves several rescues at several hosts, for a test that is about which one
 * a request reaches. Answers each host's `OrgId`.
 */
export function servingRescues(
  byHost: Readonly<Record<string, string>>,
  options: Readonly<Record<string, RescueOptions>> = {},
): Record<string, OrgId> {
  setRescues(
    new Map(
      Object.entries(byHost).map(([host, orgId]) => [
        host,
        {
          host,
          orgId,
          boardToken: options[host]?.boardToken ?? null,
          sms: options[host]?.sms ?? false,
        },
      ]),
    ),
  )
  return Object.fromEntries(
    Object.keys(byHost).map((host) => [host, currentOrgId(new Request(`http://${host}/`))]),
  )
}
