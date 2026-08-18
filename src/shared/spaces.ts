/**
 * The Space vocabulary (ADR 0002): a Space has a *kind*, and a horse is
 * assigned exactly one Space per kind.
 *
 * Lives here rather than beside the checks, for the reason `DOMAIN_SCOPES` and
 * `ROLES` do: a horse's Space assignments cross the wire (ADR 0021), and a
 * second copy of the three kinds in the contract is exactly the drift that
 * exists to remove.
 */
export const SPACE_KINDS = ['stall', 'field', 'barn'] as const

export type SpaceKind = (typeof SPACE_KINDS)[number]

/**
 * Whether a stored string is a kind this build knows.
 *
 * The column is text and a deploy can be older than a row, the same reason
 * `isRole` exists for `volunteer_roles`.
 */
export function isSpaceKind(stored: string): stored is SpaceKind {
  return (SPACE_KINDS as readonly string[]).includes(stored)
}
