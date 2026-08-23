/**
 * Rows into a `Map`, keyed by whatever the caller reads off each one.
 *
 * Its own module because the same six lines had already been written privately
 * in two reads before #60 made it three, and a hand-rolled `get`/`undefined`/
 * `push` is the shape a typo hides in.
 */
export function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>()
  for (const row of rows) {
    const at = key(row)
    const held = grouped.get(at)
    if (held === undefined) grouped.set(at, [row])
    else held.push(row)
  }
  return grouped
}
