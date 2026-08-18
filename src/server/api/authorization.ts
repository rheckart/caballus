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

/**
 * A position on **one Shift** — `lead`, `co_lead` or `acting_lead` — and,
 * optionally, Domain Scopes that reach the same act without one.
 *
 * `alsoScopes` is empty by default and stated per endpoint, because ADR 0010
 * gives the authority set to the *position* and names officers as a fallback
 * only for a Shift with no Lead. A `roster` fallback baked into every check
 * would hand a Volunteer Coordinator every Shift-Authority write there will
 * ever be — closing the Shift, dropping Discretionary Work — which is a much
 * larger claim than the one ADR 0011 makes for the Short declaration alone.
 * So each endpoint says whom else it lets in, and the diff says what somebody
 * decided.
 */
export interface ShiftAuthorization {
  readonly kind: 'shift-authority'
  readonly alsoScopes: readonly DomainScope[]
}

export type Authorization =
  | { readonly kind: 'scope'; readonly scope: DomainScope }
  | { readonly kind: 'any-scope'; readonly scopes: readonly DomainScope[] }
  /**
   * Holds any Domain Scope at all, named rather than enumerated (ADR 0018).
   *
   * A genuinely different shape from `any-scope` above, which still names its
   * list: posting an Announcement is legitimate for the Treasurer, whose scope
   * guards nothing else in v1, and for every officer scope the rescue adds
   * after this ships. Enumerating here would need editing on every new Scope,
   * which is the drift ADR 0018 names as the reason this exists as its own
   * check rather than a growing `any-scope` list.
   */
  | { readonly kind: 'holds-any-scope' }
  | ShiftAuthorization
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
 * What a **read** may declare: everything above except Shift Authority's.
 *
 * The mirror of `PersonAuthorization`, and the thing that makes the tri-state
 * `Decision` below safe. Shift Authority is only half-settled by `authorize` —
 * the rest is a join `mutation` runs against the `shiftId` in the payload — and
 * a read has no payload to name a Shift in. So a read declaring it would be a
 * read authorized by nothing but being signed in, and rather than leaving that
 * to a reviewer's attention it does not compile (ADR 0016).
 *
 * ADR 0010's floor is why nothing is lost: every Volunteer reads everything,
 * with two carve-outs that declare `domainScope('roster')`.
 */
export type ReadAuthorization = Exclude<Authorization, { readonly kind: 'shift-authority' }>

/**
 * What either may declare: the four that need neither a payload nor a tablet.
 * Everything below returns this except the two that are one side's alone.
 */
export type AnywhereAuthorization = Exclude<
  PersonAuthorization,
  { readonly kind: 'shift-authority' }
>

/**
 * This endpoint requires a Domain Scope.
 *
 * Named in full, because `Scope` alone is the barn's word for which horses a
 * piece of work applies to, and CONTEXT.md keeps it for them.
 */
export function domainScope(required: DomainScope): AnywhereAuthorization {
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
export function anyDomainScope(scopes: readonly DomainScope[]): AnywhereAuthorization {
  return { kind: 'any-scope', scopes }
}

/**
 * This endpoint requires holding **any** Domain Scope, unnamed (ADR 0018).
 *
 * Posting to a wall sixty people read is not ADR 0010's floor — it is not
 * *telling the app the truth about yourself*, the property the floor's four
 * cases share — so it needs a Scope. Which one is deliberately not this
 * check's business: the Treasurer and the Head of Horse Welfare both post
 * Announcements, about different things, and enumerating the pair (or the
 * seven) would be a list somebody has to remember to widen.
 */
export function anyScopeHolder(): AnywhereAuthorization {
  return { kind: 'holds-any-scope' }
}

/**
 * This endpoint requires Shift Authority over the Shift it names, and — where
 * the caller names them — any of these Domain Scopes instead.
 *
 * `shiftAuthority(['roster'])` is ADR 0011's sentence for the Short
 * declaration: "declared by whoever holds Shift Authority, `roster`, or an
 * officer's scopes". Officers need no separate mention, because they hold every
 * scope through the enumeration in `src/shared/roles.ts`.
 */
export function shiftAuthority(alsoScopes: readonly DomainScope[] = []): ShiftAuthorization {
  return { kind: 'shift-authority', alsoScopes }
}

/**
 * This write needs no Domain Scope. Saying so is deliberate: ADR 0010 allows it
 * in exactly the cases `FloorReason` enumerates, and nowhere else.
 */
export function floor(because: FloorReason): AnywhereAuthorization {
  return { kind: 'floor', because }
}

/**
 * A read. Every Volunteer reads everything in v1 — it is all on a wall in a
 * barn that every volunteer walks into (ADR 0010). The two carve-outs,
 * volunteer contact details and the audit log, declare `domainScope('roster')`.
 */
export function readEverything(): AnywhereAuthorization {
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
export function board(): ReadAuthorization {
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

/**
 * Three outcomes, on a **discriminant rather than a boolean**.
 *
 * It was `allowed: true | false` while there were two, and the third could have
 * been spelled as a third value of that field — which would make `!allowed`
 * read as *refused* while being false for a request nothing has authorized yet.
 * A field whose natural negation silently permits is exactly the shape ADR 0016
 * exists to remove, so the field is a name and every reader has to say which of
 * the three they mean.
 */
export type Decision =
  | { readonly outcome: 'allowed' }
  | { readonly outcome: 'refused'; readonly status: 401 | 403; readonly wanted: string }
  /**
   * Signed in, and the rest of the answer is a join against one Shift's roster
   * (ADR 0010: "the Shift axis is a join, not a session variable").
   *
   * `mutation` resolves it from the `shiftId` the payload names, before the
   * handler runs; `ReadAuthorization` is what stops a read reaching a handler
   * on this alone, because a read has no payload to name a Shift in.
   */
  | { readonly outcome: 'over-the-shift-it-names'; readonly required: ShiftAuthorization }

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
        ? { outcome: 'allowed' }
        : { outcome: 'refused', status: 401, wanted: 'read' }

    case 'read-everything':
      // *Every Volunteer* reads everything (ADR 0010) — a person the
      // organisation knows, not anybody who asks. The whiteboard is in a barn
      // that every volunteer walks into, and the barn has a gate.
      //
      // The refusal is explicit and names what it wanted, like every other
      // one: a silent empty answer is indistinguishable from success to a
      // retry queue, and a phone that cannot tell *you are signed out* from
      // *there is nothing today* shows a volunteer an empty barn.
      return actor === null
        ? { outcome: 'refused', status: 401, wanted: 'read' }
        : { outcome: 'allowed' }

    case 'floor':
      // A write with no actor cannot be attributed, and an unattributed tick
      // is the confident lie the paper system already tells.
      return actor === null
        ? { outcome: 'refused', status: 401, wanted: `signed in (${required.because})` }
        : { outcome: 'allowed' }

    case 'scope':
      if (actor === null) {
        return { outcome: 'refused', status: 401, wanted: required.scope }
      }
      return actor.domainScopes.includes(required.scope)
        ? { outcome: 'allowed' }
        : { outcome: 'refused', status: 403, wanted: required.scope }

    case 'any-scope': {
      const wanted = required.scopes.join(' or ')
      if (actor === null) {
        return { outcome: 'refused', status: 401, wanted }
      }
      return required.scopes.some((scope) => actor.domainScopes.includes(scope))
        ? { outcome: 'allowed' }
        : { outcome: 'refused', status: 403, wanted }
    }

    case 'holds-any-scope':
      if (actor === null) {
        return { outcome: 'refused', status: 401, wanted: 'any domain scope' }
      }
      return actor.domainScopes.length > 0
        ? { outcome: 'allowed' }
        : { outcome: 'refused', status: 403, wanted: 'any domain scope' }

    case 'shift-authority':
      // Half the answer. Being signed in is settled here, and so is a Domain
      // Scope the endpoint named as reaching the same act; the position on the
      // Shift the payload names is `src/server/shifts/authority.ts`, run by
      // `mutation` before the handler. Authority expires when the Shift closes,
      // which is why it is read at the moment of the write and never cached.
      if (actor === null) {
        return { outcome: 'refused', status: 401, wanted: describeAuthorization(required) }
      }
      return required.alsoScopes.some((scope) => actor.domainScopes.includes(scope))
        ? { outcome: 'allowed' }
        : { outcome: 'over-the-shift-it-names', required }
  }
}

/** How an authorization reads in a log line and in a denial. */
export function describeAuthorization(required: Authorization): string {
  switch (required.kind) {
    case 'scope':
      return required.scope
    case 'any-scope':
      return required.scopes.join(' or ')
    case 'holds-any-scope':
      return 'any domain scope'
    case 'shift-authority':
      return required.alsoScopes.length === 0
        ? 'shift authority'
        : `shift authority or ${required.alsoScopes.join(' or ')}`
    case 'floor':
      return `floor: ${required.because}`
    case 'read-everything':
      return 'read'
    case 'board':
      return 'board read'
  }
}
