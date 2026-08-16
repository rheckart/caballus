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
import { Hono } from 'hono'
import { z } from 'zod'

import { API_BASE } from '../../shared/api-client'
import { log, report } from '../observability'
import { requestContext, type RequestContext } from '../request-context'
import { authorize, describeAuthorization, type Authorization } from './authorization'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

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
  mutation<TShape extends z.ZodRawShape & { idempotencyKey: z.ZodType<string> }>(
    path: RoutePath,
    auth: Authorization,
    schema: z.ZodObject<TShape>,
    handler: MutationHandler<z.output<z.ZodObject<TShape>>>,
  ): Api

  fetch(request: Request): Response | Promise<Response>
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

  app.notFound(() => json({ error: 'not_found' }, 404))
  app.onError((error, c) => {
    report(error, { route: `${c.req.method} ${c.req.path}` })
    return json({ error: 'internal_error' }, 500)
  })

  const api: Api = {
    route(method, path, auth, handler) {
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
    },

    mutation(path, auth, schema, handler) {
      return api.route('POST', path, auth, async (ctx) => {
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
