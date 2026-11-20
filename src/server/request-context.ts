/**
 * What the server knows about a request before any handler runs: which
 * organisation it is for, who is making it, and an id to log it under.
 *
 * This is the only module that mints an `OrgId`. That is the whole point of
 * the brand (ADR 0016): the organisation a query is scoped to comes from the
 * request, never from a row the query just read.
 *
 * **The organisation is the host the request knocked at, and the actor is the
 * session** (ADR 0030). The host is a header, and ADR 0008 forbids taking the
 * tenant from one — because a caller naming a tenant and being believed is the
 * impersonation vector. The host is not believed: it picks which rescue's door
 * this is, out of a map in configuration (`src/server/rescues.ts`), and the
 * session still has to resolve to an Account of that rescue, which since #111
 * it can only do if it was minted there. Nothing here reads an *identity* off
 * a header, a body or a query.
 */
import type { OrgId } from '../db/for-org'
import { sessionFrom } from './auth/actor'
import { isKiosk } from './auth/kiosk'
import { hostOf, rescueFor } from './rescues'
import type { DomainScope } from './api/authorization'

export interface Actor {
  readonly volunteerId: string
  readonly domainScopes: readonly DomainScope[]
}

export interface RequestContext {
  readonly orgId: OrgId
  readonly requestId: string
  /**
   * Resolved from the session on every request, or `null` for nobody.
   *
   * A Volunteer, not an Account: ADR 0010 hangs authorization off the person
   * the barn knows, so what a handler is handed is a `volunteerId` and the
   * Domain Scopes their roles confer. The Account is the thing in the middle,
   * and no handler ever sees it.
   */
  readonly actor: Actor | null
  /**
   * The token of the session this request carries, or `null` for nobody.
   *
   * Resolved beside the actor because it is resolved anyway — `actorFrom`
   * already reads the session on every request — and carrying it is what keeps
   * `/me/email` (#68) from asking Better Auth a second time from **inside** the
   * transaction `mutation` opened. That second question takes a second
   * connection from a pool of ten while the first is still held, which is a
   * deadlock at ten concurrent writes rather than a slow path.
   *
   * It is a session's own identity and never a person's: nothing authorizes on
   * it, and `actor` above stays the only answer to *who is asking*.
   */
  readonly sessionToken: string | null
  /**
   * Whether this request is the barn's tablet rather than a person (ADR 0022).
   *
   * Deliberately not an `Actor`: the Board credits nobody, so the kiosk resolves
   * to a fact about the request and never to a person the care record could
   * end up naming. It authorizes one read and, structurally, no write.
   */
  readonly kiosk: boolean
}

/**
 * The context of a request, session and all.
 *
 * Asynchronous because resolving the actor is three indexed reads, and that is
 * the price ADR 0008 chose knowingly: membership as a row that every request
 * re-reads, rather than a claim in a token that would keep being true after it
 * stopped being.
 */
export async function requestContext(request: Request): Promise<RequestContext> {
  const base = anonymousContext(request)
  const session = await sessionFrom(base.orgId, request)
  return { ...base, actor: session.actor, sessionToken: session.token }
}

/**
 * The half that needs no database: the organisation and the request id.
 *
 * Used where an actor is either irrelevant or supplied — the log line for a
 * request rejected before it reached a handler, and the tests that put a
 * particular person in the barn rather than signing one in.
 */
export function anonymousContext(request: Request): RequestContext {
  return {
    orgId: currentOrgId(request),
    requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(),
    actor: null,
    sessionToken: null,
    // Resolved here rather than beside the actor, because it needs no database
    // and the log line for a request rejected before any handler ran is
    // entitled to know whether it came from the tablet (ADR 0022).
    kiosk: isKiosk(request),
  }
}

/**
 * A request at a host no rescue is mapped to.
 *
 * Thrown rather than defaulted to the first rescue in the map: somebody who
 * mistyped a subdomain must not be handed a sign-in screen for a rescue they
 * do not belong to. `src/start.ts` and the API both answer it with a 404 and
 * `UNKNOWN_RESCUE` before anything reaches here, so a throw that escapes is a
 * path that skipped the gate.
 */
export class UnknownRescue extends Error {
  constructor(readonly host: string) {
    super(`No rescue is mapped to the host ${host}`)
  }
}

/**
 * The organisation this request is for — the host it arrived at, resolved
 * through `RESCUES` (#112, ADR 0030).
 *
 * The only place an `OrgId` is minted (ADR 0016), so the organisation a query
 * is scoped to comes from the request and never from a row it just read.
 */
export function currentOrgId(request: Request): OrgId {
  const rescue = rescueFor(request)
  if (rescue === null) throw new UnknownRescue(hostOf(request))
  return rescue.orgId as OrgId
}
