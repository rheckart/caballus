/**
 * What the server knows about a request before any handler runs: which
 * organisation it is for, who is making it, and an id to log it under.
 *
 * This is the only module that mints an `OrgId`. That is the whole point of
 * the brand (ADR 0016): the organisation a query is scoped to comes from the
 * request, never from a row the query just read.
 */
import type { OrgId } from '../db/for-org'
import type { DomainScope } from './api/authorization'

export interface Actor {
  readonly volunteerId: string
  readonly domainScopes: readonly DomainScope[]
}

export interface RequestContext {
  readonly orgId: OrgId
  readonly requestId: string
  /**
   * Null until accounts exist. ADR 0006 runs the whole POC with no volunteer
   * accounts, and ADR 0010 hangs authorization off the Volunteer rather than
   * the Account, so this resolves from the session that ADR 0008's Better Auth
   * will own — and until then, nobody is signed in.
   */
  readonly actor: Actor | null
}

export function requestContext(request: Request): RequestContext {
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
