/**
 * Removes the things a volunteer would not expect to find in a third-party
 * error payload — their name, their mobile number, their email address, and
 * the credentials on the request that failed.
 *
 * ADR 0007 puts Sentry in front of browser and server exceptions and requires
 * volunteer names and mobile numbers scrubbed before send; ADR 0004 makes a
 * phone number load-bearing, which is exactly why it must not leak. ADR 0016
 * is blunt that the lint rule guarantees only that reports pass through here.
 * That the scrubbing is correct is this module's tests, and nothing else.
 *
 * The bias is deliberate: redact by key even where the value looks harmless.
 * An over-redacted report costs a maintainer a guess; an under-redacted one
 * cannot be taken back.
 *
 * What this cannot do: find a volunteer's name inside free text. A phone
 * number has a shape and a name does not, and a rule that guessed would either
 * redact `Field D` or miss `Cathy`. The rule that follows is for callers — a
 * report names no volunteer in its message — and it is a review comment rather
 * than a mechanism, because it fails ADR 0016's zero-false-positives test.
 */

export const REDACTED = '[redacted]'

const MAX_DEPTH = 12

/**
 * Keys whose value is presumed personal. Broad on purpose — `username`,
 * `volunteerName` and `supervisingAdultName` all have to be caught by the same
 * rule, because the next field nobody thought of will be named like them.
 */
const PII_KEY =
  /(name|phone|mobile|tel|email|address|contact|cookie|authorization|token|password|secret|birth|dob)/i

/** Kept from a `user` object; everything else about a person is dropped. */
const USER_KEEP = ['id'] as const

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]*\w/g

/**
 * US numbers as the barn writes them: (410) 555-0134, 410-555-0134,
 * 410.555.0134, +1 410 555 0134, 4105550134.
 *
 * The leading group is captured and put back rather than written as a
 * lookbehind, because this module is bundled for the phone and Safari only
 * learned lookbehind in 16.4 — a regular expression is parsed when the module
 * loads, so an older iPhone would not fail to scrub, it would fail to start.
 *
 * The boundaries are what keep a UUID out of it: an idempotency key is the one
 * string in a log line that must survive, and its digit runs always sit
 * against a word character or a hyphen.
 */
const PHONE = /(^|[^\w-])((?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-]?)\d{3}[\s.-]?\d{4})(?![\w-])/g

/** Returns a deep copy of `event` with personal data removed. */
export function scrub<T>(event: T): T {
  return scrubValue(event, new WeakSet(), 0) as T
}

/** Redacts email addresses and phone numbers written into free text. */
export function scrubText(text: string): string {
  return text.replace(EMAIL, REDACTED).replace(PHONE, (_match, before: string) => `${before}${REDACTED}`)
}

function scrubValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === 'string') return scrubText(value)
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return REDACTED
  if (seen.has(value)) return REDACTED
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, seen, depth + 1))
  }

  const scrubbed: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'user') {
      scrubbed[key] = identityOf(entry)
    } else if (PII_KEY.test(key)) {
      scrubbed[key] = REDACTED
    } else {
      scrubbed[key] = scrubValue(entry, seen, depth + 1)
    }
  }
  return scrubbed
}

/**
 * A person is an id and nothing else. Which volunteer hit the error is worth
 * knowing; who they are is a lookup the maintainer can do in the app.
 */
function identityOf(user: unknown): unknown {
  if (user === null || typeof user !== 'object' || Array.isArray(user)) return REDACTED

  const identity: Record<string, unknown> = {}
  for (const key of USER_KEEP) {
    const value = (user as Record<string, unknown>)[key]
    if (value !== undefined) identity[key] = scrubValue(value, new WeakSet(), 0)
  }
  return identity
}
