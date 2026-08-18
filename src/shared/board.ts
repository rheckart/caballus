/**
 * How the Board's rows are arranged (`CONTEXT.md`'s Board): stall order, the
 * Small Barn as its own section, and the row an OPEN stall keeps.
 *
 * Pure, for the reason `src/shared/rostering.ts` and `src/shared/feed-schedule.ts`
 * are: the database read answers *which horse is in which Space*, and
 * everything past that point is arrangement a table of inputs can exercise
 * directly.
 *
 * **The order is a derivation, not a column.** The board's stalls are numbers
 * and a text sort puts 10 between 1 and 2, so the comparison reads the number
 * out of the name — which also places a joined Space (`2 & 3`, ADR 0002) where
 * its first stall was, without anybody maintaining a position field that would
 * be wrong the first time a stall was renamed.
 *
 * **Nothing is ever dropped.** A horse with a stall the caller did not list, or
 * with no Space at all, still gets a row. A faithful grid may be ugly; it may
 * not be missing a horse.
 */

/**
 * What the tablet presents to say it is the tablet (ADR 0022).
 *
 * Here rather than beside the check, because the screen sends it and the server
 * reads it, and a header spelled twice is a header spelled two ways.
 */
export const BOARD_TOKEN_HEADER = 'x-board-token'

/** A Space as a row names it — the id for a key, the name for the barn to read. */
export interface BoardSpaceRef {
  readonly id: string
  readonly name: string
}

/** What the arrangement needs to know about a horse, and nothing else. */
export interface BoardHorseFacts {
  readonly id: string
  readonly name: string
  readonly stall: BoardSpaceRef | null
  readonly barn: BoardSpaceRef | null
}

/** One row: a Space, a horse, or a Space with no horse in it. */
export interface BoardRow<H extends BoardHorseFacts> {
  readonly stall: BoardSpaceRef | null
  readonly horse: H | null
}

export interface BoardSection<H extends BoardHorseFacts> {
  readonly heading: string
  readonly rows: readonly BoardRow<H>[]
}

/** What the stall section is called when its horses name no barn between them. */
const STALLS = 'Stalls'

/** What the horses the board cannot place are gathered under. */
const NOWHERE = 'No space assigned'

/**
 * The number a stall name starts with, or `null` — `10` is 10, `2 & 3` is 2,
 * and `Foaling` is nothing at all.
 */
function leadingNumber(name: string): number | null {
  const digits = /^\s*(\d+)/.exec(name)
  return digits === null ? null : Number(digits[1])
}

/**
 * Stall order: numbered stalls ascending, then the unnumbered ones by name.
 *
 * Exported because it is the half of this module a test can state in one line,
 * and because the ordering is the claim — a board out of stall order is a board
 * nobody can read across a barn.
 */
export function compareStallNames(left: string, right: string): number {
  const first = leadingNumber(left)
  const second = leadingNumber(right)
  if (first !== null && second !== null && first !== second) return first - second
  if (first !== null && second === null) return -1
  if (first === null && second !== null) return 1
  // Codepoint order rather than a locale's: a comparison that changes with the
  // machine's locale is a board that reorders itself between two containers.
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * The board, as sections of rows.
 *
 * The stalls first, in stall order, each carrying its occupant or standing
 * OPEN; then one section per barn holding horses that have no stall — which is
 * how the Small Barn's two horses stay their own section without the model
 * growing a hierarchy of Spaces (ADR 0002); then whatever the board cannot
 * place, so that no horse is left off it.
 *
 * Generic over the horse so that the caller's own payload — feedings, halter
 * colour, everything the grid renders — travels through untouched, and this
 * module knows only about Spaces.
 */
export function arrangeBoard<H extends BoardHorseFacts>(
  horses: readonly H[],
  stalls: readonly BoardSpaceRef[],
): readonly BoardSection<H>[] {
  const stalled = horses.filter((horse) => horse.stall !== null)

  // Every stall Space, plus any stall a horse names that was not among them:
  // an assignment pointing at a Space this read did not list is a bug
  // somewhere else, and losing the horse would be this module's.
  const byId = new Map<string, BoardSpaceRef>()
  for (const space of stalls) byId.set(space.id, space)
  for (const horse of stalled) {
    const held = horse.stall
    if (held !== null && !byId.has(held.id)) byId.set(held.id, held)
  }

  const occupant = new Map<string, H>()
  for (const horse of stalled) {
    if (horse.stall !== null) occupant.set(horse.stall.id, horse)
  }

  const stallRows = [...byId.values()]
    .sort((left, right) => compareStallNames(left.name, right.name))
    .map((space): BoardRow<H> => ({ stall: space, horse: occupant.get(space.id) ?? null }))

  const sections: BoardSection<H>[] = []
  if (stallRows.length > 0) {
    sections.push({ heading: headingFor(stalled), rows: stallRows })
  }

  // The horses with no stall, by the barn they are in: the Small Barn keeps
  // its own section, as the whiteboard has it.
  const unstalled = horses.filter((horse) => horse.stall === null)
  const barns = new Map<string, H[]>()
  const nowhere: H[] = []
  for (const horse of unstalled) {
    if (horse.barn === null) {
      nowhere.push(horse)
      continue
    }
    const held = barns.get(horse.barn.name)
    if (held === undefined) barns.set(horse.barn.name, [horse])
    else held.push(horse)
  }

  for (const name of [...barns.keys()].sort(compare)) {
    sections.push({ heading: name, rows: rowsOf(barns.get(name) ?? []) })
  }

  if (nowhere.length > 0) {
    sections.push({ heading: NOWHERE, rows: rowsOf(nowhere) })
  }

  return sections
}

/**
 * What the stall section is called: the barn its horses are in, where they
 * agree on one, and `Stalls` otherwise.
 *
 * Derived rather than a constant `Main barn`, because *main* is this rescue's
 * word for the building the numbered stalls are in and not a fact the model
 * holds. A board whose horses name two barns says neither.
 */
function headingFor(stalled: readonly BoardHorseFacts[]): string {
  const named = new Set(
    stalled.map((horse) => horse.barn?.name).filter((name): name is string => name !== undefined),
  )
  const [only] = [...named]
  return named.size === 1 && only !== undefined ? only : STALLS
}

function rowsOf<H extends BoardHorseFacts>(horses: readonly H[]): readonly BoardRow<H>[] {
  return [...horses]
    .sort((left, right) => compare(left.name, right.name))
    .map((horse) => ({ stall: horse.stall, horse }))
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
