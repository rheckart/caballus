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

export const API_BASE = '/api/v1'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${String(status)} from the API`)
    this.name = 'ApiError'
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
    throw new ApiError(response.status, body)
  }
  return body as T
}
