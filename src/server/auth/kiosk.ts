/**
 * The barn's tablet, which is not a person (ADR 0022).
 *
 * One shared token, held in configuration and presented as a header on the one
 * read the Board makes. It resolves to no `Actor` — there is nobody to credit,
 * which is what `CONTEXT.md` says the Board is — and it can authorize nothing
 * but that read.
 *
 * **Unset means there is no kiosk.** That is the state of every development box
 * and of any deployment nobody has enrolled a tablet on, and it fails closed:
 * an empty configured token must never match an empty presented one.
 */
import { timingSafeEqual } from 'node:crypto'

import { BOARD_TOKEN_HEADER } from '../../shared/board'

/**
 * Whether this request is the rescue's tablet.
 *
 * The header and the configured token, and nothing else — not a cookie, which
 * a browser attaches to requests nobody meant it to, and not a query, which
 * ends up in a log line and a history entry.
 */
export function isKiosk(request: Request): boolean {
  const configured = process.env.BOARD_TOKEN ?? ''
  if (configured === '') return false

  const presented = request.headers.get(BOARD_TOKEN_HEADER)
  if (presented === null || presented === '') return false

  return sameSecret(presented, configured)
}

/**
 * Compared in constant time. The length is compared first and therefore leaks,
 * which is the standard trade: what a timing attack recovers here is the size
 * of a token that reads a feed grid.
 */
function sameSecret(presented: string, configured: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(presented)
  const right = encoder.encode(configured)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
