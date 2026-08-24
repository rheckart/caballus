/**
 * How often one address may be sent a six-digit code, over every path that
 * sends one.
 *
 * ADR 0008 set three sends an hour per identifier and ADR 0009 kept it with the
 * cost inverted: it is no longer that a send spends money, it is that the code
 * paths are reachable from outside — the login form by anybody, and `/me/email/code`
 * by any signed-in volunteer naming **any** address — and the only thing above
 * them is `DAILY_CAP` in `src/server/email.ts`, which the whole rescue shares.
 * Without a per-address limit a couple of hundred requests spend the day's
 * budget and sign-in stops working for everybody: a denial of service against
 * the one screen that has to work.
 *
 * **One window across both paths**, which is why this is a module of its own
 * rather than a private in `./sign-in.ts` where it started (#68). A limit the
 * sign-in door honours and the change-email door does not is not a limit; it is
 * a second door into the same inbox and the same budget.
 *
 * In memory, and honestly so: ADR 0007 deploys one container, so one process is
 * the whole of the deployment. A second container is what makes this a table.
 */
import { elapsed, now, type Instant } from '../../shared/time'

export const CODES_PER_ADDRESS = 3
const CODE_WINDOW_MILLIS = 60 * 60 * 1000

const askedAt = new Map<string, Instant[]>()

/** Empties the window. For tests, which each start from nobody having asked. */
export function forgetCodeRequestsForTest(): void {
  askedAt.clear()
}

/**
 * Records this request and says whether it is one too many.
 *
 * Counted per address rather than per caller, deliberately: the thing being
 * protected is the volunteer's inbox and the rescue's send budget, and both are
 * attached to the address rather than to whoever asked.
 */
export function askedTooOften(email: string): boolean {
  const at = now()
  const recent = (askedAt.get(email) ?? []).filter(
    (earlier) => elapsed(earlier, at) < CODE_WINDOW_MILLIS,
  )
  if (recent.length >= CODES_PER_ADDRESS) {
    askedAt.set(email, recent)
    return true
  }
  askedAt.set(email, [...recent, at])
  return false
}
