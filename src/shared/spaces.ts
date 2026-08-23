/**
 * The Space vocabulary (ADR 0002, as its Pasture-and-Paddock amendment leaves
 * it): a Space has a *kind*, and a horse is assigned exactly one Space per
 * kind — so a horse turned out holds a Pasture *and* the Paddock attached to
 * it, which is the fact the single `field` kind could not express.
 *
 * Lives here rather than beside the checks, for the reason `DOMAIN_SCOPES` and
 * `ROLES` do: a horse's Space assignments cross the wire (ADR 0021), and a
 * second copy of the kinds in the contract is exactly the drift that
 * exists to remove.
 */
export const SPACE_KINDS = ['stall', 'pasture', 'paddock', 'barn'] as const

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

/**
 * How a run of Spaces is numbered when several are added at once.
 *
 * Two, because a barn names its stalls with numbers and its turnout with
 * letters, and asking somebody to type *Pasture A, Pasture B, Pasture C* one
 * at a time is the chore this exists to remove.
 */
export const NAME_SERIES_STYLES = ['numbers', 'letters'] as const

export type NameSeriesStyle = (typeof NAME_SERIES_STYLES)[number]

/**
 * The most Spaces one act may create.
 *
 * A cap rather than no cap, because the count comes from a number box and a
 * slipped keypress should not be a hundred thousand rows. Fifty is comfortably
 * past the biggest real barn and small enough to be one transaction.
 */
export const MOST_SPACES_AT_ONCE = 50

/**
 * `A`, `B`, … `Z`, `AA`, `AB`: spreadsheet-column lettering, so a barn with
 * twenty-eight pastures does not run out at Z.
 *
 * `index` is zero-based.
 */
function letters(index: number): string {
  let remaining = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (remaining % 26)) + out
    remaining = Math.floor(remaining / 26) - 1
  } while (remaining >= 0)
  return out
}

/**
 * The names a run of Spaces would be given: what the screen shows as a preview
 * and what it then sends, so what somebody approved is exactly what is
 * created rather than something the server worked out again from a rule.
 *
 * Pure, and the one place the numbering lives. `from` is the first number, or
 * the first letter counted from `A` — `from: 1` is `A` and `from: 3` is `C`.
 */
export function seriesNames(details: {
  readonly prefix: string
  readonly style: NameSeriesStyle
  readonly from: number
  readonly count: number
}): readonly string[] {
  const count = Math.max(0, Math.min(Math.trunc(details.count), MOST_SPACES_AT_ONCE))
  const from = Math.max(1, Math.trunc(details.from))
  const prefix = details.prefix

  return Array.from({ length: count }, (_, at) =>
    details.style === 'letters'
      ? `${prefix}${letters(from - 1 + at)}`
      : `${prefix}${String(from + at)}`,
  )
}

/** The prefix a kind starts with, before anybody edits it. */
export const DEFAULT_PREFIX: Record<SpaceKind, string> = {
  stall: 'Stall ',
  pasture: 'Pasture ',
  paddock: 'Paddock ',
  barn: 'Barn ',
}

/**
 * Which kinds a barn letters rather than numbers.
 *
 * Turnout is lettered — `Pasture A`, `Paddock C` — and stalls and barns are
 * numbered, which is the whole of the rule and the reason it is a set rather
 * than a comparison against one literal kind (ADR 0002's amendment made it two).
 */
export const LETTERED_KINDS: readonly SpaceKind[] = ['pasture', 'paddock']
