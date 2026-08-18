/**
 * Shift Authority: the second of ADR 0010's two reasons anybody may act, and
 * the one that was declared and unresolvable until #39 made Shifts real.
 *
 * "A volunteer may act because of a **Domain Scope** they hold in the
 * organisation, or because of the **position they hold on one Shift**." The
 * first is a fact about a person and `authorize` settles it from the session
 * alone. This one is a **join against one Shift's roster**, which is why ADR
 * 0010 says in as many words that "the Shift axis is a join, not a session
 * variable" — so it is resolved here, from the `shiftId` the write names, and
 * `src/server/api/route.ts` runs it before the handler rather than leaving each
 * handler to remember (ADR 0016).
 *
 * **This module answers about the position and nothing else.** A Domain Scope
 * that reaches the same act is named on the endpoint — `shiftAuthority(['roster'])`
 * for the Short declaration, which is ADR 0011's own sentence — and settled by
 * `authorize` before anything gets here. Folding `roster` in at this level
 * instead would hand a Volunteer Coordinator every Shift-Authority write there
 * will ever be, closing the Shift included, on the strength of one endpoint's
 * requirement.
 *
 * **A position that has ended carries nothing.** A Lead who dropped is not the
 * Lead of that Shift any more; the row stays because *rostered and dropped* is
 * a fact worth keeping (ADR 0011), not because it still authorizes anything.
 */
import { and, eq, isNull } from 'drizzle-orm'

import { forOrg, type OrgId } from '../../db/for-org'
import { shiftRoster } from '../../db/schema'
import { carriesShiftAuthority, isShiftPosition } from '../../shared/shifts'
import type { Actor } from '../request-context'

/**
 * Whether this actor holds a standing `lead`, `co_lead` or `acting_lead` row on
 * this Shift.
 *
 * Answers false for a Shift that does not exist, which is the same answer as
 * for one somebody has no position on — deliberately, because the alternative
 * turns an authorization check into an existence oracle, and the handler is
 * about to answer `shift_not_found` for the real case anyway.
 */
export async function holdsShiftAuthority(
  orgId: OrgId,
  actor: Actor,
  shiftId: string,
): Promise<boolean> {
  const rows = await forOrg(orgId).run((db) =>
    db
      .select({ position: shiftRoster.position })
      .from(shiftRoster)
      .where(
        and(
          eq(shiftRoster.shiftId, shiftId),
          eq(shiftRoster.volunteerId, actor.volunteerId),
          isNull(shiftRoster.endedAt),
        ),
      )
      .limit(1),
  )

  return rows.some((row) => isShiftPosition(row.position) && carriesShiftAuthority(row.position))
}
