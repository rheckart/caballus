/**
 * The one door out for anything this application sends a person.
 *
 * ADR 0009 makes email the only channel Caballus v1 has — no SMS, for login or
 * for anything else — so this module carries the sign-in code today and the
 * staffing digest and Escalation notifications when they land. It exists as a
 * module rather than as ten lines behind Better Auth's send function precisely
 * because those are coming: a second sender would be a second place to put the
 * cap, the kill switch and the log line, and the second one is reliably the
 * one nobody audits.
 *
 * **Fastmail SMTP on `heckart.me` for the POC** (ADR 0009), with an app
 * password injected at deploy per ADR 0006. What it is not is
 * transactional-grade — no delivery webhooks, no bounce handling, application
 * mail sharing reputation with the maintainer's personal mail — and the exit
 * at go-live is Resend on a subdomain the rescue owns. That change lands here
 * and nowhere else.
 */
import { createTransport, type Transporter } from 'nodemailer'

import { elapsed, now, type Instant } from '../shared/time'
import { log } from './observability'

export interface OutgoingEmail {
  readonly to: string
  readonly subject: string
  readonly text: string
}

/**
 * Where a message actually goes. Injectable so a test can watch what was sent
 * without an SMTP server, and so the sign-in tests can read the code out of
 * the message the way a volunteer reads it out of their inbox.
 */
export type EmailTransport = (message: OutgoingEmail) => Promise<void>

/**
 * The cap ADR 0004 puts on outbound messaging, kept by ADR 0009 for the
 * cheaper of the two reasons: a bug that mails sixty volunteers repeatedly is
 * its own kind of damage.
 *
 * Set well clear of onboarding sixty volunteers in a week, so that tripping it
 * means something is wrong rather than that somebody was busy.
 */
export const DAILY_CAP = 200

const WINDOW_MILLIS = 24 * 60 * 60 * 1000

/**
 * Nothing was sent, and the caller has to answer for it — because with email
 * as the only channel, a swallowed failure is a volunteer standing in a barn
 * waiting for a code that was never going to arrive.
 */
export class EmailNotSentError extends Error {
  constructor(readonly because: string) {
    super(`Nothing was sent: ${because}`)
    this.name = 'EmailNotSentError'
  }
}

let transport: EmailTransport | null | undefined
let sentAt: Instant[] = []

/**
 * Overrides the transport, or turns sending off entirely with `null`.
 *
 * `null` is the kill switch ADR 0004 requires, reachable from configuration
 * through `SMTP_URL` being unset and from a running process through this. It
 * refuses rather than silently dropping: with email carrying login, a send
 * that quietly does nothing is the failure that looks like the app being
 * broken.
 */
export function setEmailTransport(replacement: EmailTransport | null): void {
  transport = replacement
}

/** Empties the cap's window. For tests, which each start from nothing sent. */
export function forgetSendsForTest(): void {
  sentAt = []
}

export async function sendEmail(message: OutgoingEmail): Promise<void> {
  const sender = transport === undefined ? smtp() : transport
  if (sender === null) {
    throw new EmailNotSentError('no mail transport is configured')
  }

  const at = now()
  // A rolling twenty-four hours rather than a calendar day: a day has no
  // meaning without a timezone (ADR 0007) and elapsed time has the same answer
  // in all of them.
  sentAt = sentAt.filter((earlier) => elapsed(earlier, at) < WINDOW_MILLIS)
  if (sentAt.length >= DAILY_CAP) {
    throw new EmailNotSentError(`the cap of ${String(DAILY_CAP)} in twenty-four hours is spent`)
  }

  // Claimed before the send, not after it. Several volunteers asking for codes
  // at shift change — or the digest fan-out this module exists to carry — are
  // concurrent calls, and every one of them would otherwise measure the same
  // pre-send count and pass a cap that is already spent.
  sentAt.push(at)
  try {
    await sender(message)
  } catch (cause) {
    // Given back on failure: a send that never left must not spend the cap, or
    // one broken afternoon locks the roster out for the rest of the window.
    const spent = sentAt.indexOf(at)
    if (spent !== -1) sentAt.splice(spent, 1)
    throw new EmailNotSentError(cause instanceof Error ? cause.message : String(cause))
  }

  // The subject and the address, and never the body. A six-digit code on
  // stdout is a credential sitting in a log read over SSH (ADR 0006), and the
  // question this line exists to answer is "did we mail Grace at all".
  log('info', 'email_sent', { to: message.to, subject: message.subject })
}

let smtpTransport: Transporter | null | undefined

/**
 * The real one, connected on first use. Absent `SMTP_URL` there is no
 * transport at all, which is the right default for a development box: nothing
 * leaves the machine, and a sign-in fails loudly instead of appearing to work.
 */
function smtp(): EmailTransport | null {
  if (smtpTransport === undefined) {
    const url = process.env.SMTP_URL
    smtpTransport = url === undefined || url === '' ? null : createTransport(url)
  }
  const connected = smtpTransport
  if (connected === null) return null

  const from = process.env.EMAIL_FROM ?? ''
  return async (message) => {
    await connected.sendMail({ from, ...message })
  }
}
