/**
 * Authorization is a Domain Scope or a roster position, and nothing else
 * (ADR 0010). There is no authorship axis, no ownership axis, no per-endpoint
 * role list and no wildcard.
 *
 * Every `/api/v1` handler declares what it requires, and the declaration is a
 * required argument to `route` — so omission is a type error rather than a
 * quietly unauthorized endpoint (ADR 0016).
 */
import type { Actor } from '../request-context'

/** ADR 0010's five live scopes, plus the two declared but dormant. */
export const DOMAIN_SCOPES = [
  'horse_care',
  'maintenance',
  'roster',
  'supplies',
  'grants',
  'financial',
  'events',
] as const

export type DomainScope = (typeof DOMAIN_SCOPES)[number]

/**
 * The three legitimate uses of `floor` today. Stated as a type so that a
 * fourth is a deliberate act — somebody adds a member here, and the diff says
 * what they decided (ADR 0016).
 */
export type FloorReason =
  | 'work-on-a-shift-you-are-rostered-on'
  | 'record-an-observation'
  | 'record-your-own-presence'

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
      // Anonymous while the POC has no accounts (ADR 0006). Reads are the
      // whiteboard, and the whiteboard is already in the barn.
      return { allowed: true }

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
