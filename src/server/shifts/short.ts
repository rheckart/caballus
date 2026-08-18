/**
 * Short: a person saying so, and a person taking it back (ADR 0011).
 *
 * **The app neither declares it nor withdraws it.** Short means fewer people
 * than the **Essential Work** requires, and not fewer than Target Headcount — a
 * Feed Shift at two of three can still feed, water, medicate and muck, and the
 * app has no idea that Valerie is fast and the new volunteer is not. A derived
 * Short would fire on Shifts that are entirely fine, and a staffing state that
 * cries wolf is ignored exactly the way a channel that carries everything is
 * ignored.
 *
 * The symmetric rule matters as much: **arithmetic never undeclares it
 * either.** When a third volunteer Covers, the app says so loudly and makes
 * clearing it one tap, and then stays out of the decision — the third person to
 * claim might be somebody who cannot carry hay, and the human who declared
 * Short already weighed that. So a Shift can sit marked Short after enough
 * people have Covered, which ADR 0011 accepts deliberately and bounds at hours:
 * it lapses when the Shift closes.
 *
 * **No audit entry.** ADR 0011 files Short with Cover and Drop as a domain
 * record rather than an audit row, sorted by who reads it: the Lead needs to
 * see it on the Shift screen at 5am, and an audit log is not where anybody
 * looks at 5am.
 */
import { eq } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import { shifts } from '../../db/schema'
import { now } from '../../shared/time'
import { timestampOf } from '../time'
import { recorded, refused, type Recorded } from './outcome'

/**
 * Declares a Shift Short, or clears it.
 *
 * One function and a boolean rather than two endpoints, the way retiring a
 * Pattern is: declaring and clearing are the same judgement pointed two ways,
 * and a screen that offers one button whose label changes is what the barn
 * actually meets.
 */
export async function declareShort(
  db: OrgScopedDatabase,
  actorVolunteerId: string,
  about: { readonly shiftId: string; readonly short: boolean },
): Promise<Recorded<null>> {
  const [shift] = await db
    .select({
      id: shifts.id,
      declaredAt: shifts.shortDeclaredAt,
      clearedAt: shifts.shortClearedAt,
    })
    .from(shifts)
    .where(eq(shifts.id, about.shiftId))
    .limit(1)
  if (shift === undefined) return refused('shift_not_found')

  const isShort = shift.declaredAt !== null && shift.clearedAt === null
  // Saying it twice is not a second declaration, and it must not overwrite who
  // said it first — the actor and the time are the whole of what is recorded.
  if (isShort === about.short) return refused(about.short ? 'already_short' : 'not_short')

  const at = timestampOf(now())
  await db
    .update(shifts)
    .set(
      about.short
        ? {
            shortDeclaredAt: at,
            shortDeclaredBy: actorVolunteerId,
            // A fresh declaration is not a cleared one: the pair is reset
            // together so that *is this Shift Short* stays one comparison.
            shortClearedAt: null,
            shortClearedBy: null,
          }
        : { shortClearedAt: at, shortClearedBy: actorVolunteerId },
    )
    .where(eq(shifts.id, about.shiftId))

  return recorded(null)
}
