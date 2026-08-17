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
import { actorFrom } from './auth/actor'
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
  return { ...base, actor: await actorFrom(base.orgId, request) }
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
