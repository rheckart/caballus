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
 * JSON with object keys in a fixed order. `JSON.stringify` preserves insertion
 * order, which is a property of how a body was parsed rather than of what it
 * says, so it cannot be compared across two requests.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    // `undefined` stringifies to nothing at all; in JSON it is a null.
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    // By code unit, not by locale: a digest that depends on the machine's
    // collation is a conflict on a server somebody moved.
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))

  return `{${entries.map(([name, member]) => `${JSON.stringify(name)}:${canonical(member)}`).join(',')}}`
}
