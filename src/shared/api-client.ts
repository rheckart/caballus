/**
 * The typed client for the versioned API, and the one module that writes the
 * path (ADR 0016) — for the phone that calls it and, through `API_BASE`, for
 * the server that mounts it. With a typed client nobody else has a reason to
 * write `/api/...`, and an agent reaching for `fetch('/api/shifts')` under
 * context pressure is the most predictable violation on the list.
 *
 * The version in the path is load-bearing: a write queued on Tuesday's client
 * and replayed on Thursday's server is either accepted or explicitly rejected,
 * never accepted and misinterpreted (ADR 0007).
 */
import { v7 as uuidv7 } from 'uuid'

/** The version this build speaks. The server serves it; the phone calls it. */
export const API_VERSION = 'v1'

/**
 * Everything below here is versioned; nothing is served at the root itself.
 *
 * Exported so that the server's version check and the tests that exercise it
 * can name the root without writing the literal a second time — which is the
 * thing ADR 0016's rule bans, and the reason this module is its one exemption.
 */
export const API_ROOT = '/api'

export const API_BASE = `${API_ROOT}/${API_VERSION}`

/**
 * The version segment of an `/api` path, or `null` for a path that is not one.
 *
 * `/api/v2/shifts` is `'v2'`; `/api/day` is `'day'`, because a client that has
 * forgotten the version is indistinguishable from one asking for a version
 * called `day` and both deserve the same answer; `/shifts` is `null`.
 */
export function apiVersionOf(pathname: string): string | null {
  if (pathname !== API_ROOT && !pathname.startsWith(`${API_ROOT}/`)) return null
  return pathname.slice(API_ROOT.length + 1).split('/')[0] ?? ''
}

/** What the server answers a version it does not serve, as the client reads it. */
export const UNSUPPORTED_API_VERSION = 'unsupported_api_version'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${String(status)} from the API`)
    this.name = 'ApiError'
  }
}

/**
 * The server does not speak this build's version — the phone is running a
 * bundle older than the server, which happens when a volunteer has not opened
 * the app in long enough for a version to be retired.
 *
 * Its own class because *you may not do this* and *your client is too old*
 * produce very different things in a barn (ADR 0010): a denial is a fact about
 * the volunteer, and this is a fact about the bundle they are holding. A write
 * that gets this back must leave the queue — retrying cannot fix it.
 */
export class OutdatedClientError extends ApiError {
  constructor(
    status: number,
    body: unknown,
    readonly supported: string,
  ) {
    super(status, body)
    this.name = 'OutdatedClientError'
    // A rejection that names no replacement is still a rejection: what the
    // volunteer has to do about it does not depend on the number.
    this.message =
      supported === ''
        ? `this client speaks ${API_VERSION}; the server does not`
        : `this client speaks ${API_VERSION}; the server serves ${supported}`
  }
}

/** A path below the version, as `route` registers it. */
export type ApiPath = `/${string}`

export async function apiGet<T>(path: ApiPath, init: RequestInit = {}): Promise<T> {
  return send<T>(path, { ...init, method: 'GET' })
}

/**
 * Sends a queueable write. The idempotency key is minted here, once, before
 * the first attempt — mint it per attempt and every retry looks like a new
 * event, which is the bug ADR 0005 exists to prevent. The caller passes one in
 * when the write is being replayed from the queue.
 */
export async function apiPost<T>(
  path: ApiPath,
  body: Record<string, unknown>,
  options: { idempotencyKey?: string } = {},
): Promise<T> {
  return send<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // The key is written last so that a field in `body` cannot shadow it: a
    // write whose key came from its own payload is a write with no key.
    body: JSON.stringify({ ...body, idempotencyKey: options.idempotencyKey ?? uuidv7() }),
  })
}

/** A fresh idempotency key, for a write on its way into the queue. */
export function newIdempotencyKey(): string {
  return uuidv7()
}

async function send<T>(path: ApiPath, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init)
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const rejected = versionRejection(body)
    throw rejected === undefined
      ? new ApiError(response.status, body)
      : new OutdatedClientError(response.status, body, rejected)
  }
  return body as T
}

/** The version the server serves, if that is what it just said it rejected us for. */
function versionRejection(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { error, supported } = body as { error?: unknown; supported?: unknown }
  if (error !== UNSUPPORTED_API_VERSION) return undefined
  return typeof supported === 'string' ? supported : ''
}
