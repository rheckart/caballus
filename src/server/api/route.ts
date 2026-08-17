/**
 * Registration for the `/api/v1` layer, and the place three of ADR 0016's
 * invariants are types rather than lint rules — because the type checker runs
 * on every keystroke and lint runs when something invokes it.
 *
 * 1. Every handler declares the authorization it requires. `route` takes it as
 *    a required argument and there is no overload without one, so omission
 *    does not compile.
 * 2. Every queueable mutation carries an idempotency key. `mutation` takes a
 *    schema whose shape must contain one, so a keyless mutation does not
 *    compile (ADR 0005).
 * 3. Every mutation answers with an `ApiResponse`, which only `answer.ts`
 *    builds — so a stored answer can be replayed exactly rather than
 *    approximately (ADR 0020).
 *
 * The key is also *acted on* here rather than in handlers. `mutation` opens
 * the transaction, records the key inside it and hands the handler the scoped
 * handle — so a handler cannot opt out of dedupe and cannot forget it, which
 * is what ADR 0016 means by refusing to enforce an invariant in prose.
 */
import { Hono, type Context } from 'hono'
import { z } from 'zod'

import type { OrgScopedDatabase } from '../../db/for-org'
import { postgresIdempotency, type Idempotency, type Outcome } from '../../db/idempotency'
import {
  API_BASE,
  API_VERSION,
  UNSUPPORTED_API_VERSION,
  apiVersionOf,
} from '../../shared/api-client'
import { log, report } from '../observability'
import { requestContext, type RequestContext } from '../request-context'
import { json, rebuild, type ApiResponse } from './answer'
import { authorize, describeAuthorization, type Authorization } from './authorization'
import { fingerprint } from './fingerprint'

/**
 * Reads only.
 *
 * A `route('POST', …)` would be a write with no schema and no idempotency key,
 * and it would be *shorter* to write than `mutation` — which is the exact
 * condition ADR 0016 exists to remove, since a rule whose violation is easier
 * to write than its observance does not survive contact with an agent under
 * context pressure. Every write goes through `mutation`, and there is no other
 * door.
 */
export type Method = 'GET'

/** A path below `/api/v1`. The version lives in one place (ADR 0016). */
export type RoutePath = `/${string}`

export interface HandlerContext {
  readonly request: Request
  readonly params: Record<string, string>
  readonly context: RequestContext
}

export type Handler = (ctx: HandlerContext) => Response | Promise<Response>

/**
 * What a write gets that a read does not: the transaction its effect belongs
 * in. It is the same one the idempotency key is recorded in, so a rollback
 * takes both — which is the guarantee, and it is structural rather than
 * remembered.
 */
export interface MutationContext extends HandlerContext {
  readonly db: OrgScopedDatabase
}

/**
 * A write answers with something this layer built, and a read may answer with
 * anything.
 *
 * Not symmetry for its own sake: a write's answer is stored and handed to a
 * retry days later (ADR 0020), and only what `answer.ts` builds can be put back
 * together from the status and body that were stored. A read is answered once
 * and never replayed, so nothing there is claiming to reproduce it.
 */
export type MutationHandler<TInput> = (
  input: TInput,
  ctx: MutationContext,
) => ApiResponse | Promise<ApiResponse>

/**
 * Minted on the phone before the first attempt, and the same on every retry
 * (ADR 0005). It is not an entity id, even where the two would coincide.
 */
export const idempotencyKey = z.uuid()

/** Builds the request schema for a queueable write. */
export function queueable<TShape extends z.ZodRawShape>(
  shape: TShape,
): z.ZodObject<TShape & { idempotencyKey: typeof idempotencyKey }> {
  return z.object({ ...shape, idempotencyKey })
}

export interface Api {
  /** Registers a handler. The authorization argument is not optional. */
  route(method: Method, path: RoutePath, auth: Authorization, handler: Handler): Api

  /**
   * Registers a queueable write. The schema must carry an idempotency key,
   * which is what `queueable` is for.
   */
  mutation<TShape extends z.ZodRawShape & { idempotencyKey: typeof idempotencyKey }>(
    path: RoutePath,
    auth: Authorization,
    schema: z.ZodObject<TShape>,
    handler: MutationHandler<z.output<z.ZodObject<TShape>>>,
  ): Api

  fetch(request: Request): Response | Promise<Response>
}

/**
 * A segment that could be a version somebody once shipped, which is the only
 * kind of rejection worth a line on the log.
 *
 * Everything under the root that is not the served version gets the same 400,
 * deliberately: a client that forgot the version and one asking for a version
 * called `day` are the same request and deserve the same answer. But logging
 * all of them hands the internet a write primitive — `/api/.env`, `/api/config`
 * and the rest of the scanner's list would each leave a `warn` carrying a
 * string somebody else chose, on a box where the log is read over SSH (ADR
 * 0006). The shape is bounded so that what reaches the line is too.
 *
 * The cost is honest: a versionless path from our own client — `/api/day`,
 * from a call site that skipped the typed client — is answered but not logged.
 * That one is already a lint error (ADR 0016) and a rejection the caller sees.
 */
const VERSION_SHAPED = /^v\d{1,4}$/

/**
 * The largest body read for the sake of a log line. An unmatched path is
 * unauthenticated, and buffering whatever arrives on one is a cost this
 * endpoint should not be able to be made to pay. A queued tick is small JSON
 * (ADR 0007); nothing this exists to record comes anywhere near it.
 */
const MAX_REJECTED_BODY = 64 * 1024

/**
 * The key a rejected write was carrying, if it was a write and it was carrying
 * one — read here because nothing downstream will ever see this request.
 */
async function rejectedIdempotencyKey(request: Request): Promise<string | null> {
  if (request.method !== 'POST') return null

  const text = await boundedBody(request)
  if (text === null) return null
  const body: unknown = await new Response(text).json().catch(() => undefined)
  if (typeof body !== 'object' || body === null) return null

  const { idempotencyKey: key } = body as { idempotencyKey?: unknown }
  return typeof key === 'string' ? key : null
}

/**
 * The body, if it fits — read a chunk at a time against the cap rather than
 * trusting `content-length`, which is the requester's claim about itself and
 * is absent altogether from a chunked body. Over the cap the read is
 * abandoned: a log line is not worth holding whatever somebody chose to send.
 */
async function boundedBody(request: Request): Promise<string | null> {
  if (request.body === null) return null

  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_REJECTED_BODY) {
      await reader.cancel()
      return null
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

/**
 * What the wrapper answers, and the second line it leaves behind.
 *
 * `mutation` has already logged that the key arrived. This says what the
 * server did with it, so that ADR 0007's question — *did the server see key X,
 * and what did it answer* — is one grep and not a reconstruction.
 */
function respond(
  outcome: Outcome,
  about: { route: string; key: string; requestId: string },
): ApiResponse {
  const line = { route: about.route, idempotencyKey: about.key, requestId: about.requestId }

  switch (outcome.kind) {
    case 'performed':
      log('info', 'mutation_answered', {
        ...line,
        outcome: 'performed',
        status: outcome.answered.status,
      })
      // Built here rather than passed through from the handler, which is what
      // makes the two branches below provably the same answer: one function,
      // one call site, and the store keeps a status and a body rather than a
      // response it would have to reproduce (#30).
      return rebuild(outcome.answered.body, outcome.answered.status)

    case 'replayed':
      // Not a warning. A replay is the retry queue working exactly as ADR 0005
      // intends, and a log that cries about it is a log nobody reads.
      log('info', 'mutation_answered', {
        ...line,
        outcome: 'replayed',
        status: outcome.answered.status,
        firstRecordedAt: outcome.recordedAt,
      })
      return rebuild(outcome.answered.body, outcome.answered.status)

    case 'reused':
      // One key, two different requests. Answering with the first response
      // would report success for a write nothing recorded, so it is refused —
      // and refused with a 409, which every client already reads as *stop
      // retrying, this will not become true*.
      log('warn', 'mutation_answered', {
        ...line,
        outcome: 'key_reused',
        status: 409,
        firstRoute: outcome.firstRoute,
        firstRecordedAt: outcome.recordedAt,
      })
      return json({ error: 'idempotency_key_reused' }, 409)

    case 'unfinished':
      log('warn', 'mutation_answered', {
        ...line,
        outcome: 'key_unfinished',
        status: 409,
        firstRecordedAt: outcome.recordedAt,
      })
      return json({ error: 'idempotency_key_unfinished' }, 409)
  }
}

/**
 * Where a request was actually sent, in the two forms this module needs it.
 *
 * The pattern is the same string for every horse in the barn, so a digest built
 * from it reads one key spent on `/horses/alfie/observations` and then on
 * `/horses/bramble/observations` as one request twice — and answers bramble
 * with alfie's response while nothing records it. ADR 0020 settles the rest:
 * `identity` carries the query and `route` does not, and the reasons are there
 * rather than restated here.
 */
interface Target {
  /** For the table and the log: the path as sent, without its query. */
  readonly route: string
  /** For the digest: the same path, decoded, with its query beside it. */
  readonly identity: Identity
}

/**
 * A request's *where*, canonicalised the way `fingerprint` canonicalises its
 * *what* — because the two halves of one digest cannot hold each other to
 * different standards. Key order in a body does not make a retry a conflict,
 * and neither may the spelling of a path: `/horses/al%66ie` and
 * `/horses/alfie` reach the same handler with the same `horseId`, so a client
 * that re-encodes its queue between attempts must not be handed a 409 its
 * write can never drain past (ADR 0005).
 *
 * The path is its decoded segments rather than a joined string, so that a
 * segment containing a slash cannot spell itself as two.
 */
interface Identity {
  readonly method: string
  readonly path: readonly string[]
  /** Sorted, for the same reason object keys are: order is not a difference. */
  readonly query: readonly (readonly [string, string])[]
}

function target(request: Request): Target {
  const url = new URL(request.url)
  const path = url.pathname.split('/').map(decodeSegment)
  const query = [...url.searchParams]
    .map(([name, value]): readonly [string, string] => [name, value])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))

  return {
    route: `${request.method} ${url.pathname}`,
    identity: { method: request.method, path, query },
  }
}

/**
 * A path segment as the router will read it. A stray `%` is not an escape and
 * throws here rather than in the digest, so the segment stands as it arrived —
 * which is what the router matched on anyway.
 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * Re-exported so a handler has one import and one door. What an answer may be
 * is decided in `answer.ts`, because a stored one has to be rebuildable from
 * what was stored (ADR 0020, #30).
 */
export { json, noContent, type ApiResponse } from './answer'

export interface ApiOptions {
  /**
   * How a request becomes a context. The default reads the organisation from
   * configuration and the actor from the session; a test supplies its own to
   * put somebody in the barn.
   */
  readonly context?: (request: Request) => RequestContext

  /**
   * Where a key is written down and looked up. The default is the table; a
   * test of this module's own decisions supplies the in-memory one, which is
   * the same contract and proves nothing about the index (ADR 0007).
   */
  readonly idempotency?: Idempotency
}

export function createApi(options: ApiOptions = {}): Api {
  const contextOf = options.context ?? requestContext
  const idempotency = options.idempotency ?? postgresIdempotency()
  const app = new Hono().basePath(API_BASE)

  /**
   * Nothing matched. Either the version does not claim this path, or the
   * request named a version this server does not serve — and those are
   * different facts that ADR 0010 requires different answers for, because *you
   * may not do this* and *your client is too old* produce very different things
   * on a phone in a barn.
   *
   * A queued write that comes back 404 looks like a mistyped path to whoever
   * reads the log; the same write told its version is gone is a bundle that
   * needs reloading, and no amount of retrying will change it. This is the
   * whole reason the version is in the path (ADR 0007).
   */
  app.notFound(async (c) => {
    const version = apiVersionOf(c.req.path)
    if (version !== null && version !== API_VERSION) {
      // 400 rather than 404, which this would otherwise be indistinguishable
      // from, and rather than 410 — a retired version and one from a client
      // ahead of this server both land here, and Gone is a lie about the
      // second. What the client needs is *stop retrying and reload*, which
      // every 4xx that is not 401 already says.
      if (VERSION_SHAPED.test(version)) await logVersionRejection(c, version)
      return json(
        { error: UNSUPPORTED_API_VERSION, supported: API_VERSION, received: version },
        400,
      )
    }
    return json({ error: 'not_found' }, 404)
  })

  /**
   * The rejection, on a line that answers what ADR 0007 asks of the log.
   *
   * A queued write turned away here never reaches `mutation`, so this is the
   * only place its idempotency key is ever written down — and "did the server
   * ever see key X" is the question this log exists for. The request id and
   * org put it beside the denial `register` logs, so the two can be read as
   * one request rather than two unrelated lines.
   */
  async function logVersionRejection(c: Context, version: string): Promise<void> {
    const ctx = contextOf(c.req.raw)
    log('warn', 'unsupported_api_version', {
      route: `${c.req.method} ${c.req.path}`,
      received: version,
      supported: API_VERSION,
      idempotencyKey: await rejectedIdempotencyKey(c.req.raw),
      requestId: ctx.requestId,
      orgId: ctx.orgId,
    })
  }
  app.onError((error, c) => {
    report(error, { route: `${c.req.method} ${c.req.path}` })
    return json({ error: 'internal_error' }, 500)
  })

  /**
   * Registration, for any method. Not exported: a read takes `route`, a write
   * takes `mutation`, and there is no third door.
   */
  function register(
    method: 'GET' | 'POST',
    path: RoutePath,
    auth: Authorization,
    handler: Handler,
  ): Api {
    app.on(method, path, async (c) => {
      const ctx = contextOf(c.req.raw)
      const decision = authorize(auth, ctx.actor)
      if (!decision.allowed) {
        // A denial is a structured log, not an audit row (ADR 0010).
        //
        // The pattern here, where `mutation` writes the path that was sent: a
        // denial is decided before anything authenticated the caller, and the
        // segments of a matched path are still a stranger's string. What joins
        // this line to the rest of its request is `requestId`, which every line
        // carries, and not the route.
        log('warn', 'denied', {
          route: `${method} ${path}`,
          wanted: decision.wanted,
          requestId: ctx.requestId,
          orgId: ctx.orgId,
        })
        return json({ error: 'not_authorized', wanted: decision.wanted }, decision.status)
      }
      return handler({ request: c.req.raw, params: c.req.param(), context: ctx })
    })
    return api
  }

  const api: Api = {
    route(method, path, auth, handler) {
      return register(method, path, auth, handler)
    },

    mutation(path, auth, schema, handler) {
      return register('POST', path, auth, async (ctx) => {
        const body: unknown = await ctx.request.json().catch(() => undefined)
        const parsed = schema.safeParse(body)
        if (!parsed.success) {
          // Explicitly rejected and surfaced, never accepted and
          // misinterpreted (ADR 0007).
          return json({ error: 'invalid_request', issues: parsed.error.issues }, 400)
        }

        // The shape constraint guarantees the key at the call site; inside the
        // generic it has to be named.
        const { idempotencyKey: key } = parsed.data as { idempotencyKey: string }
        // The path that was sent, not the pattern registered above — two
        // horses are two requests, and a digest that cannot tell them apart
        // answers the second with the first one's response.
        const { route, identity } = target(ctx.request)

        // Every mutation logs its key, actor, org and route, so that "did the
        // server ever see key X" is a grep over SSH (ADR 0007). This line is
        // written on arrival rather than on the way out, so it survives a
        // handler that throws — receipt is the half of the question that a
        // failed write still has to answer.
        log('info', 'mutation', {
          route,
          idempotencyKey: key,
          requiring: describeAuthorization(auth),
          actor: ctx.context.actor?.volunteerId ?? null,
          orgId: ctx.context.orgId,
          requestId: ctx.context.requestId,
        })

        const outcome = await idempotency.once(
          {
            orgId: ctx.context.orgId,
            key,
            route,
            fingerprint: fingerprint(identity, parsed.data),
          },
          // The store is handed the two fields it keeps, not a response: a body
          // can be read only once, and the thing that gets stored has to be the
          // thing the caller is handed back (#30).
          async (db) => {
            const answered = await handler(parsed.data, { ...ctx, db })
            return { status: answered.status, body: await answered.text() }
          },
        )

        return respond(outcome, { route, key, requestId: ctx.context.requestId })
      })
    },

    fetch(request) {
      return app.fetch(request)
    },
  }

  return api
}
