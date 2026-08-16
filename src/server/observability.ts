/**
 * The server's one door to Sentry, and the only server module allowed to
 * import it (ADR 0016). Everything else calls `report`.
 *
 * ADR 0007: what you look at when a volunteer says "it didn't save" is not an
 * error log — the likeliest truth is a write sitting in IndexedDB in somebody's
 * pocket. So structured JSON on stdout is the primary instrument here, and
 * Sentry catches the exceptions that did reach a machine.
 */
import * as Sentry from '@sentry/node'

import { scrub } from '../shared/scrub'

export interface LogFields {
  readonly [field: string]: string | number | boolean | null | undefined
}

/**
 * Strips personal data from an event on its way out. Exported so the test can
 * exercise the thing Sentry will actually call.
 */
export function beforeSend<T>(event: T): T {
  return scrub(event)
}

let started = false

/**
 * Starts error reporting if a DSN is configured. Without one — local
 * development, and the POC on the VPS until a DSN exists — reports fall back
 * to stdout, which is the log ADR 0007 says gets read anyway.
 */
export function startObservability(options: { dsn?: string; environment?: string } = {}): void {
  const dsn = options.dsn ?? process.env.SENTRY_DSN
  if (started || dsn === undefined || dsn === '') return

  Sentry.init({
    dsn,
    environment: options.environment ?? process.env.NODE_ENV ?? 'development',
    sendDefaultPii: false,
    beforeSend: (event) => beforeSend(event),
  })
  started = true
}

/** Reports an exception, scrubbed, and always leaves a line on stdout. */
export function report(error: unknown, fields: LogFields = {}): void {
  log('error', message(error), fields)
  if (started) {
    Sentry.captureException(error, { extra: scrub({ ...fields }) })
  }
}

/**
 * One structured line on stdout. ADR 0007 requires every mutation to log its
 * idempotency key, actor, org and route this way, so that "did the server ever
 * see key X" is answerable by grep over SSH.
 */
export function log(level: 'info' | 'warn' | 'error', event: string, fields: LogFields = {}): void {
  const line = scrub({ level, event, ...fields })
  process.stdout.write(`${JSON.stringify(line)}\n`)
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
