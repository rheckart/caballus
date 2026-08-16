// Fixture: no day boundary derived outside the organisation's timezone.
// Six violations: `Date` as a global twice (the constructor, and again as the
// object of `Date.now`), `Date.now` as a member expression, `Intl`, and the two
// locale formatters.
export function overdueSince(shiftStart: {
  toLocaleDateString: () => string
  toLocaleTimeString: () => string
}): string {
  const startedAt = new Date()
  const elapsed = Date.now() - startedAt.valueOf()
  const formatter = new Intl.DateTimeFormat('en-US')

  return `${shiftStart.toLocaleDateString()} ${shiftStart.toLocaleTimeString()} ${formatter.format(elapsed)}`
}
