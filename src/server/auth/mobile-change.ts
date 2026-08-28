/**
 * Changing the number you sign in with (#78, ADR 0029).
 *
 * **This is the trap ADR 0027 already walked out of once, for a different
 * field.** The moment a text is how somebody logs in, a new phone number is a
 * permanent lockout only a Coordinator can undo — the live session survives
 * (it resolves through `volunteer_accounts.userId`, not through a number), the
 * old number is refused by the gate, and the new one matches nobody. So a
 * self-edit of the mobile is **verified before it commits**, exactly as
 * `src/server/auth/email-change.ts` verifies an address.
 *
 * **What is different is who owns the code.** The email flow owns its
 * verification row, so the unverified row *is* the pending state. Verify owns
 * this one — its lifetime, its attempts, its expiry — so there is nothing here
 * to store between the two calls, and the pending state is a code sitting on
 * somebody's handset. The **Service** is what makes it unreachable from the
 * login screen: `change-mobile` and `sign-in` are two Twilio Services, so a
 * code issued for one cannot be checked against the other at the vendor,
 * whatever this application later gets wrong about which number is whose.
 *
 * **Nothing here calls Better Auth**, and that is the same rule
 * `email-change.ts` states rather than a coincidence: `drizzleAdapter` holds
 * `rawDb()` and can never join `mutation`'s transaction. Unlike the email
 * change, nothing here *needs* to — `user` carries no phone number, so the only
 * column that moves is `volunteers.mobile`.
 *
 * **Other sessions are deliberately left alone**, which is where this departs
 * from the email change. That one ends them because the address it moves is the
 * credential every one of those sessions was opened under; here the credential
 * they were opened under — the address — has not moved, and a volunteer whose
 * number changed has not lost anything they still hold. Signing sixty people's
 * second devices out over a new handset would be a cost with no failure behind
 * it.
 */
import { and, eq, isNull, ne } from 'drizzle-orm'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { volunteers } from '../../db/schema'
import { normaliseMobile } from '../../shared/mobile'
import { audit } from '../roster/audit'
import { checkVerification } from './verify'

/** Why a mobile change did not happen, in the words the screen shows. */
export type MobileRefusal =
  | 'volunteer_not_found'
  | 'mobile_invalid'
  | 'mobile_unchanged'
  | 'mobile_taken'
  | 'sms_not_sent'
  | 'wrong_code'

export interface MobileChanged {
  readonly from: string | null
  readonly to: string
}

/**
 * Whether a code may be sent to this number, and what number that is.
 *
 * **It does not send.** Sending is the caller's, and the split is not
 * cosmetic: the per-number budget in `src/server/auth/code-budget.ts` has to be
 * spent *between* the domain refusals and the send, exactly as
 * `/me/email/code` spends it. A send before the budget is a signed-in volunteer
 * looping this endpoint at arbitrary numbers and being billed for every one of
 * them — the refusal would arrive after the message had already gone.
 *
 * Nothing changes here either way: the number moves only when the code comes
 * back to `applyMobileChange`, and until then the volunteer signs in with the
 * old one — which is what the screen says.
 *
 * The two collision checks are pre-flight rather than left to
 * `volunteers_mobile_in_org`. The index is real and would refuse, but inside
 * the transaction that later applies the change — and a constraint violation
 * there aborts the idempotency key with it and answers a 500 rather than a
 * sentence a volunteer can act on. `email-change.ts` makes the same call.
 */
export async function checkMobileChange(
  db: OrgScopedDatabase,
  volunteerId: string,
  rawMobile: string,
): Promise<
  | { readonly ok: true; readonly mobile: string }
  | { readonly ok: false; readonly because: MobileRefusal }
> {
  const checked = await checkTheNumber(db, volunteerId, rawMobile)
  return checked.ok ? { ok: true, mobile: checked.mobile } : checked
}

/**
 * Verifies the code and moves the number, or refuses and touches nothing.
 *
 * The collision checks run **again** rather than being trusted from the code
 * request: a Coordinator giving somebody else this number in the ten minutes
 * between the two is exactly the case the index exists for, and the request
 * that sent the code is long over. The same reasoning `submitCode` uses for
 * re-checking its own gate.
 */
export async function applyMobileChange(
  db: OrgScopedDatabase,
  orgId: OrgId,
  volunteerId: string,
  rawMobile: string,
  code: string,
): Promise<
  | { readonly ok: true; readonly value: MobileChanged }
  | { readonly ok: false; readonly because: MobileRefusal }
> {
  const checked = await checkTheNumber(db, volunteerId, rawMobile)
  if (!checked.ok) return checked

  let approved: boolean
  try {
    approved = await checkVerification(checked.mobile, code, 'change-mobile')
  } catch {
    // The vendor being unreachable is not a wrong code. Telling somebody it is
    // sends them to retype digits that were always right.
    return { ok: false, because: 'sms_not_sent' }
  }
  if (!approved) return { ok: false, because: 'wrong_code' }

  await db.update(volunteers).set({ mobile: checked.mobile }).where(eq(volunteers.id, volunteerId))

  // Audited like any current-state edit, and with **no reason** — a reason
  // exists to explain a decision about another person, and this is the actor's
  // own record (ADR 0027).
  await audit(db, orgId, volunteerId, [
    {
      entity: 'volunteer',
      entityId: volunteerId,
      field: 'mobile',
      before: checked.held,
      after: checked.mobile,
    },
  ])

  return { ok: true, value: { from: checked.held, to: checked.mobile } }
}

/**
 * Gives up the number entirely.
 *
 * **No code, deliberately.** Verification exists to stop somebody being locked
 * out by a number they cannot receive at; giving one up cannot lock anybody out
 * — the address is still there and still signs them in — and asking a volunteer
 * to prove they hold a handset before they may stop giving it to us is the
 * wrong way round.
 */
export async function removeOwnMobile(
  db: OrgScopedDatabase,
  orgId: OrgId,
  volunteerId: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly because: MobileRefusal }> {
  const [mine] = await db
    .select({ mobile: volunteers.mobile })
    .from(volunteers)
    .where(and(eq(volunteers.id, volunteerId), isNull(volunteers.removedAt)))
    .limit(1)
  if (mine === undefined) return { ok: false, because: 'volunteer_not_found' }
  if (mine.mobile === null) return { ok: true }

  await db.update(volunteers).set({ mobile: null }).where(eq(volunteers.id, volunteerId))
  await audit(db, orgId, volunteerId, [
    {
      entity: 'volunteer',
      entityId: volunteerId,
      field: 'mobile',
      before: mine.mobile,
      after: null,
    },
  ])
  return { ok: true }
}

/**
 * The three facts about a proposed number that both halves have to establish:
 * it reads as a number, it is not already theirs, and nobody else holds it.
 */
async function checkTheNumber(
  db: OrgScopedDatabase,
  volunteerId: string,
  rawMobile: string,
): Promise<
  | { readonly ok: true; readonly mobile: string; readonly held: string | null }
  | { readonly ok: false; readonly because: MobileRefusal }
> {
  const mobile = normaliseMobile(rawMobile)
  if (mobile === null) return { ok: false, because: 'mobile_invalid' }

  const [mine] = await db
    .select({ mobile: volunteers.mobile })
    .from(volunteers)
    .where(and(eq(volunteers.id, volunteerId), isNull(volunteers.removedAt)))
    .limit(1)
  if (mine === undefined) return { ok: false, because: 'volunteer_not_found' }
  if (mine.mobile === mobile) return { ok: false, because: 'mobile_unchanged' }

  const [taken] = await db
    .select({ id: volunteers.id })
    .from(volunteers)
    .where(
      and(
        eq(volunteers.mobile, mobile),
        isNull(volunteers.removedAt),
        ne(volunteers.id, volunteerId),
      ),
    )
    .limit(1)
  if (taken !== undefined) return { ok: false, because: 'mobile_taken' }

  return { ok: true, mobile, held: mine.mobile }
}
