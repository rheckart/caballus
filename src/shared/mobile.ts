/**
 * A mobile number, in one spelling (#78, ADR 0029).
 *
 * `volunteers.mobile` was free text while it was decoration — ADR 0009 kept
 * collecting it and stopped enforcing it. The moment a text is how somebody
 * logs in, it is a **credential**, and a credential compared as free text is a
 * volunteer standing in a barn whose number is stored as `(410) 555-0134` and
 * typed as `410-555-0134`. So there is one stored form, and it is E.164 —
 * which is also the only form Twilio accepts.
 *
 * **The rescue is one organisation in Maryland**, so a bare ten-digit number is
 * read as a US one and given `+1`. That is a pin rather than an oversight, the
 * same pin `src/shared/time.ts` makes about the display locale: guessing a
 * country from a number with no code is a guess either way, and the honest
 * version of it is the one written down. A number typed with a `+` is taken as
 * given, so a volunteer with a number from anywhere else can still be recorded.
 *
 * Shared rather than server-side because the login screen has to make the same
 * decision the server does about whether somebody typed an address or a
 * number, and two copies of that rule is one of them being wrong.
 */

/** The most digits E.164 allows, and the fewest a real number has. */
const MOST_DIGITS = 15
const FEWEST_DIGITS = 8

/**
 * The one stored form, or `null` for something that is not a number.
 *
 * `null` and not a throw: every caller has something better to say than a
 * stack trace — *that is not a mobile number we recognise*, or *leave it
 * blank*. Blank and absent are the same fact about a phone number, and storing
 * the empty string would make *has a mobile* two questions.
 */
export function normaliseMobile(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  const international = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')

  if (international) {
    return digits.length >= FEWEST_DIGITS && digits.length <= MOST_DIGITS ? `+${digits}` : null
  }
  // A bare US number, with or without the trunk `1` the barn writes sometimes.
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/**
 * Whether what somebody typed at the login screen is meant to be a number
 * rather than an address.
 *
 * The test is the `@` and nothing cleverer. A number that cannot be read is
 * still *a number they got wrong* and has to be refused as one — sending it
 * down the email path would tell them we do not know an address they never
 * typed, which is the wrong sentence at the wrong door.
 */
export function looksLikeMobile(raw: string): boolean {
  return !raw.includes('@')
}
