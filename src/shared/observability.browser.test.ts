import { afterEach, describe, expect, it, vi } from 'vitest'

import { REDACTED } from './scrub'

/**
 * The twin of `src/server/observability.test.ts`, and one thing more: the
 * server's test exercises `beforeSend` directly, which proves the scrubbing
 * and not the wiring. On the phone the wiring is the whole ticket, so this
 * reads the function back off the object Sentry was handed.
 */
interface TestEvent {
  message?: string
  user?: { id?: string; username?: string; ip_address?: string }
  extra?: Record<string, unknown>
}

interface InitOptions {
  dsn?: string
  environment?: string
  sendDefaultPii?: boolean
  beforeSend?: (event: TestEvent) => TestEvent
}

const sentry = vi.hoisted(() => ({
  init: vi.fn<(options: InitOptions) => void>(),
  captureException: vi.fn<(error: unknown, hint?: { extra?: Record<string, unknown> }) => void>(),
}))

vi.mock('@sentry/browser', () => sentry)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  sentry.init.mockClear()
  sentry.captureException.mockClear()
})

/** A fresh copy, because whether reporting has started is module state. */
async function load() {
  vi.resetModules()
  return import('./observability.browser')
}

/** The options Sentry was initialised with, or undefined if it never was. */
function initOptions(): InitOptions | undefined {
  return sentry.init.mock.calls[0]?.[0]
}

describe('startObservability', () => {
  it('sends nothing from a phone when no DSN is configured', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', undefined)
    const { report, startObservability } = await load()

    startObservability()
    report(new Error('the day request failed'))

    // Not "no DSN, so the upload fails" — no SDK, so there is no upload to
    // retry over a volunteer's data plan.
    expect(sentry.init).not.toHaveBeenCalled()
    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it('is equally silent when the variable is present and empty, which is how .env.example ships', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const { startObservability } = await load()

    startObservability()

    expect(sentry.init).not.toHaveBeenCalled()
  })

  it('starts from VITE_SENTRY_DSN, without volunteer data attached by default', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@sentry.example/42')
    const { startObservability } = await load()

    startObservability()

    expect(sentry.init).toHaveBeenCalledTimes(1)
    expect(initOptions()?.dsn).toBe('https://key@sentry.example/42')
    expect(initOptions()?.sendDefaultPii).toBe(false)
  })

  it('starts once, however many entries call it', async () => {
    const { startObservability } = await load()

    startObservability({ dsn: 'https://key@sentry.example/42' })
    startObservability({ dsn: 'https://key@sentry.example/42' })

    expect(sentry.init).toHaveBeenCalledTimes(1)
  })

  it('hands Sentry the scrubbing beforeSend, not merely a beforeSend', async () => {
    const { startObservability } = await load()
    startObservability({ dsn: 'https://key@sentry.example/42' })

    const beforeSend = initOptions()?.beforeSend
    expect(beforeSend).toBeTypeOf('function')

    const sent = beforeSend?.({
      message: 'texting the shift lead on (410) 555-0134 failed',
      user: { id: 'v_01J8', username: 'Cathy Hollandsworth', ip_address: '10.0.0.4' },
      extra: { volunteerName: 'Cathy Hollandsworth', mobile: '(410) 555-0134', shiftId: 'sh_01J8' },
    })

    const wire = JSON.stringify(sent)
    expect(wire).not.toContain('Cathy')
    expect(wire).not.toContain('555-0134')
    expect(wire).not.toContain('10.0.0.4')
    expect(sent?.user).toEqual({ id: 'v_01J8' })
    expect(sent?.extra).toEqual({ volunteerName: REDACTED, mobile: REDACTED, shiftId: 'sh_01J8' })
    expect(sent?.message).toBe(`texting the shift lead on ${REDACTED} failed`)
  })
})

describe('report', () => {
  it('scrubs the fields a caller attaches, not just the event Sentry builds', async () => {
    const { report, startObservability } = await load()
    startObservability({ dsn: 'https://key@sentry.example/42' })

    report(new Error('could not save the tick'), {
      volunteerName: 'Cathy Hollandsworth',
      shiftId: 'sh_01J8',
    })

    expect(sentry.captureException).toHaveBeenCalledTimes(1)
    expect(sentry.captureException.mock.calls[0]?.[1]?.extra).toEqual({
      volunteerName: REDACTED,
      shiftId: 'sh_01J8',
    })
  })
})
