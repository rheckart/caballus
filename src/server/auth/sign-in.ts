/**
 * Signing in: a six-digit code to an address **or a mobile number** the rescue
 * already knows, and a session row that lasts until somebody revokes it
 * (ADR 0008, 0009, 0029).
 *
 * **The second door is a second door and never a replacement** (ADR 0029).
 * `volunteers.email` is still the credential every Account resolves through;
 * what the number buys is the volunteer ADR 0009 named as its own sharpest
 * risk — the one with no usable email, or who never reads it, who is the
 * reason this whole line of work started.
 *
 * **The code for a number is Twilio Verify's, and the session is still Better
 * Auth's.** Verify proves the handset and nothing else — it has no idea who
 * this rescue's people are — so once it says *approved*, the session is minted
 * through the one path that already knows how to claim an Account: a sign-in
 * OTP for the Volunteer's own address, created and consumed here without ever
 * being sent anywhere. That is not a back door. The gate above it is the same
 * gate the emailed code passes, and the Account claimed is the same row; what
 * changes is which of two facts about the same person was proved.
 *
 * **Login is never gated on SMS Consent** (ADR 0028, ADR 0029). A code is
 * asked for by the person receiving it, in the moment, which is not standing
 * permission to be messaged — and conflating them means a volunteer who
 * replied STOP to a staffing text finds they can no longer sign in.
 *
 * These are plain functions rather than endpoints. Signing in is a **credential
 * exchange that must never be replayed from a queue** — the whole of ADR 0005
 * is that a write is safe to send twice, and a code is exactly the thing that
 * is not — so it does not go through `mutation`, and `src/server/auth/login.ts`
 * is the thin server-function shell that carries the cookie back. What is here
 * is the decisions; what is there is the transport.
 *
 * The gate is ours and not Better Auth's. A code is only ever sent to an
 * address that already has a Volunteer in this organisation, so the Account is
 * *claimed* rather than created (ADR 0008), and Better Auth never gets the
 * chance to sign somebody up whom nobody invited.
 */
import { auth, codeEmail } from './auth'
import { askedTooOften } from './code-budget'
import { sendEmail } from '../email'
import { checkVerification, sendVerification } from './verify'
import { looksLikeMobile, normaliseMobile } from '../../shared/mobile'
import {
  claimAccount,
  hasLeftTheRescue,
  hasLeftTheRescueByMobile,
  normaliseEmail,
  volunteerByEmail,
  volunteerByMobile,
  type Volunteer,
} from './volunteers'
import { forOrg, type OrgId } from '../../db/for-org'
import { volunteerAccounts } from '../../db/schema'
import { log } from '../observability'
import { eq } from 'drizzle-orm'

/**
 * Why a sign-in did not happen, in the words the login screen shows.
 *
 * Every one of them is told to the person plainly. ADR 0008 decided this
 * against the usual convention: enumerating a sixty-person invite-only roster
 * is not a meaningful threat, and the conventional "if that address is
 * registered…" leaves a volunteer standing in a barn waiting for a code that a
 * mistyped character guaranteed would never arrive.
 */
export type Refusal =
  | 'unrecognised-email'
  /**
   * A number nobody at the rescue holds — and also a number that could not be
   * read as one at all, deliberately: both send somebody to look for a typo,
   * and splitting them would be two sentences for one mistake (#78).
   */
  | 'unrecognised-mobile'
  | 'volunteer-removed'
  | 'account-revoked'
  | 'wrong-code'
  | 'email-not-sent'
  | 'sms-not-sent'
  | 'too-many-codes'

/**
 * The per-address code budget, shared with `/me/email/code` (#68).
 *
 * It moved to `./code-budget.ts` when a second path started sending codes: a
 * limit one door honours and the other does not is a second door into the same
 * inbox and the same `DAILY_CAP`. Re-exported here so this module's callers —
 * the login screen's tests among them — keep one import.
 */
export { CODES_PER_ADDRESS, forgetCodeRequestsForTest } from './code-budget'

export type CodeRequested =
  { readonly sent: true } | { readonly sent: false; readonly because: Refusal }

/**
 * Sends a code, or says why it did not.
 *
 * The three refusals before the send are the whole of the gate: an address
 * nobody invited, a Volunteer who has left the rescue, and an Account an
 * officer revoked. The fourth is email itself failing, which with ADR 0009's
 * single channel is the difference between *your code is coming* and *nothing
 * is coming and nobody will tell you*.
 */
export async function requestCode(orgId: OrgId, identifier: string): Promise<CodeRequested> {
  if (looksLikeMobile(identifier)) return requestCodeByMobile(orgId, identifier)

  const refused = await gate(orgId, identifier)
  if (refused !== null) {
    log('warn', 'sign_in_refused', { stage: 'request_code', because: refused })
    return { sent: false, because: refused }
  }

  const email = normaliseEmail(identifier)
  if (askedTooOften(email)) {
    // Counted after the gate, so that an address nobody invited is told so
    // every time rather than being rate-limited into a different answer — the
    // refusal a volunteer needs to see is *check it for a typo*, and it must
    // not turn into *slow down* on the fourth attempt.
    log('warn', 'sign_in_refused', { stage: 'request_code', because: 'too-many-codes' })
    return { sent: false, because: 'too-many-codes' }
  }

  try {
    // Minted here and sent here, rather than handed to Better Auth's own
    // sender. That sender's rejection is swallowed — `sent: true` comes back
    // for a message that never left — and with email the only channel there
    // is (ADR 0009), *we sent you a code* has to be true when it is said.
    // `createVerificationOTP` writes the same row the same way, hashed and
    // five minutes long; the only thing that moves is who does the sending.
    const otp = await auth().api.createVerificationOTP({ body: { email, type: 'sign-in' } })
    await sendEmail(codeEmail(email, otp))
  } catch {
    // Deliberately not re-thrown as a 500. The volunteer needs to be told that
    // nothing is coming, which is a different thing from the app being broken,
    // and the operator needs the line — the two are separated here rather than
    // merged into one unhelpful error page.
    log('error', 'sign_in_refused', { stage: 'request_code', because: 'email-not-sent' })
    return { sent: false, because: 'email-not-sent' }
  }

  return { sent: true }
}

export type SignedIn =
  | { readonly signedIn: true; readonly volunteerId: string; readonly headers: Headers }
  | { readonly signedIn: false; readonly because: Refusal }

/**
 * Exchanges a code for a session.
 *
 * The gate is checked again rather than trusted from the code request: a
 * volunteer revoked in the five minutes between the two is a volunteer who
 * must not get a session, and the request that sent the code is long over.
 *
 * The headers come back to the caller rather than being applied here, because
 * a `Set-Cookie` belongs to whatever is answering the browser and this module
 * does not know what that is.
 */
export async function submitCode(
  orgId: OrgId,
  identifier: string,
  code: string,
): Promise<SignedIn> {
  if (looksLikeMobile(identifier)) return submitCodeByMobile(orgId, identifier, code)

  const refused = await gate(orgId, identifier)
  if (refused !== null) {
    log('warn', 'sign_in_refused', { stage: 'submit_code', because: refused })
    return { signedIn: false, because: refused }
  }

  const email = normaliseEmail(identifier)
  let answered
  try {
    answered = await auth().api.signInEmailOTP({
      body: { email, otp: code.trim() },
      returnHeaders: true,
    })
  } catch {
    // Wrong, expired, or spent. Better Auth counts the attempts and
    // invalidates the code after five of them (ADR 0008); this side does not
    // get to distinguish them, and neither should the screen — every
    // distinction it drew would be a hint to somebody guessing.
    log('warn', 'sign_in_refused', { stage: 'submit_code', because: 'wrong-code' })
    return { signedIn: false, because: 'wrong-code' }
  }

  // The gate above already found the Volunteer; it is looked up again rather
  // than threaded through, because between the two a `null` here would mean
  // the record vanished mid-exchange and that is worth failing on.
  const volunteer = await volunteerByEmail(orgId, email)
  if (volunteer === null) {
    throw new Error('The volunteer that passed the sign-in gate is no longer there')
  }

  // The Account, claimed. This is the only place Better Auth's user and the
  // barn's record are ever joined, and it happens after a code has proved the
  // address belongs to whoever typed it.
  await claimAccount(orgId, volunteer.id, answered.response.user.id)

  log('info', 'signed_in', { volunteerId: volunteer.id, orgId })
  return { signedIn: true, volunteerId: volunteer.id, headers: answered.headers }
}

/**
 * Ends this session, and only this one.
 *
 * A volunteer signing out on the barn's shared tablet must not sign out the
 * phone in their pocket, so this is not the revocation path — that is
 * `revokeAccount`, and it is an officer's act.
 */
export async function signOut(request: Request): Promise<Headers> {
  const { headers } = await auth().api.signOut({
    headers: request.headers,
    returnHeaders: true,
  })
  return headers
}

/**
 * A code to a handset, through Verify (#78).
 *
 * The gate is the same three facts about the person `gate` below checks, asked
 * against the number instead of the address — and the same per-address budget,
 * keyed on the normalised number. An E.164 number and an email address cannot
 * collide as keys (one begins with `+`, the other contains `@`), so the two
 * doors share one window without sharing a namespace.
 */
async function requestCodeByMobile(orgId: OrgId, rawMobile: string): Promise<CodeRequested> {
  const refused = await mobileGate(orgId, rawMobile)
  if (refused !== null) {
    log('warn', 'sign_in_refused', { stage: 'request_code', because: refused })
    return { sent: false, because: refused }
  }

  // Non-null: `mobileGate` refused everything this can be null for.
  const mobile = normaliseMobile(rawMobile) ?? ''
  if (askedTooOften(mobile)) {
    log('warn', 'sign_in_refused', { stage: 'request_code', because: 'too-many-codes' })
    return { sent: false, because: 'too-many-codes' }
  }

  try {
    await sendVerification(mobile, 'sign-in')
  } catch {
    // Told plainly, like the email half: *nothing is coming* is a different
    // fact from *the app is broken*, and only one of them means try again.
    log('error', 'sign_in_refused', { stage: 'request_code', because: 'sms-not-sent' })
    return { sent: false, because: 'sms-not-sent' }
  }

  return { sent: true }
}

/**
 * Exchanges a texted code for a session (#78).
 *
 * Verify says whether the handset is theirs. The **session** is then minted the
 * only way this application knows how to mint one — a sign-in OTP against the
 * Volunteer's own address, created and immediately consumed, never sent — so a
 * volunteer signing in by text lands on exactly the same `user` row, the same
 * `claimAccount`, and the same year-long session as one signing in by mail.
 * Reproducing any of that here would be a second identity path to keep in step
 * with the first.
 */
async function submitCodeByMobile(
  orgId: OrgId,
  rawMobile: string,
  code: string,
): Promise<SignedIn> {
  const refused = await mobileGate(orgId, rawMobile)
  if (refused !== null) {
    log('warn', 'sign_in_refused', { stage: 'submit_code', because: refused })
    return { signedIn: false, because: refused }
  }

  const mobile = normaliseMobile(rawMobile) ?? ''
  let approved: boolean
  try {
    approved = await checkVerification(mobile, code, 'sign-in')
  } catch {
    // The vendor being unreachable is not a wrong code, and telling somebody
    // it is sends them to retype digits that were always right.
    log('error', 'sign_in_refused', { stage: 'submit_code', because: 'sms-not-sent' })
    return { signedIn: false, because: 'sms-not-sent' }
  }
  if (!approved) {
    log('warn', 'sign_in_refused', { stage: 'submit_code', because: 'wrong-code' })
    return { signedIn: false, because: 'wrong-code' }
  }

  const volunteer = await volunteerByMobile(orgId, mobile)
  if (volunteer === null) {
    throw new Error('The volunteer that passed the sign-in gate is no longer there')
  }

  const otp = await auth().api.createVerificationOTP({
    body: { email: volunteer.email, type: 'sign-in' },
  })
  const answered = await auth().api.signInEmailOTP({
    body: { email: volunteer.email, otp },
    returnHeaders: true,
  })

  await claimAccount(orgId, volunteer.id, answered.response.user.id)

  log('info', 'signed_in', { volunteerId: volunteer.id, orgId, channel: 'sms' })
  return { signedIn: true, volunteerId: volunteer.id, headers: answered.headers }
}

/** The same three facts as `gate`, asked of a number (#78). */
async function mobileGate(orgId: OrgId, rawMobile: string): Promise<Refusal | null> {
  const volunteer = await volunteerByMobile(orgId, rawMobile)
  if (volunteer === null) {
    return (await hasLeftTheRescueByMobile(orgId, rawMobile))
      ? 'volunteer-removed'
      : 'unrecognised-mobile'
  }
  return (await revoked(orgId, volunteer)) ? 'account-revoked' : null
}

/** The three refusals that are facts about the person, or `null` to proceed. */
async function gate(orgId: OrgId, rawEmail: string): Promise<Refusal | null> {
  const volunteer = await volunteerByEmail(orgId, rawEmail)
  if (volunteer === null) {
    // No live Volunteer. Which of the two reasons it is matters to the person
    // reading it: *check it for a typo* and *you have left the rescue* send
    // somebody to different places.
    return (await hasLeftTheRescue(orgId, rawEmail)) ? 'volunteer-removed' : 'unrecognised-email'
  }
  return (await revoked(orgId, volunteer)) ? 'account-revoked' : null
}

/**
 * Whether an officer has revoked this Volunteer's Account.
 *
 * A revoked link is left in place and marked rather than deleted, so that this
 * question has an answer at all — a delete would let the next code request
 * silently re-claim what somebody decided to take away. A Volunteer with no
 * link has simply never signed in, which is not a revocation.
 */
async function revoked(orgId: OrgId, volunteer: Volunteer): Promise<boolean> {
  const [claimed] = await forOrg(orgId).run((db) =>
    db
      .select({ revokedAt: volunteerAccounts.revokedAt })
      .from(volunteerAccounts)
      .where(eq(volunteerAccounts.volunteerId, volunteer.id))
      .limit(1),
  )
  return claimed !== undefined && claimed.revokedAt !== null
}
