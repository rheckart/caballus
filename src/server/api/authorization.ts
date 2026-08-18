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
 * ADR 0010's roles and the mapping from one to the Domain Scopes it confers,
 * re-exported from `src/shared/roles.ts` for the same reason the scopes
 * themselves are: the desktop admin screen grants Roles and shows what they
 * carry, so the vocabulary crosses the wire and a second copy of it would be
 * the drift ADR 0021 exists to remove. **The checks stay on this side** —
 * `authorize` below is the only thing that decides anything.
 */
export { ROLES, ROLE_NAMES, ROLE_SCOPES, isRole, scopesOf, type Role } from '../../shared/roles'

/**
 * The legitimate uses of `floor` today. Stated as a type so that another is a
 * deliberate act — somebody adds a member here, and the diff says what they
 * decided (ADR 0016).
 */
export type FloorReason =
  | 'work-on-a-shift-you-are-rostered-on'
  | 'record-an-observation'
  | 'record-your-own-presence'
  | 'record-a-measurement'
  /**
   * Cover and Drop. Neither needs a Domain Scope, on the principle that lets
   * anyone record an Observation: a statement about your own availability is
   * not authority over the roster, and an app that makes people ask permission
   * to tell it the truth gets told less of it (ADR 0011). Removing *somebody
   * else* is the act ADR 0010 puts under `roster`.
   */
  | 'commit-to-or-leave-a-shift'

export type Authorization =
  | { readonly kind: 'scope'; readonly scope: DomainScope }
  | { readonly kind: 'any-scope'; readonly scopes: readonly DomainScope[] }
  | { readonly kind: 'shift-authority' }
  | { readonly kind: 'floor'; readonly because: FloorReason }
  | { readonly kind: 'read-everything' }
  | { readonly kind: 'board' }

/**
 * What a **write** may declare: everything above except the Board's.
 *
 * ADR 0022's structural half. The Board credits no actor, so a write it could
 * authorize would be a write nobody made — and rather than leaving that to a
 * reviewer's attention, `mutation` takes this type and a write declaring
 * `board()` does not compile (ADR 0016).
 */
export type PersonAuthorization = Exclude<Authorization, { readonly kind: 'board' }>

/**
 * This endpoint requires a Domain Scope.
 *
 * Named in full, because `Scope` alone is the barn's word for which horses a
 * piece of work applies to, and CONTEXT.md keeps it for them.
 */
export function domainScope(required: DomainScope): PersonAuthorization {
  return { kind: 'scope', scope: required }
}

/**
 * This endpoint requires any one of several Domain Scopes.
 *
 * ADR 0019's one two-Scope record: a Product is editable by holders of either
 * `horse_care` or `supplies`, refused as field-level scoping on the grounds
 * that a third authorization axis is the thing ADR 0010 warns against — so the
 * choice is between the two Scopes wholesale, not a split of the record.
 * Not a general mechanism to reach for; a second call site is the tripwire to
 * revisit whether this earns a wider one.
 */
export function anyDomainScope(scopes: readonly DomainScope[]): PersonAuthorization {
  return { kind: 'any-scope', scopes }
}

/** This endpoint requires Shift Authority over the Shift it names. */
export function shiftAuthority(): PersonAuthorization {
  return { kind: 'shift-authority' }
}

/**
 * This write needs no Domain Scope. Saying so is deliberate: ADR 0010 allows it
 * in exactly the cases `FloorReason` enumerates, and nowhere else.
 */
export function floor(because: FloorReason): PersonAuthorization {
  return { kind: 'floor', because }
}

/**
 * A read. Every Volunteer reads everything in v1 — it is all on a wall in a
 * barn that every volunteer walks into (ADR 0010). The two carve-outs,
 * volunteer contact details and the audit log, declare `domainScope('roster')`.
 */
export function readEverything(): PersonAuthorization {
  return { kind: 'read-everything' }
}

/**
 * A read for the Board: a signed-in Volunteer, or the rescue's tablet
 * presenting the kiosk token (ADR 0022).
 *
 * It resolves to nobody — the tablet is a fact about the request and never an
 * `Actor` — so a handler declaring this must not need one. Today exactly one
 * does, and `PersonAuthorization` above is why it can never be more than a read.
 */
export function board(): Authorization {
  return { kind: 'board' }
}

/**
 * Who is asking, as authorization sees them: the person the session resolved
 * to, and whether the request is the barn's tablet. A `RequestContext` is one.
 */
export interface Principal {
  readonly actor: Actor | null
  readonly kiosk: boolean
}

export type Decision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly status: 401 | 403; readonly wanted: string }

/**
 * A denial is explicit and names what it wanted (ADR 0010): a silent empty
 * response is indistinguishable from success to a retry queue.
 */
export function authorize(required: Authorization, asking: Principal): Decision {
  const { actor } = asking

  switch (required.kind) {
    case 'board':
      // A person or the tablet, and nothing else. The tablet is not an actor,
      // so nothing downstream of this may credit one (ADR 0022).
      return actor !== null || asking.kiosk
        ? { allowed: true }
        : { allowed: false, status: 401, wanted: 'read' }

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

    case 'any-scope': {
      const wanted = required.scopes.join(' or ')
      if (actor === null) {
        return { allowed: false, status: 401, wanted }
      }
      return required.scopes.some((scope) => actor.domainScopes.includes(scope))
        ? { allowed: true }
        : { allowed: false, status: 403, wanted }
    }

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
    case 'any-scope':
      return required.scopes.join(' or ')
    case 'shift-authority':
      return 'shift authority'
    case 'floor':
      return `floor: ${required.because}`
    case 'read-everything':
      return 'read'
    case 'board':
      return 'board read'
  }
}
