/**
 * Twilio Verify: the code that proves a handset (#78, ADR 0029).
 *
 * **This is not `src/server/sms.ts` and must never become it.** ADR 0029's
 * whole argument is that Verify sits *outside* A2P brand and campaign
 * registration — no three-week carrier queue in front of anybody being able to
 * use the app, which is the mistake ADR 0008 made and ADR 0009 undid. Two
 * consequences fall out of that separation and both are load-bearing:
 *
 * - **A STOP on the notification campaign cannot touch login.** ADR 0008 paid
 *   $10 a month for a second sender to guarantee that; here it is structural
 *   and free.
 * - **The Urgent Send's daily cap and kill switch cannot lock the roster out.**
 *   `sendText` refusing is a Shift nobody was told about; a sign-in refusing is
 *   nobody being able to work at all, and the two must not share a fuse.
 *
 * **Verify owns the code and its lifetime.** Caballus mints nothing here and
 * stores nothing — which is the difference from `src/server/auth/email-change.ts`,
 * where the verification row *is* the pending state because we own it. The
 * phone-number plugin is not reintroduced either: ADR 0008 accepted visible
 * roughness in it and ADR 0009 was glad to be rid of it.
 *
 * **Two Services, and that is the `change-email-otp-` rule in Verify's own
 * vocabulary.** ADR 0027 made a change-flow code structurally unreachable from
 * the login screen by minting it under a different identifier; Verify has no
 * identifier for us to choose, so the separation is the Service. A code issued
 * against the change Service cannot be checked against the sign-in one, at the
 * vendor, whatever this application later gets wrong about which number
 * belongs to whom.
 *
 * `fetch` rather than the SDK, for `src/server/sms.ts`'s own reason: two
 * form-encoded POSTs with basic auth.
 */
import { log } from '../observability'

/**
 * Which door a code was issued for. Two Services, one per purpose, and a third
 * would be a third Service rather than a flag — that is the point of it.
 */
export const VERIFY_PURPOSES = ['sign-in', 'change-mobile'] as const

export type VerifyPurpose = (typeof VERIFY_PURPOSES)[number]

/**
 * Where a verification actually goes. Injectable so that **no test makes a
 * paid call** — the same seam `setEmailTransport` and `setSmsTransport` are.
 */
export interface Verifier {
  /** Sends a code to `to`, or throws. */
  readonly start: (to: string, purpose: VerifyPurpose) => Promise<void>
  /** Whether `code` is the one that went to `to` for this purpose. */
  readonly check: (to: string, code: string, purpose: VerifyPurpose) => Promise<boolean>
}

/**
 * Nothing was sent. Distinguished from a wrong code, because the two send a
 * volunteer to different places: *nothing is coming* against *try again*.
 */
export class VerificationNotSentError extends Error {
  constructor(readonly because: string) {
    super(`No code was sent: ${because}`)
    this.name = 'VerificationNotSentError'
  }
}

let verifier: Verifier | null | undefined

/** Overrides the verifier, or turns it off entirely with `null`. */
export function setVerifier(replacement: Verifier | null): void {
  verifier = replacement
}

/** Sends a code to a handset, or says why it did not. */
export async function sendVerification(to: string, purpose: VerifyPurpose): Promise<void> {
  const service = verifier === undefined ? twilioVerify() : verifier
  if (service === null) {
    throw new VerificationNotSentError('no verification service is configured')
  }
  try {
    await service.start(to, purpose)
  } catch (cause) {
    throw new VerificationNotSentError(cause instanceof Error ? cause.message : String(cause))
  }
  // The number and the purpose, never the code — which this side never sees
  // anyway, and that is the property Verify is here for.
  log('info', 'verification_sent', { to, purpose })
}

/**
 * Whether the code is right.
 *
 * `false` for wrong, expired, spent and *never issued* alike. This side does
 * not get to distinguish them and neither should the screen: every distinction
 * it drew would be a hint to somebody guessing — the same call `submitCode`
 * already makes about Better Auth's own attempts counter.
 *
 * An unreachable service **throws** rather than answering `false`, because
 * *the vendor is down* and *that is not your code* are different facts and
 * telling somebody the second when it is the first sends them to retype a code
 * that was always right.
 */
export async function checkVerification(
  to: string,
  code: string,
  purpose: VerifyPurpose,
): Promise<boolean> {
  const service = verifier === undefined ? twilioVerify() : verifier
  if (service === null) {
    throw new VerificationNotSentError('no verification service is configured')
  }
  return service.check(to, code.trim(), purpose)
}

let twilioVerifier: Verifier | null | undefined

/**
 * The real one, built on first use. Absent the account, the token or **either**
 * Service there is no verifier at all — the right default for a development
 * box, and a sign-in that fails loudly rather than appearing to work.
 *
 * Both Services are required together on purpose: falling back to one for both
 * purposes would be the quietly-wrong state the two exist to prevent, and it
 * would fail on the day somebody changed their number rather than at boot.
 */
function twilioVerify(): Verifier | null {
  if (twilioVerifier === undefined) {
    const account = process.env.TWILIO_ACCOUNT_SID ?? ''
    const token = process.env.TWILIO_AUTH_TOKEN ?? ''
    const services: Record<VerifyPurpose, string> = {
      'sign-in': process.env.TWILIO_VERIFY_SERVICE_SID ?? '',
      'change-mobile': process.env.TWILIO_VERIFY_CHANGE_SERVICE_SID ?? '',
    }
    const missing =
      account === '' || token === '' || VERIFY_PURPOSES.some((purpose) => services[purpose] === '')
    twilioVerifier = missing ? null : verifyApi(account, token, services)
  }
  return twilioVerifier
}

function verifyApi(
  account: string,
  token: string,
  services: Record<VerifyPurpose, string>,
): Verifier {
  const authorization = `Basic ${Buffer.from(`${account}:${token}`).toString('base64')}`

  async function call(
    purpose: VerifyPurpose,
    endpoint: 'Verifications' | 'VerificationCheck',
    body: Record<string, string>,
  ): Promise<{ ok: boolean; status: string }> {
    const service = services[purpose]
    const response = await fetch(
      `https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/${endpoint}`,
      {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
      },
    )
    const answered: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      // A check against a verification that has expired or was never issued
      // answers 404, and that is a wrong code rather than a broken vendor.
      if (endpoint === 'VerificationCheck' && response.status === 404) {
        return { ok: false, status: 'not_found' }
      }
      const said = (answered as { message?: unknown } | undefined)?.message
      throw new Error(
        `Twilio Verify answered ${String(response.status)}: ${
          typeof said === 'string' ? said : 'no reason given'
        }`,
      )
    }
    const status = (answered as { status?: unknown } | undefined)?.status
    return { ok: true, status: typeof status === 'string' ? status : '' }
  }

  return {
    async start(to, purpose) {
      await call(purpose, 'Verifications', { To: to, Channel: 'sms' })
    },
    async check(to, code, purpose) {
      const answered = await call(purpose, 'VerificationCheck', { To: to, Code: code })
      return answered.ok && answered.status === 'approved'
    },
  }
}
