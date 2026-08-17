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
import { z } from 'zod'

import {
  contract,
  type Accepts,
  type Answers,
  type AnswersWrite,
  type Contract,
  type ReadPath,
  type RoutePath,
  type WritePath,
} from './api-contract'

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

/**
 * The other direction: this build speaks a version *newer* than the server
 * serves. That is what a rolling deploy looks like from a container that has
 * not been replaced yet, and what a rollback looks like from a phone that
 * already loaded the newer bundle.
 *
 * Its own class because the queue must do the opposite of what it does with
 * `OutdatedClientError`: **this write stays queued.** The condition ends by
 * itself, without the volunteer doing anything, as soon as the deploy finishes
 * or the rollback is rolled forward — and a write dropped in that window is an
 * "I fed Apollo" that never arrives, which is the failure ADR 0005 exists to
 * prevent. There is nothing to tell the volunteer, because there is nothing
 * for them to do.
 */
export class OutdatedServerError extends ApiError {
  constructor(
    status: number,
    body: unknown,
    readonly supported: string,
  ) {
    super(status, body)
    this.name = 'OutdatedServerError'
    this.message = `this client speaks ${API_VERSION}; the server still serves ${supported}`
  }
}

/**
 * The server answered, and what it said is not what this version's contract
 * says that endpoint answers.
 *
 * Its own class for the same reason the two above are: the queue has to know
 * what to do with it, and the answer is *drop it and report it*. Retrying
 * cannot make a mismatched shape match, and rendering it would be the client
 * guessing at what the server meant — which is the accepted-and-misinterpreted
 * outcome ADR 0007 puts the version in the path to prevent.
 */
export class UnreadableAnswerError extends ApiError {
  constructor(
    status: number,
    body: unknown,
    readonly because: string,
  ) {
    super(status, body)
    this.name = 'UnreadableAnswerError'
    this.message = `the server's answer is not the shape this client was promised: ${because}`
  }
}

/**
 * A client bound to one contract.
 *
 * Generic over it rather than reading the module's own, so that the tests of
 * this module's decisions can bind a contract of their own — the alternative
 * is endpoints in the real contract that exist for the tests, which is the
 * drift the contract was built to remove.
 */
export interface ApiClient<C extends Contract> {
  /** A read. The path must be one the contract declares, and the answer is its shape. */
  get<P extends ReadPath<C>>(path: P, init?: RequestInit): Promise<Answers<C, P>>

  /**
   * A queueable write. The idempotency key is minted here, once, before the
   * first attempt — mint it per attempt and every retry looks like a new event,
   * which is the bug ADR 0005 exists to prevent. **The queue replays through
   * this same call**, passing the key it kept, so a replay cannot drift from
   * the write it is replaying: there is one place that builds the body, and it
   * is this one.
   */
  post<P extends WritePath<C>>(
    path: P,
    body: Accepts<C, P>,
    options?: { idempotencyKey?: string },
  ): Promise<AnswersWrite<C, P>>
}

export function createClient<C extends Contract>(against: C): ApiClient<C> {
  async function get<P extends ReadPath<C>>(
    path: P,
    init: RequestInit = {},
  ): Promise<Answers<C, P>> {
    const read = declared(against.reads[path], path)
    return (await send(path, { ...init, method: 'GET' }, read.answers)) as Answers<C, P>
  }

  async function post<P extends WritePath<C>>(
    path: P,
    body: Accepts<C, P>,
    options: { idempotencyKey?: string } = {},
  ): Promise<AnswersWrite<C, P>> {
    const write = declared(against.writes[path], path)
    const answered = await send(
      path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The key is written last so that a field in `body` cannot shadow it:
        // a write whose key came from its own payload is a write with no key.
        body: JSON.stringify({
          ...(body as Record<string, unknown>),
          idempotencyKey: options.idempotencyKey ?? newIdempotencyKey(),
        }),
      },
      write.answers,
    )
    return answered as AnswersWrite<C, P>
  }

  return { get, post }
}

/**
 * The endpoint, or a refusal to guess.
 *
 * Unreachable through the types, and reachable from JavaScript and from a
 * contract annotated `Contract` rather than `satisfies Contract` — whose index
 * signature says every path exists. Saying so is better than a `TypeError`
 * about `undefined` three frames down.
 */
function declared<T>(endpoint: T | undefined, path: RoutePath): T {
  if (endpoint === undefined) {
    throw new Error(`No endpoint is declared at ${path}. Add it to the API contract.`)
  }
  return endpoint
}

/** The client this build talks to its own server with. */
export const client = createClient(contract)

/**
 * A fresh idempotency key, for a write on its way into the queue — minted once,
 * before the first attempt, and kept for every replay (ADR 0005).
 *
 * The one place a key is made: `post` calls this rather than minting its own,
 * so the queue that hands one in and the write that had one made for it get
 * the same thing.
 */
export function newIdempotencyKey(): string {
  return uuidv7()
}

async function send(path: RoutePath, init: RequestInit, answers: z.ZodType): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, init)
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const rejected = versionRejection(body)
    throw rejected === undefined
      ? new ApiError(response.status, body)
      : versionError(response.status, body, rejected)
  }

  // Parsed, not asserted. `as T` is a promise about the wire made by whoever
  // was writing the call site, and the wire is the one place in this system
  // where both ends were built at different times (ADR 0007).
  const read = answers.safeParse(body)
  if (!read.success) {
    throw new UnreadableAnswerError(response.status, body, z.prettifyError(read.error))
  }
  return read.data
}

/** The version the server serves, if that is what it just said it rejected us for. */
function versionRejection(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { error, supported } = body as { error?: unknown; supported?: unknown }
  if (error !== UNSUPPORTED_API_VERSION) return undefined
  return typeof supported === 'string' ? supported : ''
}

/**
 * Which side is out of date, which the server cannot say and only the client
 * can work out. One response carries both cases — the server answers
 * `unsupported_api_version` to a phone behind it and to a phone ahead of it
 * alike — and they need opposite things from the queue. Reading every one of
 * them as *your client is too old* throws away writes that the next attempt
 * would have delivered.
 */
function versionError(status: number, body: unknown, supported: string): ApiError {
  // The server named this build's own version and rejected us anyway, so the
  // fault is in the path rather than in the bundle: `/api//v1/day` gets this,
  // from a proxy that left a doubled slash behind when it stripped a prefix.
  // Reloading fixes nothing and neither does retrying, so it stays an ordinary
  // rejection instead of being dressed as a version problem — and, in
  // particular, does not tell the volunteer their app is out of date when it
  // is the only version there is.
  if (supported === API_VERSION) return new ApiError(status, body)

  const ours = versionOrdinal(API_VERSION)
  const theirs = versionOrdinal(supported)
  if (ours !== null && theirs !== null && theirs < ours) {
    return new OutdatedServerError(status, body, supported)
  }

  // Everything else, including a version this build cannot compare against:
  // a rejection naming nothing, or naming something that is not a version, is
  // a server worth fixing rather than a reason to keep a write in the queue
  // forever. The direction that costs a volunteer their work is the one we do
  // not guess at.
  return new OutdatedClientError(status, body, supported)
}

/**
 * The number in a version segment — `v1` is 1 — or `null` for anything this
 * build cannot order against itself, which is neither ahead nor behind.
 */
function versionOrdinal(version: string): number | null {
  const digits = /^v(\d+)$/.exec(version)
  return digits === null ? null : Number(digits[1])
}
