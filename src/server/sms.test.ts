/**
 * The one door out for a text, at the same seam `src/server/email.test.ts`
 * holds — and with the same four claims, because ADR 0028 asks for the shape
 * `src/server/email.ts` already has rather than a new one.
 *
 * **No test here makes a paid call.** The transport is replaced in
 * `beforeEach`, which is the whole point of it being injectable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OrgId } from '../db/for-org'
import { REDACTED } from '../shared/scrub'
import { servingRescues } from '../test/rescue'
import { setRescues } from './rescues'
import {
  DAILY_CAP,
  TextNotSentError,
  forgetTextsForTest,
  sendText,
  smsIsConfigured,
  setSmsTransport,
  wasUnsubscribed,
  type OutgoingText,
} from './sms'

/** Every message a run handed the transport, in order. */
let sent: OutgoingText[]

/**
 * The rescue the one sender is registered for (#113): its `RESCUES` entry says
 * `"sms": true`. Every other rescue is refused, which the last block asserts.
 */
const REGISTERED = '00000000-0000-0000-0000-0000000000bc' as OrgId
const UNREGISTERED = '00000000-0000-0000-0000-0000000000bd' as OrgId

beforeEach(() => {
  servingRescues(
    { 'registered.invalid': REGISTERED, 'unregistered.invalid': UNREGISTERED },
    { 'registered.invalid': { sms: true } },
  )
  sent = []
  forgetTextsForTest()
  setSmsTransport((message) => {
    sent.push(message)
    return Promise.resolve()
  })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  setRescues(null)
  setSmsTransport(null)
  forgetTextsForTest()
  vi.restoreAllMocks()
})

const text = { to: '+14105550134', text: 'Feed PM on Thursday is short.' }

describe('sending', () => {
  it('hands the transport what it was given', async () => {
    await sendText(REGISTERED, text)

    expect(sent).toEqual([text])
  })

  it('writes a line saying it went, and never the number or the words', async () => {
    const lines: Record<string, unknown>[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>)
      return true
    })

    await sendText(REGISTERED, text)

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
    await expect(sendText(REGISTERED, text)).rejects.toBeInstanceOf(TextNotSentError)
    expect(sent).toEqual([])
  })
})

describe('the daily cap', () => {
  it('refuses the hundred-and-twenty-first, loudly and by name', async () => {
    for (let index = 0; index < DAILY_CAP; index += 1) {
      await sendText(REGISTERED, { ...text, to: `+1410555${String(1000 + index)}` })
    }

    // Two full sends to sixty people is the number ADR 0028 argues for: well
    // clear of a normal week, and well under the carrier's own thousand.
    await expect(sendText(REGISTERED, text)).rejects.toThrow(/cap of 120/)
    expect(sent).toHaveLength(DAILY_CAP)
  })

  it('counts the last twenty-four hours, not a calendar day', async () => {
    const origin = performance.timeOrigin
    for (let index = 0; index < DAILY_CAP; index += 1) {
      await sendText(REGISTERED, { ...text, to: `+1410555${String(1000 + index)}` })
    }
    await expect(sendText(REGISTERED, text)).rejects.toBeInstanceOf(TextNotSentError)

    // A calendar day has no meaning without a timezone (ADR 0007); elapsed
    // time has the same answer in every one.
    vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(origin + 25 * 60 * 60 * 1000)

    await expect(sendText(REGISTERED, text)).resolves.toBeUndefined()
    expect(sent).toHaveLength(DAILY_CAP + 1)
  })
})

describe('a transport that fails', () => {
  it('reports the failure rather than swallowing it, and does not spend the cap', async () => {
    setSmsTransport(() => Promise.reject(new Error('Twilio said no')))

    await expect(sendText(REGISTERED, text)).rejects.toBeInstanceOf(TextNotSentError)

    setSmsTransport((message) => {
      sent.push(message)
      return Promise.resolve()
    })
    for (let index = 0; index < DAILY_CAP; index += 1) {
      await sendText(REGISTERED, { ...text, to: `+1410555${String(1000 + index)}` })
    }
    expect(sent).toHaveLength(DAILY_CAP)
  })

  it('tells a STOP apart from anything else going wrong', async () => {
    // The carrier is the system of record for STOP and legally has to be:
    // Twilio blocks the message itself and answers 21610. Recognising it is
    // what lets the fan-out write the fact down, so the next reachable count
    // is right rather than promising somebody who will never receive it.
    setSmsTransport(() => Promise.reject(new Error('Twilio answered 400 (21610): unsubscribed')))
    const stopped = await sendText(REGISTERED, text).catch((cause: unknown) => cause)
    expect(wasUnsubscribed(stopped)).toBe(true)

    setSmsTransport(() => Promise.reject(new Error('Twilio answered 500: something else')))
    const broken = await sendText(REGISTERED, text).catch((cause: unknown) => cause)
    expect(wasUnsubscribed(broken)).toBe(false)
  })
})

describe('a rescue the sender is not registered for (#113)', () => {
  it('sends nothing at all, and says so in the kill switch’s own words', async () => {
    const refused = sendText(UNREGISTERED, text)
    await expect(refused).rejects.toBeInstanceOf(TextNotSentError)
    await expect(refused).rejects.toThrow('no sms transport is configured')
    expect(sent).toEqual([])
  })

  it('is told before a fan-out, the way an unconfigured box is', () => {
    expect(smsIsConfigured(REGISTERED)).toBe(true)
    expect(smsIsConfigured(UNREGISTERED)).toBe(false)
  })

  it('spends none of the registered rescue’s cap', async () => {
    await expect(sendText(UNREGISTERED, text)).rejects.toThrow()
    for (let at = 0; at < DAILY_CAP; at += 1) await sendText(REGISTERED, text)
    expect(sent).toHaveLength(DAILY_CAP)
  })
})
