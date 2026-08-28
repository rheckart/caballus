/**
 * The order a horse's Timeline is read in, and the vocabulary of what can be
 * on it (#74).
 *
 * A Timeline **composes records that already exist** — an Observation, the
 * Escalation it became, an Alert raised and the same Alert ended, a weight, a
 * Feed Schedule version. Nothing is authored here and nothing is stored: this
 * module is the one statement of what an entry is and which one comes first,
 * so the profile and any later surface cannot disagree about Tuesday.
 *
 * **Every entry is ordered by when it was *recorded*, never by the date it is
 * about.** A weight taken on the 1st and written down on the 5th belongs where
 * somebody would look for it — beside the other things that happened on the
 * 5th — and `takenOn` travels with it for the sentence to say. The same rule
 * puts a Feed Schedule version at its `createdAt` and carries `validFrom`. One
 * rule for five kinds, because five rules is five chances for two surfaces to
 * sort the same day differently.
 */

/** What a Timeline entry can be. A sixth is a deploy, like `ALERT_KINDS`. */
export const TIMELINE_KINDS = [
  'observation',
  'alert_raised',
  'alert_ended',
  'measurement',
  'feed_schedule',
] as const

export type TimelineKind = (typeof TIMELINE_KINDS)[number]

export function isTimelineKind(value: string): value is TimelineKind {
  return (TIMELINE_KINDS as readonly string[]).includes(value)
}

/**
 * The minimum an entry has to carry to be placed: when it was recorded, and an
 * id to break a tie with.
 *
 * Structural rather than the full union, on `Alertish`'s own precedent in
 * `src/shared/alerts.ts` — the server's shape and the contract's parsed shape
 * are different types that agree about these two fields, and a comparator that
 * named either of them would only sort one of them.
 */
export interface Placeable {
  readonly id: string
  /** Epoch milliseconds, from the column that says when this was written down. */
  readonly at: number
}

/**
 * Newest first, then by id.
 *
 * The id tiebreak is not decoration. Two Alerts raised in one `raiseAlert`
 * call, or a Feed Schedule version and the measurement recorded beside it, can
 * carry the same millisecond — and a comparator that returned 0 there leaves
 * the order to whatever the database happened to return, which is a Timeline
 * that reshuffles itself between two reads of the same horse.
 */
export function compareTimeline(left: Placeable, right: Placeable): number {
  if (left.at !== right.at) return right.at - left.at
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/** How a kind reads as a heading, on the profile and anywhere else. */
export const TIMELINE_KIND_LABEL: Record<TimelineKind, string> = {
  observation: 'Reported',
  alert_raised: 'Alert raised',
  alert_ended: 'Alert ended',
  measurement: 'Measured',
  feed_schedule: 'Feed schedule',
}
