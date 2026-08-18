/**
 * How the shift prep queue's cards are arranged: per-horse cards in stall
 * order, per-Space Items grouped after, and whatever belongs to the rescue as
 * a whole last (`CONTEXT.md`'s shift prep queue — "the per-horse work list a
 * volunteer actually works from", distinct from the Board; ADR 0013, #42).
 *
 * Pure, the same discipline `src/shared/board.ts` follows for the Board's own
 * arrangement: the read answers which Item belongs to which Subject, and
 * everything past that point is grouping and ordering a table of inputs can
 * exercise directly. Stall order is `compareStallNames` itself — a card out
 * of the order a volunteer's loop through the barn actually runs in defeats
 * the whole reason cards are per-horse (ADR 0013's "the work surface is
 * subject-first").
 */
import { compareStallNames } from './board'

/** What this module needs from an Item — the checklist's own shape satisfies it without adaptation. */
export interface PrepQueueItem {
  readonly id: string
  readonly horseId: string | null
  readonly horseName: string | null
  readonly horseStallName: string | null
  readonly spaceId: string | null
  readonly spaceName: string | null
}

export interface HorseCard<I extends PrepQueueItem> {
  readonly horseId: string
  readonly horseName: string
  /** Null for a horse with no stall — grouped after the stalled ones, by name. */
  readonly stallName: string | null
  readonly items: readonly I[]
}

export interface SpaceCard<I extends PrepQueueItem> {
  readonly spaceId: string
  readonly spaceName: string
  readonly items: readonly I[]
}

export interface PrepQueue<I extends PrepQueueItem> {
  readonly horses: readonly HorseCard<I>[]
  readonly spaces: readonly SpaceCard<I>[]
  /** Items with neither a horse nor a Space — the rescue-wide ones. */
  readonly rescue: readonly I[]
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Groups Items into cards and orders the cards the way a volunteer's loop
 * through the barn runs: stalled horses in stall order, then the unstalled
 * ones by name, then Spaces by name, then the rescue's own list.
 */
export function arrangePrepQueue<I extends PrepQueueItem>(items: readonly I[]): PrepQueue<I> {
  const byHorse = new Map<string, I[]>()
  const bySpace = new Map<string, I[]>()
  const rescue: I[] = []

  for (const item of items) {
    if (item.horseId !== null) {
      const held = byHorse.get(item.horseId)
      if (held === undefined) byHorse.set(item.horseId, [item])
      else held.push(item)
      continue
    }
    if (item.spaceId !== null) {
      const held = bySpace.get(item.spaceId)
      if (held === undefined) bySpace.set(item.spaceId, [item])
      else held.push(item)
      continue
    }
    rescue.push(item)
  }

  const horses = [...byHorse.entries()]
    .map(([horseId, horseItems]): HorseCard<I> => ({
      horseId,
      horseName: horseItems[0]?.horseName ?? 'A horse',
      stallName: horseItems[0]?.horseStallName ?? null,
      items: horseItems,
    }))
    .sort((left, right) => {
      if (left.stallName !== null && right.stallName !== null) {
        return compareStallNames(left.stallName, right.stallName)
      }
      if (left.stallName !== null) return -1
      if (right.stallName !== null) return 1
      return compareNames(left.horseName, right.horseName)
    })

  const spaces = [...bySpace.entries()]
    .map(([spaceId, spaceItems]): SpaceCard<I> => ({
      spaceId,
      spaceName: spaceItems[0]?.spaceName ?? 'A Space',
      items: spaceItems,
    }))
    .sort((left, right) => compareNames(left.spaceName, right.spaceName))

  return { horses, spaces, rescue }
}
