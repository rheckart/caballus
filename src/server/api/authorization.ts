/**
 * Authorization is a Domain Scope or a roster position, and nothing else
 * (ADR 0010). There is no authorship axis, no ownership axis, no per-endpoint
 * role list and no wildcard.
 *
 * Every `/api/v1` handler declares what it requires, and the declaration is a
 * required argument to `route` — so omission is a type error rather than a
 * quietly unauthorized endpoint (ADR 0016).
 */
import { DOMAIN_SCOPES, type DomainScope } from '../../shared/domain-scopes'
import type { Actor } from '../request-context'

/**
 * The vocabulary is `src/shared/domain-scopes.ts` and re-exported here, so
 * that a check and the `/me` the phone parses cannot name different scopes
 * (ADR 0021). The *checks* stay on this side; only the names are shared.
 */
export { DOMAIN_SCOPES, type DomainScope }

/**
 * ADR 0010's roles, carrying the barn's own words. Stored as rows on the
 * Volunteer; **the mapping below is a constant in code**, because nobody at
 * this rescue will ever redefine what Head of Maintenance means and the price
 * of letting them would be a permissions screen with its own audit problem.
 *
 * Three roles the brief lists are deliberately absent. Feed Shift Lead and
 * Co-Lead dissolve into roster positions — being Lead of *this* Shift is not
 * something anyone holds between Shifts — and Feed Shift Volunteer *is* the
 * floor, so a role granting it would mean nothing. Keeping any of the three
 * would be worse than absent: they would look like the thing that authorizes,
 * and something would eventually check them instead of checking the roster.
 */
export const ROLE_SCOPES = {
  // Enumerated rather than a wildcard. ADR 0010 rejects a short-circuit as a
  // second code path through authorization, reliably the one nobody tests —
  // and enumeration buys deliberateness: when `medical` arrives, somebody has
  // to decide whether the President reads diagnoses.
  president: DOMAIN_SCOPES,
  board_member: DOMAIN_SCOPES,
  head_of_horse_welfare: ['horse_care'],
  head_of_maintenance: ['maintenance'],
  volunteer_coordinator: ['roster'],
  treasurer: ['financial'],
  event_coordinator: ['events'],
} as const satisfies Readonly<Record<string, readonly DomainScope[]>>

export type Role = keyof typeof ROLE_SCOPES

export const ROLES = Object.keys(ROLE_SCOPES) as readonly Role[]

/**
 * Whether a stored string is a role this build knows.
 *
 * The column is text and a deploy can be older than a row, so the question is
 * real. `supplies` is the standing example pointing the other way: it has no
 * dedicated role and is the President's until the rescue names the position,
 * at which point the name is one line here and one grant.
 */
export function isRole(stored: string): stored is Role {
  return Object.hasOwn(ROLE_SCOPES, stored)
}

/**
 * The Domain Scopes a set of roles confers, in `DOMAIN_SCOPES` order and
 * without repeats.
 *
 * A role this build does not know confers nothing, which is the direction that
 * fails closed — the alternative is a row nobody can read granting something
 * nobody decided.
 */
export function scopesOf(roles: readonly string[]): readonly DomainScope[] {
  const held = new Set<DomainScope>()
  for (const role of roles) {
    if (!isRole(role)) continue
    for (const scope of ROLE_SCOPES[role]) held.add(scope)
  }
  return DOMAIN_SCOPES.filter((scope) => held.has(scope))
}

/**
 * The three legitimate uses of `floor` today. Stated as a type so that a
 * fourth is a deliberate act — somebody adds a member here, and the diff says
 * what they decided (ADR 0016).
 */
export type FloorReason =
  'work-on-a-shift-you-are-rostered-on' | 'record-an-observation' | 'record-your-own-presence'

export type Authorization =
  | { readonly kind: 'scope'; readonly scope: DomainScope }
  | { readonly kind: 'shift-authority' }
  | { readonly kind: 'floor'; readonly because: FloorReason }
  | { readonly kind: 'read-everything' }

/**
 * This endpoint requires a Domain Scope.
 *
 * Named in full, because `Scope` alone is the barn's word for which horses a
 * piece of work applies to, and CONTEXT.md keeps it for them.
 */
export function domainScope(required: DomainScope): Authorization {
  return { kind: 'scope', scope: required }
}

/** This endpoint requires Shift Authority over the Shift it names. */
export function shiftAuthority(): Authorization {
  return { kind: 'shift-authority' }
}

/**
 * This write needs no Domain Scope. Saying so is deliberate: ADR 0010 allows
 * it in exactly the three cases `FloorReason` enumerates.
 */
export function floor(because: FloorReason): Authorization {
  return { kind: 'floor', because }
}

/**
 * A read. Every Volunteer reads everything in v1 — it is all on a wall in a
 * barn that every volunteer walks into (ADR 0010). The two carve-outs,
 * volunteer contact details and the audit log, declare `domainScope('roster')`.
 */
export function readEverything(): Authorization {
  return { kind: 'read-everything' }
}

export type Decision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly status: 401 | 403; readonly wanted: string }

/**
 * A denial is explicit and names what it wanted (ADR 0010): a silent empty
 * response is indistinguishable from success to a retry queue.
 */
export function authorize(required: Authorization, actor: Actor | null): Decision {
  switch (required.kind) {
    case 'read-everything':
      // *Every Volunteer* reads everything (ADR 0010) — a person the
      // organisation knows, not anybody who asks. The whiteboard is in a barn
      // that every volunteer walks into, and the barn has a gate.
      //
      // The refusal is explicit and names what it wanted, like every other
      // one: a silent empty answer is indistinguishable from success to a
      // retry queue, and a phone that cannot tell *you are signed out* from
      // *there is nothing today* shows a volunteer an empty barn.
      return actor === null ? { allowed: false, status: 401, wanted: 'read' } : { allowed: true }

    case 'floor':
      // A write with no actor cannot be attributed, and an unattributed tick
      // is the confident lie the paper system already tells.
      return actor === null
        ? { allowed: false, status: 401, wanted: `signed in (${required.because})` }
        : { allowed: true }

    case 'scope':
      if (actor === null) {
        return { allowed: false, status: 401, wanted: required.scope }
      }
      return actor.domainScopes.includes(required.scope)
        ? { allowed: true }
        : { allowed: false, status: 403, wanted: required.scope }

    case 'shift-authority':
      // Shift Authority is held over one Shift and expires when it closes, so
      // the check is a join against that Shift's roster. The Shift model
      // arrives with the checklist; until then this cannot be granted.
      return actor === null
        ? { allowed: false, status: 401, wanted: 'shift authority' }
        : { allowed: false, status: 403, wanted: 'shift authority' }
  }
}

/** How an authorization reads in a log line and in a denial. */
export function describeAuthorization(required: Authorization): string {
  switch (required.kind) {
    case 'scope':
      return required.scope
    case 'shift-authority':
      return 'shift authority'
    case 'floor':
      return `floor: ${required.because}`
    case 'read-everything':
      return 'read'
  }
}
