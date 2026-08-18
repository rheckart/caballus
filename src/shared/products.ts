/**
 * The Product and Supplier vocabulary (ADR 0019, `CONTEXT.md`'s Product and
 * Supplier).
 *
 * Lives here rather than beside the checks, for the reason `DOMAIN_SCOPES` and
 * `SPACE_KINDS` do: a Product's kind crosses the wire on every Feed Schedule
 * line, and a second copy of it in the contract is exactly the drift ADR 0021
 * exists to remove.
 */

/** What a Product is, a fact about the Product and not about where it was written down. */
export const PRODUCT_KINDS = ['feed', 'supplement', 'medication'] as const

export type ProductKind = (typeof PRODUCT_KINDS)[number]

/**
 * Whether a stored string is a kind this build knows.
 *
 * The column is text and a deploy can be older than a row, the same reason
 * `isSpaceKind` exists for `spaces`.
 */
export function isProductKind(stored: string): stored is ProductKind {
  return (PRODUCT_KINDS as readonly string[]).includes(stored)
}
