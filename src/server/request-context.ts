/**
 * What the server knows about a request before any handler runs: which
 * organisation it is for, who is making it, and an id to log it under.
 *
 * This is the only module that mints an `OrgId`. That is the whole point of
 * the brand (ADR 0016): the organisation a query is scoped to comes from the
 * request, never from a row the query just read.
 *
 * **Both halves come from the server and neither from the caller.** The
 * organisation is configuration; the actor is the session. Nothing here reads
 * an identity off a header, a body or a query, because a client-supplied one
 * is the impersonation vector ADR 0008's whole arrangement exists to close.
 */
import type { OrgId } from '../db/for-org'
import { sessionFrom } from './auth/actor'
import { isKiosk } from './auth/kiosk'
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
    orgId: currentOrgId(),
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
 * One rescue, from configuration.
 *
 * The application is multi-tenant in the database because retrofitting that is
 * the expensive direction (ADR 0007), not because a second organisation is
 * expected. When one arrives, this resolves from the host or the session; the
 * brand exists so that change lands in one module.
 */
export function currentOrgId(): OrgId {
  const configured = process.env.APP_ORG_ID
  if (configured === undefined || configured === '') {
    throw new Error('APP_ORG_ID is not set')
  }
  return configured as OrgId
}
