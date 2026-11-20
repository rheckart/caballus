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

/** Serves `orgId` at `TEST_HOST`, and only that, and answers its `OrgId`. */
export function servingRescue(orgId: string): OrgId {
  return servingRescues({ [TEST_HOST]: orgId })[TEST_HOST] as OrgId
}

/**
 * Serves several rescues at several hosts, for a test that is about which one
 * a request reaches. Answers each host's `OrgId`.
 */
export function servingRescues(
  byHost: Readonly<Record<string, string>>,
  extra: Readonly<Record<string, Partial<Omit<Rescue, 'host' | 'orgId'>>>> = {},
): Record<string, OrgId> {
  setRescues(
    new Map(Object.entries(byHost).map(([host, orgId]) => [host, { ...extra[host], host, orgId }])),
  )
  return Object.fromEntries(
    Object.keys(byHost).map((host) => [host, currentOrgId(new Request(`http://${host}/`))]),
  )
}
