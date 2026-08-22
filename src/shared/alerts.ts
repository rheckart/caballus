/**
 * What an Alert is, in the vocabulary both seams read (`CONTEXT.md`'s Alert;
 * ADR 0024, #60): a standing warning on a horse that a volunteer must read
 * before working with it.
 *
 * `ALERT_KINDS` is a closed fence, the way `SPACE_KINDS` and `PRODUCT_KINDS`
 * are: three kinds, and a fourth is a deploy rather than a row somebody types.
 * A safety fact is not a place for free vocabulary — a kind nobody else uses
 * is a kind nobody else reads.
 *
 * `compareAlerts` is here rather than on any one screen because the profile,
 * the Work Surface card and the Board's cell must not order the same two
 * Alerts differently. A volunteer reading *no treats* first on the wall and
 * second on the phone has been given two boards to reconcile, which is the
 * whole failure the paper one does not have.
 */

/** The three, in the order every surface shows them (ADR 0024). */
export const ALERT_KINDS = ['prohibition', 'care', 'allergy'] as const

export type AlertKind = (typeof ALERT_KINDS)[number]

export function isAlertKind(value: string): value is AlertKind {
  return (ALERT_KINDS as readonly string[]).includes(value)
}

/** What a screen calls each kind — the words, never the stored token. */
export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  prohibition: 'Do not',
  care: 'Care',
  allergy: 'Allergy',
}

/** The least this module needs to order two Alerts: what the contract's own shape already carries. */
export interface Alertish {
  readonly id: string
  readonly kind: AlertKind
  /** Epoch milliseconds. */
  readonly raisedAt: number
}

/**
 * Prohibition first, then care, then allergy; oldest first within a kind.
 *
 * Oldest rather than newest, deliberately: the cell on a wall is read at a
 * glance across a barn, and a standing fact that moves down the list every
 * time a new one is raised is a fact people stop finding where they left it.
 * The id breaks a tie so the order is total — two Alerts raised in the same
 * millisecond still sort the same way on every surface and on every render.
 */
export function compareAlerts(left: Alertish, right: Alertish): number {
  // The declared order of `ALERT_KINDS` *is* the order, rather than a second
  // table beside it: a fourth kind is then one edit in one place, and the two
  // could never disagree about which warning a volunteer reads first.
  if (left.kind !== right.kind) {
    return ALERT_KINDS.indexOf(left.kind) - ALERT_KINDS.indexOf(right.kind)
  }
  if (left.raisedAt !== right.raisedAt) return left.raisedAt - right.raisedAt
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}
