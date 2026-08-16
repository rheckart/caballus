/**
 * Registration for the `/api/v1` layer, and the place two of ADR 0016's
 * invariants are types rather than lint rules — because the type checker runs
 * on every keystroke and lint runs when something invokes it.
 *
 * 1. Every handler declares the authorization it requires. `route` takes it as
 *    a required argument and there is no overload without one, so omission
 *    does not compile.
 * 2. Every queueable mutation carries an idempotency key. `mutation` takes a
 *    schema whose shape must contain one, so a keyless mutation does not
 *    compile (ADR 0005).
 */
import { Hono, type Context } from 'hono'
import { z } from 'zod'

import {
  API_BASE,
  API_VERSION,
  UNSUPPORTED_API_VERSION,
  apiVersionOf,
} from '../../shared/api-client'
import { log, report } from '../observability'
import { requestContext, type RequestContext } from '../request-context'
import { authorize, describeAuthorization, type Authorization } from './authorization'

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
export type MutationHandler<TInput> = (
  input: TInput,
  ctx: HandlerContext,
) => Response | Promise<Response>

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

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export interface ApiOptions {
  /**
   * How a request becomes a context. The default reads the organisation from
   * configuration and the actor from the session; a test supplies its own to
   * put somebody in the barn.
   */
  readonly context?: (request: Request) => RequestContext
}

export function createApi(options: ApiOptions = {}): Api {
  const contextOf = options.context ?? requestContext
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

        // Every mutation logs its key, actor, org and route, so that "did the
        // server ever see key X" is a grep over SSH (ADR 0007).
        //
        // The key is required, parsed and logged; nothing dedupes on it yet.
        // That needs the partial unique index of ADR 0007 and lands with the
        // first real mutation, which is also the first time it can be tested.
        log('info', 'mutation', {
          route: `POST ${path}`,
          idempotencyKey: key,
          requiring: describeAuthorization(auth),
          actor: ctx.context.actor?.volunteerId ?? null,
          orgId: ctx.context.orgId,
          requestId: ctx.context.requestId,
        })

        return handler(parsed.data, ctx)
      })
    },

    fetch(request) {
      return app.fetch(request)
    },
  }

  return api
}
