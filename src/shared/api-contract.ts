/**
 * What the API is, in one place both sides read.
 *
 * ADR 0016 bans `/api/` path literals on a premise — *with a typed client
 * nobody has a reason to write the path* — and the skeleton (#22) landed the
 * ban without the typing: the client took any `` `/${string}` `` and asserted
 * whatever shape the caller named. This is the thing that makes the premise
 * true. A path that is not below is a type error on both sides, and the answer's
 * shape is one schema rather than a server's object literal and a client's `as`.
 *
 * **Hand-written Zod, not generated from the tables** (ADR 0007). A wire shape
 * and a column are different things that happen to agree today: the schema is
 * what the phone in the barn is promised, and it should change when somebody
 * decides it changes rather than when a migration runs.
 *
 * The schema is the *contract*, so it is also what the client parses an answer
 * with. That is the whole of "no `as T`": the type comes from the schema, and
 * so does the check that the thing on the wire matches it.
 */
import { z } from 'zod'

import { isDayString, type DayString } from './time'

/**
 * A path below the version — `/day`, not `/api/v1/day`.
 *
 * One definition, imported by the server's registration and the client alike.
 * Two copies of this is what #26 was filed about: they were the same today and
 * had nothing holding them together tomorrow.
 */
export type RoutePath = `/${string}`

/** A read: the path, and the shape of what it answers. */
export interface Read {
  readonly answers: z.ZodType
}

/**
 * A queueable write: what it takes, and what it answers.
 *
 * `accepts` is the payload *without* the idempotency key. The key is ADR 0005's
 * and belongs to every write alike, so the client adds it on the way out and
 * the server's registration adds it to the schema it parses with — neither
 * endpoint writes it down, and neither can forget it.
 *
 * An object, specifically, because that key has to be added to it.
 */
export interface Write {
  readonly accepts: z.ZodObject<z.ZodRawShape>
  readonly answers: z.ZodType
}

/**
 * What any endpoint may answer instead of its own shape: a refusal, naming
 * itself. Every one this application sends is built by `json` at the API layer
 * — `not_authorized`, `not_found`, `invalid_request` — and the client reads
 * them as an `ApiError` rather than parsing them, so this is a type and not a
 * schema.
 */
export interface Failure {
  readonly error: string
}

/** The endpoints of one version, as both sides see them. */
export interface Contract {
  readonly reads: Readonly<Record<RoutePath, Read>>
  readonly writes: Readonly<Record<RoutePath, Write>>
}

/**
 * The day, in the organisation's timezone.
 *
 * The one endpoint the client cannot do without: a browser deriving its own day
 * is right for most of the year and wrong at the edges that matter, which is
 * ADR 0007's day-boundary rule seen from the phone.
 */
export const day = z.object({
  // The branded day, not a string that looks like one: a `DayString` is what
  // the server resolved in the organisation's timezone (ADR 0007), and a
  // contract that promises `string` promises less than the code already keeps.
  day: z.custom<DayString>((value) => typeof value === 'string' && isDayString(value), {
    message: 'not a YYYY-MM-DD day',
  }),
  timeZone: z.string(),
  organisation: z.string(),
})

export const contract = {
  reads: {
    '/day': { answers: day },
  },
  // Empty, and it stays empty until a write exists. A contract entry for an
  // endpoint no handler serves would be the drift this module was built to
  // remove, written the other way round.
  writes: {},
} as const satisfies Contract

/** The reads a contract declares, as a path type. */
export type ReadPath<C extends Contract> = keyof C['reads'] & RoutePath

/** The writes a contract declares, as a path type. */
export type WritePath<C extends Contract> = keyof C['writes'] & RoutePath

/** What a read answers, as the caller receives it. */
export type Answers<C extends Contract, P extends ReadPath<C>> = z.output<C['reads'][P]['answers']>

/** What a write answers, as the caller receives it. */
export type AnswersWrite<C extends Contract, P extends WritePath<C>> = z.output<
  C['writes'][P]['answers']
>

/** What a write takes, before its idempotency key is added (ADR 0005). */
export type Accepts<C extends Contract, P extends WritePath<C>> = z.input<C['writes'][P]['accepts']>

/** What a read's handler must answer with, or a refusal. */
export type Sends<C extends Contract, P extends ReadPath<C>> =
  | z.input<C['reads'][P]['answers']>
  | Failure

/** What a write's handler must answer with, or a refusal. */
export type SendsWrite<C extends Contract, P extends WritePath<C>> =
  | z.input<C['writes'][P]['answers']>
  | Failure

/** What a write's handler receives: the payload it declared, and the key. */
export type Received<C extends Contract, P extends WritePath<C>> = z.output<
  C['writes'][P]['accepts']
> & { readonly idempotencyKey: string }
