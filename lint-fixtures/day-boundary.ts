// Fixture: no day boundary derived outside the organisation's timezone.
// The globals, the members, the formatters, and the calendar library sitting in
// package.json — a ban on `Date` that leaves Luxon reachable moves the wrong
// answer one import along rather than stopping it.
import { DateTime } from 'luxon'

export function overdueSince(shiftStart: {
  toLocaleDateString: () => string
  toLocaleTimeString: () => string
}): string {
  const startedAt = new Date()
  const elapsed = Date.now() - startedAt.valueOf()
  const formatter = new Intl.DateTimeFormat('en-US')
  const today = DateTime.now().toISODate()
  const alsoToday = globalThis.Date.now()

  return `${shiftStart.toLocaleDateString()} ${shiftStart.toLocaleTimeString()} ${formatter.format(elapsed)} ${today ?? ''} ${String(alsoToday)}`
}
