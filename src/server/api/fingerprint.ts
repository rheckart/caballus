/**
 * What a request *was*, in 64 characters.
 *
 * ADR 0005 says a repeat of a key is treated as success. It does not say what
 * a repeat of a key carrying a *different* request is, and the two must not be
 * confused: answering a changed body with the first response would tell a
 * client its second, different write had succeeded when nothing recorded it.
 * So the key is stored beside a digest of the request it first arrived with,
 * and a mismatch is a conflict rather than a replay.
 *
 * A digest rather than the body itself, deliberately. A queued write carries
 * volunteer names and observations, and storing the payload a second time
 * would put personal data in a table whose only job is bookkeeping — the same
 * argument ADR 0007 makes about what reaches Sentry. A digest answers *is this
 * the same request* and nothing else.
 */
import { createHash } from 'node:crypto'

/**
 * The digest of one request: where it was sent and the body the schema parsed
 * out of it.
 *
 * `target` is where the request was actually sent — the concrete path, decoded,
 * with its query — and never the pattern that matched it. Two horses under one
 * pattern are two requests, and a digest that cannot tell them apart answers
 * the second with the first one's response. `target` in
 * `src/server/api/route.ts` builds it, and ADR 0020 says why it is shaped the
 * way it is.
 *
 * The parsed body rather than the raw text, so that whitespace, key order and
 * fields Zod strips do not make one request look like two — those are the same
 * request as far as any handler is concerned, and a client that reserialises
 * its queue must not be told its retry is a conflict. The same standard is
 * held on the path, which is why `target` is a value here and not a string.
 */
export function fingerprint(target: unknown, input: unknown): string {
  return createHash('sha256')
    .update(canonical([target, input]))
    .digest('hex')
}

/**
 * A value `canonical` refuses rather than guesses at — a Map, a Set, a class
 * instance, anything whose meaning on the wire nobody has decided (#31). ADR
 * 0020 built the digest so a different request gets a 409 instead of a
 * confident lie; canonicalising one of these wrong — or, before this file
 * handled dates, silently as `{}` — is the same lie one step removed. A
 * hand-written Zod schema (ADR 0007) should never produce one of these on a
 * queueable write, so the failure belongs at the schema that first does, loud,
 * rather than guessed at quietly here.
 */
export class UnfingerprintableValueError extends Error {
  constructor(value: object) {
    super(
      `fingerprint cannot canonicalise a ${describeShape(value)}; ` +
        'give the field a wire shape a schema can own (#31)',
    )
    this.name = 'UnfingerprintableValueError'
  }
}

/**
 * JSON with object keys in a fixed order. `JSON.stringify` preserves insertion
 * order, which is a property of how a body was parsed rather than of what it
 * says, so it cannot be compared across two requests.
 */
function canonical(value: unknown): string {
  if (typeof value === 'bigint') {
    // JSON has no bigint literal, and `JSON.stringify` refuses one outright —
    // a TypeError thrown before the key is claimed, so a retry meets the same
    // throw forever (#31). Tagged like a date below, so a bigint field and a
    // string field holding the same digits do not collide.
    return canonical(['BigInt', value.toString()])
  }
  if (value === null || typeof value !== 'object') {
    // `undefined` stringifies to nothing at all; in JSON it is a null.
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }
  if (tagOf(value) === 'Date') {
    // Every own property of a date lives in an internal slot, so
    // `Object.entries` sees none — every date used to canonicalise to the
    // same `{}` as every other one, and two care events differing only in
    // when they happened digested identically (#31). Tagged, not bare ISO
    // text, so a date field and a string field holding its own ISO text stay
    // distinguishable from each other.
    return canonical(['Date', (value as { toISOString(): string }).toISOString()])
  }
  if (!isPlainObject(value)) {
    throw new UnfingerprintableValueError(value)
  }

  const entries = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    // By code unit, not by locale: a digest that depends on the machine's
    // collation is a conflict on a server somebody moved.
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))

  return `{${entries.map(([name, member]) => `${JSON.stringify(name)}:${canonical(member)}`).join(',')}}`
}

/**
 * A `{}` or an `Object.create(null)`, and nothing that merely looks like one.
 * `Object.entries` answers the right question for a shape a Zod object schema
 * produced, and the wrong one for a Map, a Set or a class instance — each has
 * a meaning `Object.entries` either cannot see or actively hides (#31).
 */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * `Object.prototype.toString.call(x)` rather than `instanceof Date`, so this
 * file never writes the `Date` identifier ADR 0016 bans repo-wide. That ban is
 * for deriving a day boundary; this reads a date a schema already produced,
 * which is a different question asked of the same word.
 */
function tagOf(value: object): string {
  return Object.prototype.toString.call(value).slice('[object '.length, -1)
}

/** The built-in tag where it says something (`Map`, `Set`, `RegExp`), the class name where it doesn't. */
function describeShape(value: object): string {
  const tag = tagOf(value)
  if (tag !== 'Object') return tag
  return value.constructor?.name ?? 'Object'
}
