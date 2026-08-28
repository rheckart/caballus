/**
 * The one door out for a text, at the same seam `src/server/email.test.ts`
 * holds — and with the same four claims, because ADR 0028 asks for the shape
 * `src/server/email.ts` already has rather than a new one.
 *
 * **No test here makes a paid call.** The transport is replaced in
 * `beforeEach`, which is the whole point of it being injectable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { REDACTED } from '../shared/scrub'
import {
  DAILY_CAP,
  TextNotSentError,
  forgetTextsForTest,
  sendText,
  setSmsTransport,
  wasUnsubscribed,
  type OutgoingText,
} from './sms'

/** Every message a run handed the transport, in order. */
let sent: OutgoingText[]

beforeEach(() => {
  sent = []
  forgetTextsForTest()
  setSmsTransport((message) => {
    sent.push(message)
    return Promise.resolve()
  })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  setSmsTransport(null)
  forgetTextsForTest()
  vi.restoreAllMocks()
})

const text = { to: '+14105550134', text: 'Feed PM on Thursday is short.' }

describe('sending', () => {
  it('hands the transport what it was given', async () => {
    await sendText(text)

    expect(sent).toEqual([text])
  })

  it('writes a line saying it went, and never the number or the words', async () => {
    const lines: Record<string, unknown>[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>)
      return true
    })

    await sendText(text)

    // The number is personal and `log` redacts it on the way out (ADR 0007);
    // the body is simply never passed. What the line is worth is the count —
    // *how much did this process send* — which is the cap's question.
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ event: 'sms_sent', to: REDACTED })
    expect(JSON.stringify(lines[0])).not.toContain('4105550134')
    expect(JSON.stringify(lines[0])).not.toContain('short')
  })
})

describe('the kill switch', () => {
  it('refuses rather than pretending, because somebody believes people were told', async () => {
    setSmsTransport(null)

    // With no configuration, every send refuses and nothing is silently
    // dropped (#77). A send that quietly does nothing leaves whoever pressed
    // the button believing sixty people know the Shift is short.
    await expect(sendText(text)).rejects.toBeInstanceOf(TextNotSentError)
    expect(sent).toEqual([])
  })
})

describe('the daily cap', () => {
  it('refuses the hundred-and-twenty-first, loudly and by name', async () => {
    for (let index = 0; index < DAILY_CAP; index += 1) {
      await sendText({ ...text, to: `+1410555${String(1000 + index)}` })
    }

    // Two full sends to sixty people is the number ADR 0028 argues for: well
    // clear of a normal week, and well under the carrier's own thousand.
    await expect(sendText(text)).rejects.toThrow(/cap of 120/)
    expect(sent).toHaveLength(DAILY_CAP)
  })

  it('counts the last twenty-four hours, not a calendar day', async () => {
    const origin = performance.timeOrigin
    for (let index = 0; index < DAILY_CAP; index += 1) {
      await sendText({ ...text, to: `+1410555${String(1000 + index)}` })
    }
    await expect(sendText(text)).rejects.toBeInstanceOf(TextNotSentError)

    // A calendar day has no meaning without a timezone (ADR 0007); elapsed
    // time has the same answer in every one.
    vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(origin + 25 * 60 * 60 * 1000)

    await expect(sendText(text)).resolves.toBeUndefined()
    expect(sent).toHaveLength(DAILY_CAP + 1)
  })
})

describe('a transport that fails', () => {
  it('reports the failure rather than swallowing it, and does not spend the cap', async () => {
    setSmsTransport(() => Promise.reject(new Error('Twilio said no')))

    await expect(sendText(text)).rejects.toBeInstanceOf(TextNotSentError)

    setSmsTransport((message) => {
      sent.push(message)
      return Promise.resolve()
    })
    for (let index = 0; index < DAILY_CAP; index += 1) {
      await sendText({ ...text, to: `+1410555${String(1000 + index)}` })
    }
    expect(sent).toHaveLength(DAILY_CAP)
  })

  it('tells a STOP apart from anything else going wrong', async () => {
    // The carrier is the system of record for STOP and legally has to be:
    // Twilio blocks the message itself and answers 21610. Recognising it is
    // what lets the fan-out write the fact down, so the next reachable count
    // is right rather than promising somebody who will never receive it.
    setSmsTransport(() => Promise.reject(new Error('Twilio answered 400 (21610): unsubscribed')))
    const stopped = await sendText(text).catch((cause: unknown) => cause)
    expect(wasUnsubscribed(stopped)).toBe(true)

    setSmsTransport(() => Promise.reject(new Error('Twilio answered 500: something else')))
    const broken = await sendText(text).catch((cause: unknown) => cause)
    expect(wasUnsubscribed(broken)).toBe(false)
  })
})
