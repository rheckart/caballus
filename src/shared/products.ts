/**
 * The Product and Supplier vocabulary (ADR 0019, `CONTEXT.md`'s Product and
 * Supplier).
 *
 * Lives here rather than beside the checks, for the reason `DOMAIN_SCOPES` and
 * `SPACE_KINDS` do: a Product's kind crosses the wire on every Feed Schedule
 * line, and a second copy of it in the contract is exactly the drift ADR 0021
 * exists to remove.
 */

/**
 * What a Product is, a fact about the Product and not about where it was
 * written down.
 *
 * **Topical** is what goes *on* a horse rather than in it — zinc oxide,
 * sunblock, fly spray. It is a Product so that Days of Supply can count fly
 * spray, and it is deliberately not a `medication`: a Medicate Item carries
 * `requiresMedicationAuthority`, so calling fly spray a medication would mean
 * only a holder of Medication Authority may fly-spray a horse (#58).
 */
export const PRODUCT_KINDS = ['feed', 'supplement', 'medication', 'topical'] as const

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

/**
 * Which checklist Item a Feed Schedule line generates, by the Product's kind
 * (ADR 0013, #58).
 *
 * A total `Record` rather than a comparison, because the split was
 * `!== 'medication'` → feeding and a fourth kind joined the Feed Item in
 * silence — which is a horse being told to eat fly spray. A Topical generates
 * **no** Item: the work is a Task carrying an instruction, which is where fly
 * spray and sunscreen already live. A fifth kind does not compile until
 * somebody has decided which of the three answers it takes.
 */
export const ITEM_FOR_PRODUCT_KIND: Record<ProductKind, 'feed' | 'medicate' | null> = {
  feed: 'feed',
  supplement: 'feed',
  medication: 'medicate',
  topical: null,
}
