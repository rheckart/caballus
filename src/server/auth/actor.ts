/**
 * Who is asking, resolved from the session on every request.
 *
 * This is the join ADR 0008 refused to let a token carry. The session says
 * which Better Auth user; `volunteer_accounts` says which Volunteer of this
 * organisation that is; `volunteer_roles` says what they hold, and the
 * constant in `src/server/api/authorization.ts` turns that into Domain Scopes.
 * All three are indexed reads in the same database, which is the whole point:
 * with no session expiry, revocation is the entire security model, and a
 * membership claim in a long-lived token is exactly the fact that outlives its
 * truth. Removing somebody takes effect on the next request.
 *
 * **There is no impersonation and no god-mode** (ADR 0008). Nothing here reads
 * an organisation, a volunteer or a scope off the request — not from a header,
 * not from the body, not from a query. A client-supplied identity is the
 * vector this whole arrangement exists to close, and the way it is closed is
 * that the code to honour one does not exist.
 */
import { and, eq, isNull } from 'drizzle-orm'

import { forOrg, type OrgId } from '../../db/for-org'
import { volunteerAccounts, volunteerRoles, volunteers } from '../../db/schema'
import { scopesOf } from '../api/authorization'
import type { Actor } from '../request-context'
import { auth } from './auth'

/**
 * The actor this request is being made by, or `null` for nobody.
 *
 * `null` is an ordinary answer and not an error: the login screen is served to
 * somebody signed out, and every read behind it answers a signed-out request
 * with an explicit denial rather than an empty barn (ADR 0010).
 */
export async function actorFrom(orgId: OrgId, request: Request): Promise<Actor | null> {
  // Straight to the database, deliberately. The session cookie carries a
  // token and nothing else — there is no cached copy of the session in a
  // signed cookie to read instead, because that cache would be a staleness
  // window and revocation cannot have one.
  const session = await auth().api.getSession({ headers: request.headers })
  if (session === null) return null

  return actorForUser(orgId, session.user.id)
}

/**
 * The same, from a user id somebody already has in hand.
 *
 * Separate so that the sign-in path and the request path resolve an actor the
 * same way rather than two ways that agree today.
 */
export async function actorForUser(orgId: OrgId, userId: string): Promise<Actor | null> {
  const resolved = await forOrg(orgId).run(async (db) => {
    // Two ways to stop being somebody this application will act for, and both
    // are checked here rather than at a revocation site, because **this is the
    // read every request makes** and that is the whole of ADR 0008's argument:
    // membership is a row, so removing it takes effect on the next request
    // rather than whenever something forces a refresh.
    //
    // A revoked Account is the officer switching off a login. A removed
    // Volunteer is the person leaving the rescue — a different act, under a
    // different scope, and one that must not leave a live session behind
    // reading everything the barn knows. The session row may also outlive
    // either for a moment, since a restore can resurrect one (ADR 0008), so
    // these two are what have to hold and not the session's existence.
    const [account] = await db
      .select({ volunteerId: volunteerAccounts.volunteerId })
      .from(volunteerAccounts)
      .innerJoin(volunteers, eq(volunteers.id, volunteerAccounts.volunteerId))
      .where(
        and(
          eq(volunteerAccounts.userId, userId),
          isNull(volunteerAccounts.revokedAt),
          isNull(volunteers.removedAt),
        ),
      )
      .limit(1)

    if (account === undefined) return null

    const held = await db
      .select({ role: volunteerRoles.role })
      .from(volunteerRoles)
      .where(eq(volunteerRoles.volunteerId, account.volunteerId))

    return { volunteerId: account.volunteerId, roles: held.map((row) => row.role) }
  })

  if (resolved === null) return null
  return { volunteerId: resolved.volunteerId, domainScopes: scopesOf(resolved.roles) }
}
