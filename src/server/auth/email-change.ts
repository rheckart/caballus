/**
 * Changing the address you sign in with (#68, ADR 0027).
 *
 * **The email is the credential, and that is the whole of the design.**
 * `requestCode` gates on `volunteerByEmail`, so `volunteers.email` is what
 * decides whether a code is sent at all — and where it is sent. Moving it
 * naively to an address nobody can receive at is a permanent lockout: the live
 * session survives — it resolves through `volunteer_accounts.userId` and not
 * through an address — the old address is refused by the gate, and every code
 * the new one is sent goes to an inbox the volunteer cannot open. Only a
 * Coordinator can undo it. So a self-edit of the email is **verified before it
 * commits**.
 *
 * **The pending change needs no table.** The unverified code *is* the pending
 * state, in Better Auth's own `verification` row keyed by the new address. The
 * code proves the inbox; the session proves who is asking. A
 * `pending_email_changes` table would be the fifth hand-rolled log ADR 0019
 * warns about, with expiry and cleanup this row already has.
 *
 * **The row is keyed `change-email-otp-<address>`, which is Better Auth's own
 * spelling for a type it accepts and `signInEmailOTP` never reads** — that
 * endpoint looks only under `sign-in-otp-<address>`, so a code obtained here is
 * structurally unreachable from the login screen. Reproducing the key rather
 * than inventing one keeps that guarantee legible beside the library that makes
 * it, and `src/server/api/me.test.ts` asserts both halves.
 *
 * **`volunteers.email` is the only column that moves** (ADR 0030, amending
 * ADR 0027). Better Auth's `user` is keyed by an opaque Account key derived
 * from the Volunteer (`accountKey` in `./volunteers.ts`) and says nothing about
 * the person any more, so there is no second address column to keep in step.
 * ADR 0027 once wrote `user.email` here too, as the one deliberate exception to
 * `src/server/auth/revoke.ts`'s rule against a second writer to Better Auth's
 * tables; that exception is gone. It was also the cross-rescue hole's other
 * half: `user.email` is unique across every organisation, so a change made at
 * one rescue could move the address another rescue's officer signed in by.
 * `volunteers_email_in_org` is now the whole guard.
 *
 * **Everything here runs on the transaction `mutation` opened, and nothing
 * calls Better Auth.** That is not a preference. `drizzleAdapter` is built with
 * `rawDb()` rather than the transaction handle (`src/server/auth/auth.ts`), so
 * every `auth().api.*` or `internalAdapter.*` call takes a **second**
 * connection out of a pool of ten while the first is still held — ten
 * concurrent changes would each wait on an eleventh connection that cannot
 * arrive, and the whole process stops. So the pending code's `verification`
 * row and the other devices' `session` rows are written here directly with
 * the scoped handle — neither carries an `org_id` or a policy, and both are
 * rows of this Volunteer's own Account. The row formats this depends on are
 * pinned by tests rather than by hope.
 */
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import {
  codeMatches,
  hashCode,
  mintCode,
  CODE_ALLOWED_ATTEMPTS,
  CODE_EXPIRES_IN_SECONDS,
} from './auth'
import { normaliseEmail } from '../roster/records'
import type { OrgScopedDatabase } from '../../db/for-org'
import { sessions, verifications, volunteerAccounts, volunteers } from '../../db/schema'
import { instant, now } from '../../shared/time'

/**
 * The verification row's key, exactly as Better Auth spells it.
 *
 * Reproduced rather than imported because `toOTPIdentifier` is internal to the
 * plugin. `src/server/api/me.test.ts` asserts the format directly and asserts
 * that `submitCode` refuses a code minted under it — so a library that changed
 * the spelling would fail a test rather than fail a volunteer.
 */
function otpIdentifier(email: string): string {
  return `change-email-otp-${email}`
}

/**
 * The stored value is `<hash>:<attempts>`, Better Auth's own shape, and an
 * address may contain a colon — so the split is at the **last** one.
 */
function splitAtLastColon(value: string): readonly [string, string] {
  const at = value.lastIndexOf(':')
  return at === -1 ? [value, ''] : [value.slice(0, at), value.slice(at + 1)]
}

/** Whether a code was minted, or why it was not. */
export type CodeRefusal =
  'volunteer_not_found' | 'email_unchanged' | 'email_taken' | 'email_not_sent' | 'too_many_codes'

/**
 * Mints a code for `rawEmail` and hands it back for the caller to send.
 *
 * The sending is the caller's because that is the discipline `requestCode`
 * already keeps: Better Auth's own sender swallows its failure and reports a
 * message that never left, and with email the only channel there is (ADR 0009)
 * *we sent you a code* has to be true when it is said.
 *
 * The collision check is pre-flight rather than left to the index.
 * `volunteers_email_in_org` is real and would refuse — but inside the
 * transaction that later applies the change, and a constraint violation there
 * aborts the idempotency key with it and answers a 500 rather than a sentence a
 * volunteer can act on.
 */
export async function mintEmailChangeCode(
  db: OrgScopedDatabase,
  volunteerId: string,
  rawEmail: string,
): Promise<
  | { readonly ok: true; readonly email: string; readonly otp: string }
  | { readonly ok: false; readonly because: CodeRefusal }
> {
  const email = normaliseEmail(rawEmail)

  const [mine] = await db
    .select({ email: volunteers.email })
    .from(volunteers)
    .where(eq(volunteers.id, volunteerId))
    .limit(1)
  if (mine === undefined) return { ok: false, because: 'volunteer_not_found' }
  if (mine.email === email) return { ok: false, because: 'email_unchanged' }

  if (await addressIsTaken(db, email)) return { ok: false, because: 'email_taken' }

  const identifier = otpIdentifier(email)
  // A previous request for the same address is dropped rather than left
  // alongside: two live rows for one identifier is a code somebody was told
  // works and that the consume below will not find.
  await db.delete(verifications).where(eq(verifications.identifier, identifier))

  const otp = mintCode()
  await db.insert(verifications).values({
    id: uuidv7(),
    identifier,
    // `<hash>:<attempts>`, the shape Better Auth writes and reads. Hashed at
    // rest for the reason the sign-in code is: a five-minute credential
    // sitting in plaintext beside the care record is a needless second thing
    // to lose in one restore.
    value: `${await hashCode(otp)}:0`,
    // The **database's** clock, in SQL, rather than a `Date` built here. ADR
    // 0016 keeps the calendar in two modules and neither of them is about a
    // five-minute duration; and a row whose expiry is set by the same clock
    // that will later be asked to compare it cannot be wrong about it.
    expiresAt: sql`now() + make_interval(secs => ${CODE_EXPIRES_IN_SECONDS})`,
  })

  return { ok: true, email, otp }
}

/** Why a submitted code did not move the address. */
export type ChangeRefusal = CodeRefusal | 'no_code' | 'wrong_code' | 'account_not_claimed'

export interface EmailChanged {
  readonly from: string
  readonly to: string
  /** How many other devices were signed out with it (ADR 0008, ADR 0027). */
  readonly sessionsEnded: number
}

/**
 * Verifies the code, moves the address and ends every other session, or
 * refuses and touches nothing.
 *
 * All of it commits together, which is stronger than ADR 0027 asked for and
 * falls out of doing the work on one handle: a rollback cannot leave somebody
 * signed out of a change that did not happen. The **one** thing outside the
 * transaction is the message
 * to the old address, which is the caller's and is deliberately logged rather
 * than thrown — refusing a completed credential change over an undeliverable
 * notice would leave a volunteer with an address they cannot sign in at.
 */
export async function applyEmailChange(
  db: OrgScopedDatabase,
  volunteerId: string,
  keepSessionToken: string | null,
  rawEmail: string,
  code: string,
): Promise<
  | { readonly ok: true; readonly value: EmailChanged }
  | { readonly ok: false; readonly because: ChangeRefusal }
> {
  const email = normaliseEmail(rawEmail)

  const [mine] = await db
    .select({ email: volunteers.email })
    .from(volunteers)
    .where(eq(volunteers.id, volunteerId))
    .limit(1)
  if (mine === undefined) return { ok: false, because: 'volunteer_not_found' }
  if (mine.email === email) return { ok: false, because: 'email_unchanged' }
  if (await addressIsTaken(db, email)) return { ok: false, because: 'email_taken' }

  // The Account, which a self-edit always implies: it takes a session to reach
  // this, and a session resolves through this row. The unclaimed case is
  // `roster`'s door, where there is no credential in use to protect.
  const [claimed] = await db
    .select({ userId: volunteerAccounts.userId })
    .from(volunteerAccounts)
    .where(eq(volunteerAccounts.volunteerId, volunteerId))
    .limit(1)
  if (claimed === undefined) return { ok: false, because: 'account_not_claimed' }

  const checked = await consumeCode(db, email, code)
  if (checked !== 'ok') return { ok: false, because: checked }

  // `volunteers` alone (ADR 0030). The Account is keyed by the Volunteer and not
  // by an address, so the `user` row has nothing to move — and the next code is
  // still checked against that row's own identifier, wherever it is now sent.
  await db.update(volunteers).set({ email }).where(eq(volunteers.id, volunteerId))

  const ended = await db
    .delete(sessions)
    .where(
      keepSessionToken === null
        ? eq(sessions.userId, claimed.userId)
        : and(eq(sessions.userId, claimed.userId), ne(sessions.token, keepSessionToken)),
    )
    .returning({ id: sessions.id })

  return { ok: true, value: { from: mine.email, to: email, sessionsEnded: ended.length } }
}

/**
 * Consumes the verification row and says whether the code was right.
 *
 * The row is deleted before it is compared, so a correct code is accepted
 * exactly once and a racing second caller finds nothing — Better Auth's own
 * shape, and the reason it is that way round. A **wrong** code puts the row
 * back with its attempt count raised, so a mistyped digit does not cost the
 * whole code; when the budget ADR 0008 set is spent the row stays gone and the
 * identifier is locked out until a new code is asked for.
 *
 * An expired row is treated as absent and still deleted, so it cannot be
 * replayed later.
 */
async function consumeCode(
  db: OrgScopedDatabase,
  email: string,
  code: string,
): Promise<'ok' | 'no_code' | 'wrong_code'> {
  const identifier = otpIdentifier(email)

  const [held] = await db
    .delete(verifications)
    .where(eq(verifications.identifier, identifier))
    .returning({ value: verifications.value, expiresAt: verifications.expiresAt })

  if (held === undefined || instant(held.expiresAt.getTime()) <= now()) return 'no_code'

  const [stored, attempts] = splitAtLastColon(held.value)
  if (await codeMatches(code.trim(), stored)) return 'ok'

  const spent = Number.parseInt(attempts, 10) + 1
  if (spent < CODE_ALLOWED_ATTEMPTS) {
    await db.insert(verifications).values({
      id: uuidv7(),
      identifier,
      value: `${stored}:${String(spent)}`,
      expiresAt: held.expiresAt,
    })
  }
  return 'wrong_code'
}

/**
 * Whether a live Volunteer in this organisation already holds this address.
 *
 * Per-organisation and partial over the live rows, matching
 * `volunteers_email_in_org` and the filter `createVolunteerIn` checks against.
 * It once asked Better Auth's `user` too, because `user.email` was unique
 * across every rescue (ADR 0027 recorded it as the seam a multi-org deployment
 * meets first). ADR 0030 met it: `user` is keyed by the Volunteer now, so an
 * address held at another rescue is no business of this one's.
 */
async function addressIsTaken(db: OrgScopedDatabase, email: string): Promise<boolean> {
  const [heldByVolunteer] = await db
    .select({ id: volunteers.id })
    .from(volunteers)
    .where(and(eq(volunteers.email, email), isNull(volunteers.removedAt)))
    .limit(1)
  return heldByVolunteer !== undefined
}

/**
 * The most recent verification row under this identifier.
 *
 * Exported for the tests, because the key and the `<hash>:<attempts>` value are
 * a dependency on somebody else's table, and a dependency nothing asserts is a
 * dependency that breaks quietly on an upgrade.
 */
export async function changeEmailVerificationForTest(
  db: OrgScopedDatabase,
  rawEmail: string,
): Promise<{ readonly identifier: string; readonly value: string } | null> {
  const identifier = otpIdentifier(normaliseEmail(rawEmail))
  const [row] = await db
    .select({ identifier: verifications.identifier, value: verifications.value })
    .from(verifications)
    .where(eq(verifications.identifier, identifier))
    .orderBy(desc(verifications.createdAt))
    .limit(1)
  return row ?? null
}
