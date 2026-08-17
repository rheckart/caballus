/**
 * Better Auth, self-hosted against the same Postgres as the application, and
 * owning exactly three tables (ADR 0008).
 *
 * Two things it is deliberately not allowed to own. **Membership** — which
 * rescue somebody acts for, and what they may do there — is ours, in
 * `volunteer_accounts` and `volunteer_roles`, where row-level security can
 * reach it: ADR 0008's whole argument is that with no session expiry,
 * revocation is the entire security model, and a membership claim in a
 * long-lived token is exactly the fact that outlives its truth. And **the HTTP
 * surface**: this application does not mount Better Auth's own handler, so
 * `/api/auth/*` does not exist. Every call into it is a named function in
 * `src/server/auth/`, which is what keeps the endpoints this server answers to
 * a list somebody can read.
 *
 * The organization plugin is declined for the reason ADR 0008 gives: being
 * Lead of *this* shift is not a role anybody holds, no RBAC primitive models
 * it, and adopting one for membership while keeping roles in our own tables
 * would recreate the two-sources-of-truth problem inside a single process.
 */
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins'

import { rawDb } from '../../db/client'
import { sessions, users, verifications } from '../../db/schema'
import { sendEmail, type OutgoingEmail } from '../email'

/**
 * The code, and the message it arrives in.
 *
 * Six digits, five minutes, five attempts (ADR 0008, kept by 0009 with the
 * credential changed). A typed code rather than a magic link, because a link
 * tapped inside the Gmail app opens an in-app browser, the session cookie
 * lands there, and the volunteer's real browser is still signed out — they try
 * twice and conclude the app is broken.
 */
export const CODE_LENGTH = 6
export const CODE_EXPIRES_IN_SECONDS = 5 * 60
export const CODE_ALLOWED_ATTEMPTS = 5

/**
 * The message itself, in one place, because two paths send it.
 *
 * The code is in the subject as well as the body: a phone shows the subject on
 * the lock screen, and a volunteer with gloves on should not have to open
 * anything.
 */
export function codeEmail(email: string, otp: string): OutgoingEmail {
  return {
    to: email,
    subject: `${otp} is your Caballus code`,
    text: [
      `${otp} is your code for Caballus.`,
      '',
      'It works for the next five minutes and only once.',
      'If you did not ask to sign in, nothing has happened and you can ignore this.',
    ].join('\n'),
  }
}

/**
 * A year, refreshed on use — which is as close to ADR 0004's *stay signed in*
 * as a browser will allow.
 *
 * **The cap is not ours.** RFC 6265bis limits a cookie's `Max-Age` to 400
 * days, and every browser enforces it, so "permanent" is not a number that can
 * be written here: a session expiring in a hundred years is a cookie the
 * browser refuses outright. ADR 0008 already said the right thing — *a long
 * expiry refreshed on use* — and this is that, with the refresh being the half
 * that does the work.
 *
 * It is not a security control and must never become one. Revocation is the
 * entire model (ADR 0008).
 *
 * **What `updateAge` refreshes today is the row, not the cookie.** Better Auth
 * emits a new `Set-Cookie` when it extends a session, and the only place this
 * application reads a session is `actorFrom`, which resolves an actor for a
 * request whose answer is an `ApiResponse` — a type that deliberately cannot
 * carry a header, because a stored answer has to be rebuildable from a status
 * and a body alone (ADR 0020, #30). So the cookie keeps the lifetime it was
 * given at sign-in and a volunteer signs in again about once a year, however
 * often they use the app. That is the honest position and it is a gap rather
 * than a design: closing it means deciding where a refreshed cookie is applied,
 * which is a question about the response layer and not about this file.
 */
const A_YEAR_IN_SECONDS = 365 * 24 * 60 * 60

/**
 * How stale a session may get before use refreshes it. A day, so that a
 * volunteer who works a shift a week never approaches the year above, and so
 * that the common case — many requests in one morning — writes once.
 */
const REFRESH_AFTER_SECONDS = 24 * 60 * 60

/**
 * Nothing here is a secret that can be missing quietly. A signing secret that
 * defaults would sign every volunteer out the day a real one was set, and ADR
 * 0004 made permanent sessions the point.
 */
function secret(): string {
  const configured = process.env.BETTER_AUTH_SECRET
  if (configured === undefined || configured === '') {
    throw new Error('BETTER_AUTH_SECRET is not set')
  }
  return configured
}

let instance: ReturnType<typeof build> | undefined

function build() {
  return betterAuth({
    secret: secret(),
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    database: drizzleAdapter(rawDb(), {
      provider: 'pg',
      // Named rather than inferred, so that adding a table to `schema.ts` can
      // never quietly hand Better Auth something it was not meant to own.
      schema: { user: users, session: sessions, verification: verifications },
    }),
    session: {
      expiresIn: A_YEAR_IN_SECONDS,
      updateAge: REFRESH_AFTER_SECONDS,
      cookieCache: {
        // **Off, and it stays off.** A cached session in a signed cookie is a
        // staleness window, and a staleness window is the one thing revocation
        // cannot have when it is the only control there is (ADR 0008).
        enabled: false,
      },
    },
    advanced: {
      // httpOnly and SameSite=Lax are Better Auth's defaults; Secure is the
      // one that has to follow the deployment rather than the library, since
      // development is plain http on localhost.
      useSecureCookies: process.env.NODE_ENV === 'production',
    },
    // No email/password and no social provider, so nothing ever writes an
    // `account` row — which is why this application's schema has three of
    // Better Auth's tables rather than four.
    emailAndPassword: { enabled: false },
    plugins: [
      emailOTP({
        otpLength: CODE_LENGTH,
        expiresIn: CODE_EXPIRES_IN_SECONDS,
        allowedAttempts: CODE_ALLOWED_ATTEMPTS,
        // Hashed at rest: the table is in the same database as the care
        // record, and a five-minute credential sitting in plaintext beside it
        // is a needless second thing to lose in one restore.
        storeOTP: 'hashed',
        // Not the path this application signs in through — `requestCode` in
        // `./sign-in.ts` mints the code and sends it itself, because a failure
        // here is swallowed and the volunteer is told a code is coming when
        // none is. It is still the same message, so that any Better Auth path
        // that does reach it sends what a volunteer expects rather than
        // nothing.
        async sendVerificationOTP({ email, otp }) {
          await sendEmail(codeEmail(email, otp))
        },
      }),
    ],
  })
}

/**
 * The instance, built on first use.
 *
 * Lazily, because building it reads `BETTER_AUTH_SECRET` and opens the
 * database — and a module that did that at import time would make every test
 * of every unrelated module need both.
 */
export function auth(): ReturnType<typeof build> {
  instance ??= build()
  return instance
}
