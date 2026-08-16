// Fixture: no error report bypasses scrubbing.
// One violation.
import * as Sentry from '@sentry/node'

export function report(error: unknown): void {
  Sentry.captureException(error)
}
