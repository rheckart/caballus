/**
 * The browser twin of `src/server/observability.ts`, and the only other module
 * allowed to import Sentry (ADR 0016). It scrubs with the same function, for
 * the same reason: a phone number in a third-party payload is the leak ADR
 * 0004 makes load-bearing.
 */
import * as Sentry from '@sentry/browser'

import { scrub } from './scrub'

/** Strips personal data from an event on its way out. */
export function beforeSend<T>(event: T): T {
  return scrub(event)
}

let started = false

/**
 * Starts browser error reporting. No DSN means no reporting: a volunteer's
 * phone should not be retrying an upload to a host nobody configured.
 */
export function startObservability(options: { dsn?: string; environment?: string } = {}): void {
  const dsn = options.dsn ?? import.meta.env.VITE_SENTRY_DSN
  if (started || dsn === undefined || dsn === '') return

  Sentry.init({
    dsn,
    environment: options.environment ?? import.meta.env.MODE,
    sendDefaultPii: false,
    beforeSend: (event) => beforeSend(event),
  })
  started = true
}

/** Reports an exception from the work surface, scrubbed. */
export function report(error: unknown, fields: Record<string, unknown> = {}): void {
  if (!started) return
  Sentry.captureException(error, { extra: scrub(fields) })
}
