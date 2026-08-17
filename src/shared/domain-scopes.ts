/**
 * The authorization vocabulary, on the side of the wire both halves read.
 *
 * It lives here rather than beside the checks in `src/server/api/authorization.ts`
 * because `/me` carries a volunteer's scopes to the phone (ADR 0021: the
 * contract is one declaration both sides read), and a second copy of this list
 * in the contract is exactly the drift that contract exists to remove. The
 * checks stay on the server; only the *names* are shared.
 *
 * **Named Domain Scope, never Scope.** `CONTEXT.md` already uses _Scope_ for
 * which horses a piece of work applies to — the barn's sense, and the barn's
 * word wins (ADR 0010).
 */

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
