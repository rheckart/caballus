/**
 * What this layer is allowed to answer with, and the one place an answer is
 * built — including when it is being built for the second time.
 *
 * ADR 0020 promises a retry the *first answer*, and only the status and body of
 * one are stored. That is enough to rebuild it faithfully **only** if the rest
 * of the response is a function of those two — which was asserted in a comment
 * and was not true: a handler could return any `Response` it liked, so a 204
 * that had said nothing came back from the queue announcing `application/json`
 * (#30).
 *
 * ADR 0016's move is to make the claim a type rather than a comment. A mutation
 * handler returns an `ApiResponse`, which only the builders below produce, and
 * they set exactly one header on exactly one condition — so `rebuild` can put
 * that header back without storing it, and the first answer and its replay come
 * out of the same function. A response with a `Location` or an `ETag` is not a
 * thing that can be written here; the endpoint that needs one adds a builder,
 * and adding it means deciding how it replays.
 */

/**
 * The brand. It is never read at runtime and cannot be produced by hand, which
 * is the whole of the guarantee: a `Response` from anywhere else does not
 * satisfy it and does not compile.
 */
declare const built: unique symbol

/** A response this layer built, and can therefore build again. */
export type ApiResponse = Response & { readonly [built]: 'by src/server/api/answer.ts' }

const JSON_TYPE = 'application/json'

/**
 * An answer with a body, which is JSON, because ADR 0007 keeps blobs off this
 * path.
 *
 * `undefined` stringifies to nothing at all, which would be an answer carrying
 * a content type over an empty body — and its replay, rebuilt from the empty
 * string that was stored, would carry neither. It is JSON's `null` here, the
 * same way `fingerprint` treats it.
 */
export function json(body: unknown, status = 200): ApiResponse {
  if (BODILESS.has(status)) {
    // The message names the alternative rather than describing the problem,
    // which is the one thing ADR 0016 asks of every rule that fires.
    throw new Error(`A ${status} may not carry a body. Answer with noContent() instead.`)
  }
  return answer(JSON.stringify(body) ?? 'null', status)
}

/** The statuses whose response may not carry a body, per RFC 9110. */
const BODILESS = new Set([101, 103, 204, 205, 304])

/**
 * An answer with nothing in it. 204 and its siblings may not carry a body, and
 * a handler saying *done, nothing to tell you* is an ordinary thing to write —
 * so it is written this way rather than by reaching for `Response` and taking
 * the replay with it.
 */
export function noContent(): ApiResponse {
  return answer('', 204)
}

/**
 * A stored answer, made into a response again — the status and body ADR 0020
 * keeps, and nothing else, because nothing else is kept.
 *
 * **Not a handler's door.** `json` and `noContent` are what a handler answers
 * with; this is what `mutation` calls for the *first* attempt and the replay
 * alike, so that the two are one function's output rather than two things that
 * agree today. A handler could import it and hand it something that is not
 * JSON, and would be labelling that answer `application/json` on purpose —
 * which is a thing a person can do here and not a thing the type prevents.
 */
export function rebuild(body: string, status: number): ApiResponse {
  return answer(body, status)
}

/** The only place any of this becomes a `Response`. */
function answer(body: string, status: number): ApiResponse {
  const response = new Response(body === '' ? null : body, {
    status,
    // A body is JSON and nothing else is; an empty answer says nothing about a
    // type it does not have. Stated once, so a replay cannot state it
    // differently.
    headers: body === '' ? {} : { 'content-type': JSON_TYPE },
  })
  return response as ApiResponse
}
