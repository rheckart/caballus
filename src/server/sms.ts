/**
 * The one door out for anything this application texts a person (ADR 0028).
 *
 * It is the shape `src/server/email.ts` already holds, and deliberately so: an
 * injectable transport, a kill switch when configuration is missing, a refusal
 * rather than a silent drop, and a daily cap. A second sender would be a second
 * place to put all four, and the second one is reliably the one nobody audits.
 *
 * **What goes through here is an Urgent Send and nothing else** — a Shift
 * declared Short, and an Announcement whose news will not keep. ADR 0028 is
 * emphatic that the list is closed: the evening digest, Escalations, Drops and
 * sign-in codes all stay on email, on ADR 0004's own rule that a fact never
 * travels by both channels. A channel that carries everything means nothing,
 * which is exactly how the Facebook group failed.
 *
 * **A sign-in code does not come through here.** ADR 0029 puts login on Twilio
 * **Verify**, which is a separate service from the messaging campaign by
 * construction — so a volunteer who replied STOP to a staffing text can still
 * sign in, and this module's kill switch and cap cannot lock the roster out of
 * the application. `src/server/auth/verify.ts` is that path.
 *
 * **The one message here that is not an Urgent Send is the notice to a number
 * somebody has just moved off** (#78). It is addressed to one person about
 * their own credential rather than broadcast to the roster, and the person who
 * can no longer sign in at that handset is the one who most needs telling —
 * so it goes, and it is written down here rather than left to be discovered.
 *
 * **Twilio, and the reason is not price** (ADR 0028): sent.dm is cheaper on the
 * platform fee and loses on being a second vendor, since Verify is Twilio's.
 * The vendor is behind this module either way, so being wrong about it costs a
 * day rather than a redesign.
 */
import { elapsed, now, type Instant } from '../shared/time'
import { log } from './observability'

export interface OutgoingText {
  /** E.164, as `src/shared/mobile.ts` normalises it. */
  readonly to: string
  readonly text: string
}

/**
 * Where a message actually goes. Injectable so that no test makes a paid call,
 * and so an Urgent Send's own tests can read what was sent the way a volunteer
 * reads it off a handset — the same seam `setEmailTransport` already is.
 */
export type SmsTransport = (message: OutgoingText) => Promise<void>

/**
 * The cap ADR 0028 sets, and the number is argued rather than round: **two full
 * sends to sixty people**. That is well clear of a normal week — the Urgent
 * Send is two cases and a deliberate second act on each — and well under the
 * carrier's own thousand a day for a Sole Proprietor brand.
 *
 * Tripping it means something is wrong, which is the property a cap is for. A
 * swallowed failure here is a Shift nobody knew was short.
 */
export const DAILY_CAP = 120

const WINDOW_MILLIS = 24 * 60 * 60 * 1000

/**
 * Nothing was sent, and the caller has to answer for it.
 *
 * A send that quietly does nothing is worse here than anywhere else in the
 * application: whoever pressed the button believes sixty people were told, and
 * that belief is the exact failure ADR 0028 exists to fix.
 */
export class TextNotSentError extends Error {
  constructor(readonly because: string) {
    super(`Nothing was sent: ${because}`)
    this.name = 'TextNotSentError'
  }
}

let transport: SmsTransport | null | undefined
let sentAt: Instant[] = []

/**
 * Overrides the transport, or turns sending off entirely with `null`.
 *
 * `null` is the kill switch, reachable from configuration through the Twilio
 * variables being unset and from a running process through this. `undefined` —
 * the initial state — means fall back to the real one.
 */
export function setSmsTransport(replacement: SmsTransport | null): void {
  transport = replacement
}

/** Empties the cap's window. For tests, which each start from nothing sent. */
export function forgetTextsForTest(): void {
  sentAt = []
}

/**
 * Whether there is a transport at all.
 *
 * Asked **before** a fan-out rather than discovered sixty times inside one.
 * ADR 0028 wants a failed send to be loud, and *nothing was configured* is a
 * fact about the deployment that a sender should be told once and plainly —
 * not sixty warn lines and a `sent: 0` that reads like everybody has left the
 * rescue.
 */
export function smsIsConfigured(): boolean {
  return (transport === undefined ? twilio() : transport) !== null
}

export async function sendText(message: OutgoingText): Promise<void> {
  const sender = transport === undefined ? twilio() : transport
  if (sender === null) {
    throw new TextNotSentError('no sms transport is configured')
  }

  const at = now()
  // A rolling twenty-four hours rather than a calendar day: a day has no
  // meaning without a timezone (ADR 0007) and elapsed time has the same answer
  // in all of them.
  sentAt = sentAt.filter((earlier) => elapsed(earlier, at) < WINDOW_MILLIS)
  if (sentAt.length >= DAILY_CAP) {
    throw new TextNotSentError(`the cap of ${String(DAILY_CAP)} in twenty-four hours is spent`)
  }

  // Claimed before the send, not after it: a fan-out to sixty people is sixty
  // concurrent calls, and every one of them would otherwise measure the same
  // pre-send count and pass a cap that is already spent.
  sentAt.push(at)
  try {
    await sender(message)
  } catch (cause) {
    // Given back on failure: a send that never left must not spend the cap, or
    // one broken afternoon leaves a genuinely short Shift unsendable.
    const spent = sentAt.indexOf(at)
    if (spent !== -1) sentAt.splice(spent, 1)
    throw new TextNotSentError(cause instanceof Error ? cause.message : String(cause))
  }

  // The number, and never the body. `log` redacts the number on the way out
  // (ADR 0007), so what survives is the count — *how much did this process
  // send* — which is the cap's question and the kill switch's.
  log('info', 'sms_sent', { to: message.to })
}

/**
 * How Twilio says a number has opted out.
 *
 * The carrier is the system of record for STOP and legally has to be: Twilio
 * blocks the message itself and answers this. Recognising it here is what lets
 * `recordStop` above the fan-out write the fact down, so the next reachable
 * count is right rather than promising somebody who will never receive it.
 */
export const UNSUBSCRIBED = 21610

/** Whether this failure was a STOP rather than anything else going wrong. */
export function wasUnsubscribed(cause: unknown): boolean {
  return cause instanceof TextNotSentError && cause.because.includes(String(UNSUBSCRIBED))
}

let twilioTransport: SmsTransport | null | undefined

/**
 * The real one, built on first use.
 *
 * Absent the three variables there is no transport at all, which is the right
 * default for a development box: nothing leaves the machine and nobody is
 * billed, and a send fails loudly instead of appearing to work. Twilio's own
 * test credentials and magic numbers are the documented development path (ADR
 * 0028) and need no special case here — they are these three variables with
 * different values.
 *
 * `fetch` rather than the Twilio SDK: this is one form-encoded POST with basic
 * auth, and a dependency for it would be a second thing to keep current for no
 * behaviour we do not already have. `src/server/weather/providers.ts` holds the
 * same line about a forecast URL.
 */
function twilio(): SmsTransport | null {
  if (twilioTransport === undefined) {
    const account = process.env.TWILIO_ACCOUNT_SID ?? ''
    const token = process.env.TWILIO_AUTH_TOKEN ?? ''
    const from = process.env.TWILIO_FROM_NUMBER ?? ''
    twilioTransport =
      account === '' || token === '' || from === '' ? null : messagesApi(account, token, from)
  }
  return twilioTransport
}

function messagesApi(account: string, token: string, from: string): SmsTransport {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account)}/Messages.json`
  const authorization = `Basic ${Buffer.from(`${account}:${token}`).toString('base64')}`

  return async (message) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: message.to, From: from, Body: message.text }),
    })
    if (response.ok) return

    // Twilio's own error code, carried into the message rather than parsed into
    // a type: `wasUnsubscribed` is the one code anything reads, and a second
    // reader would be the point to give this a shape.
    const body: unknown = await response.json().catch(() => undefined)
    const code = (body as { code?: unknown } | undefined)?.code
    const said = (body as { message?: unknown } | undefined)?.message
    throw new Error(
      `Twilio answered ${String(response.status)}${
        typeof code === 'number' ? ` (${String(code)})` : ''
      }: ${typeof said === 'string' ? said : 'no reason given'}`,
    )
  }
}
