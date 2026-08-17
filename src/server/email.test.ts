import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { REDACTED } from '../shared/scrub'
import {
  DAILY_CAP,
  EmailNotSentError,
  forgetSendsForTest,
  sendEmail,
  setEmailTransport,
  type OutgoingEmail,
} from './email'

/** Every message a run handed the transport, in order. */
let sent: OutgoingEmail[]

beforeEach(() => {
  sent = []
  forgetSendsForTest()
  setEmailTransport((message) => {
    sent.push(message)
    return Promise.resolve()
  })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  setEmailTransport(null)
  forgetSendsForTest()
  vi.restoreAllMocks()
})

const letter = { to: 'grace@example.invalid', subject: 'Your code', text: '481920' }

describe('sending', () => {
  it('hands the transport what it was given', async () => {
    await sendEmail(letter)

    expect(sent).toEqual([letter])
  })

  it('writes a line saying it went, and never what was in it', async () => {
    const lines: Record<string, unknown>[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>)
      return true
    })

    await sendEmail(letter)

    // Two things must not reach stdout, and they fail differently. The code is
    // a credential and this module simply never passes the body; the address
    // is personal and `log` redacts it on the way out (ADR 0007), which is why
    // handing it over is safe rather than careless. What the line is worth is
    // the count and the subject: *how much did this process send, and of
    // what*, which is the cap's question and the kill switch's.
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ event: 'email_sent', to: REDACTED, subject: letter.subject })
    expect(JSON.stringify(lines[0])).not.toContain('481920')
    expect(JSON.stringify(lines[0])).not.toContain('grace')
  })
})

describe('the kill switch', () => {
  it('refuses rather than pretending, because a login depends on it', async () => {
    setEmailTransport(null)

    // ADR 0004 gives outbound messaging a server-side kill switch, and ADR
    // 0009 makes email the only channel there is. A send that silently does
    // nothing is a volunteer standing in a barn waiting for a code — so it is
    // a refusal the caller has to answer for.
    await expect(sendEmail(letter)).rejects.toBeInstanceOf(EmailNotSentError)
    expect(sent).toEqual([])
  })
})

describe('the daily cap', () => {
  it('stops after the cap and says why', async () => {
    for (let index = 0; index < DAILY_CAP; index += 1) {
      await sendEmail({ ...letter, to: `v${String(index)}@example.invalid` })
    }

    // Not a security control: a bug that mails sixty volunteers repeatedly is
    // its own kind of damage (ADR 0009), and the cap is what turns it into one
    // loud failure instead of sixty quiet ones.
    await expect(sendEmail(letter)).rejects.toBeInstanceOf(EmailNotSentError)
    expect(sent).toHaveLength(DAILY_CAP)
  })

  it('counts the last twenty-four hours, not a calendar day', async () => {
    const origin = performance.timeOrigin
    for (let index = 0; index < DAILY_CAP; index += 1) {
      await sendEmail({ ...letter, to: `v${String(index)}@example.invalid` })
    }
    await expect(sendEmail(letter)).rejects.toBeInstanceOf(EmailNotSentError)

    // A rolling window, deliberately: a calendar day has no meaning without a
    // timezone (ADR 0007), and elapsed time has the same answer in every one.
    vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(origin + 25 * 60 * 60 * 1000)

    await expect(sendEmail(letter)).resolves.toBeUndefined()
    expect(sent).toHaveLength(DAILY_CAP + 1)
  })
})

describe('a transport that fails', () => {
  it('reports the failure rather than swallowing it, and does not spend the cap', async () => {
    setEmailTransport(() => Promise.reject(new Error('Fastmail said no')))

    await expect(sendEmail(letter)).rejects.toBeInstanceOf(EmailNotSentError)

    // A send that never left must not count against the cap, or one broken
    // afternoon locks the roster out for the rest of the window.
    setEmailTransport((message) => {
      sent.push(message)
      return Promise.resolve()
    })
    for (let index = 0; index < DAILY_CAP; index += 1) {
      await sendEmail({ ...letter, to: `v${String(index)}@example.invalid` })
    }
    expect(sent).toHaveLength(DAILY_CAP)
  })
})
