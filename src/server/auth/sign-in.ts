/**
 * Signing in: a six-digit code to an address the rescue already knows, and a
 * session row that lasts until somebody revokes it (ADR 0008, 0009).
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
import { sendEmail } from '../email'
import {
  claimAccount,
  hasLeftTheRescue,
  normaliseEmail,
  volunteerByEmail,
  type Volunteer,
} from './volunteers'
import { forOrg, type OrgId } from '../../db/for-org'
import { volunteerAccounts } from '../../db/schema'
import { elapsed, now, type Instant } from '../../shared/time'
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
  | 'volunteer-removed'
  | 'account-revoked'
  | 'wrong-code'
  | 'email-not-sent'
  | 'too-many-codes'

/**
 * How often one address may ask for a code, and over what window.
 *
 * ADR 0008 set three sends an hour per identifier, and ADR 0009 discharged the
 * SMS-specific caps around it but not this one — the reason survives the change
 * of channel with its cost inverted. It is no longer that a send spends money;
 * it is that the code endpoint is **unauthenticated and reachable from the
 * login form**, and the only thing above it is `DAILY_CAP` in
 * `src/server/email.ts`. Without a per-address limit, a couple of hundred
 * requests spend the whole rescue's daily budget and sign-in stops working for
 * everybody — a denial of service against the one screen that has to work.
 *
 * In memory, and honestly so: ADR 0007 deploys one container, so one process is
 * the whole of the deployment. A second container is what makes this a table.
 */
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
 * protected is the volunteer's inbox and the rescue's send budget, and both
 * are attached to the address rather than to whoever asked.
 */
function askedTooOften(email: string): boolean {
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
export async function requestCode(orgId: OrgId, rawEmail: string): Promise<CodeRequested> {
  const refused = await gate(orgId, rawEmail)
  if (refused !== null) {
    log('warn', 'sign_in_refused', { stage: 'request_code', because: refused })
    return { sent: false, because: refused }
  }

  const email = normaliseEmail(rawEmail)
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
export async function submitCode(orgId: OrgId, rawEmail: string, code: string): Promise<SignedIn> {
  const refused = await gate(orgId, rawEmail)
  if (refused !== null) {
    log('warn', 'sign_in_refused', { stage: 'submit_code', because: refused })
    return { signedIn: false, because: refused }
  }

  const email = normaliseEmail(rawEmail)
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
