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

import { ATTENDANCE_CATEGORIES } from './attendance'
import { DOMAIN_SCOPES } from './domain-scopes'
import { ROUTES, SHIFT_TYPES } from './feed-schedule'
import {
  ITEM_KINDS,
  TASK_ASSIGNMENT_STANCES,
  TASK_PERIODS,
  TASK_PRIORITIES,
  TASK_SUBJECT_KINDS,
} from './materialization'
import { MEASUREMENT_KINDS, MEASUREMENT_METHODS } from './measurements'
import { OBSERVATION_DISPOSITIONS, OBSERVATION_SUBJECT_KINDS } from './observations'
import { PRODUCT_KINDS } from './products'
import { ROLES } from './roles'
import { ROSTER_GAPS } from './rostering'
import { SPACE_KINDS } from './spaces'
import { STAFFING_GAPS } from './staffing'
import {
  ASSIGNABLE_POSITIONS,
  ROSTER_END_KINDS,
  ROSTER_ORIGINS,
  SHIFT_POSITIONS,
  SHIFT_STATES,
  SHIFT_TYPES_INCLUDING_POP_UP,
  STAFFING_MODES,
  WEEKDAYS,
  isTimeOfDay,
} from './shifts'
import {
  CONDITIONS,
  CONDITION_SCOPES,
  METRICS,
  STANCES,
  THRESHOLD_KINDS,
  THRESHOLD_SOURCES,
  UNRESOLVED_REASONS,
  WEATHER_PROVIDERS,
} from './weather'
import { isDayString, type DayString } from './time'

/**
 * A day the server resolved in the organisation's timezone (ADR 0007), branded
 * rather than `z.string()`.
 *
 * One definition for every endpoint that carries one, in either direction: a
 * contract promising `string` promises less than the code already keeps, and
 * seven copies of this custom check would be seven chances for one of them to
 * be laxer than the rest.
 */
export const dayOfTheOrganisation = z.custom<DayString>(
  (value) => typeof value === 'string' && isDayString(value),
  { message: 'not a YYYY-MM-DD day' },
)

/**
 * A path below the version — `/day`, not `/api/v1/day`.
 *
 * One definition, imported by the server's registration and the client alike.
 * Two copies of this is what #26 was filed about: they were the same today and
 * had nothing holding them together tomorrow.
 */
export type RoutePath = `/${string}`

/**
 * The `:name` segments of a path, as a union — `/horses/:horseId` gives
 * `'horseId'`, and a path with none gives `never`.
 *
 * ADR 0021 named this gap on purpose: it declared a parameterised path legal
 * in the contract and left the client unable to call one without the caller
 * writing the literal `:horseId`, deferred until an endpoint needed it. This
 * ticket's horse profile is that endpoint.
 */
export type PathParamNames<P extends string> = P extends `${string}:${infer Param}/${infer Rest}`
  ? Param | PathParamNames<`/${Rest}`>
  : P extends `${string}:${infer Param}`
    ? Param
    : never

/** The params object a path needs to be interpolated — `never` names give `Record<string, never>`, so a plain path takes none. */
export type PathParams<P extends string> = [PathParamNames<P>] extends [never]
  ? Record<string, never>
  : { readonly [K in PathParamNames<P>]: string }

/** A read: the path, and the shape of what it answers. */
export interface Read {
  readonly answers: z.ZodType
}

/**
 * A write: what it takes, and what it answers.
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
  /**
   * **This write must never be queued** — ADR 0011's carve-out from ADR 0005,
   * restated by ADR 0018 as *the app queues when it is the ledger, and does not
   * queue when it is the medium*.
   *
   * A tick, an Attendance, an Observation are true whether or not the app knows
   * — the queue is transport for a fact that already exists in the world. A
   * Cover and a Drop are **not true until they arrive**: two volunteers each
   * looking at their own phone, each seeing that they have Thursday covered, is
   * a Thursday with nobody on it. So they are online-only writes, and the phone
   * says so plainly when one cannot be sent.
   *
   * Declared here rather than remembered by whoever builds the queue, because
   * the queue is a later ticket and this is the contract both sides read
   * (ADR 0021). The key still travels: it is what stops a double tap becoming
   * two Covers, which is a different problem from replaying one from a pocket
   * on Thursday.
   */
  readonly neverQueued?: true
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
  day: dayOfTheOrganisation,
  timeZone: z.string(),
  organisation: z.string(),
})

/**
 * Who the session says is asking.
 *
 * A Volunteer and their Domain Scopes, never an Account: ADR 0010 hangs
 * authorization off the person the barn knows, and the Better Auth user in the
 * middle is not a thing the phone has any use for.
 *
 * There is no signed-out shape here on purpose. A signed-out request gets the
 * explicit denial every other read gets — `401 not_authorized` — because a
 * body saying `{ signedIn: false }` would be a second way of expressing the
 * same fact, and the client would then have two of them to keep in step.
 */
export const me = z.object({
  volunteerId: z.string(),
  name: z.string(),
  domainScopes: z.array(z.enum(DOMAIN_SCOPES)),
})

/**
 * A Volunteer as the people list carries them.
 *
 * **Two tiers in one object, and the split is ADR 0010's floor.** Everything at
 * the top level is readable by every Volunteer, because it is all on a wall in
 * a barn that every volunteer walks into. `behindRoster` is `null` for a reader
 * who does not hold `roster` — absent rather than empty, so a screen cannot
 * mistake *you may not see this* for *there is nothing here*.
 *
 * The date of birth is the one that took an ADR to place. Day and month are on
 * the floor because that is what a birthday is and the rescue has a party; the
 * **year** and the age derived from it are the whole of the sensitive part and
 * the whole of the gate input, so they sit behind `roster` with contact
 * details. Under-18 is on the floor and **as a state**: a Lead needs to know a
 * minor is a minor, not that she is fifteen (ADR 0017).
 */
export const person = z.object({
  id: z.string(),
  name: z.string(),
  /** `candidate` until the Orientation. The word stops there. */
  state: z.enum(['candidate', 'volunteer']),
  rosterable: z.boolean(),
  /**
   * Which gate is open. This is the **flag** a failing gate raises: nothing is
   * auto-removed from a roster, ever, so this is what the Coordinator and the
   * Lead see instead (ADR 0017).
   */
  gaps: z.array(z.enum(ROSTER_GAPS)),
  isMinor: z.boolean(),
  birthday: z.object({ month: z.number(), day: z.number() }).nullable(),
  roles: z.array(z.enum(ROLES)),
  domainScopes: z.array(z.enum(DOMAIN_SCOPES)),
  /** The qualification, which is not a Domain Scope (ADR 0010). */
  medicationAuthority: z.boolean(),
  hasAccount: z.boolean(),
  consentIsHistorical: z.boolean(),
  behindRoster: z
    .object({
      email: z.string(),
      mobile: z.string().nullable(),
      dateOfBirth: dayOfTheOrganisation.nullable(),
      dateOfBirthProvenance: z.string().nullable(),
      age: z.number().nullable(),
      turnsEighteenOn: dayOfTheOrganisation.nullable(),
      orientedOn: dayOfTheOrganisation.nullable(),
      consentedOn: dayOfTheOrganisation.nullable(),
      parentName: z.string().nullable(),
      signatures: z.array(
        z.object({
          id: z.string(),
          versionLabel: z.string(),
          signedOn: dayOfTheOrganisation,
          byParent: z.boolean(),
          revoked: z.boolean(),
        }),
      ),
    })
    .nullable(),
})

export const people = z.object({
  /**
   * The day the gates were derived against, carried so the screen shows what
   * the server decided rather than deriving a second answer in the browser's
   * timezone (ADR 0007).
   */
  today: dayOfTheOrganisation,
  people: z.array(person),
  /**
   * Scopes **no non-officer holds**. A staffing problem to show, not an
   * authorization state to model — because officers hold every scope, no scope
   * is ever literally vacant and routing never has nowhere to go. `supplies`
   * standing here is the app asking the rescue a question it has not answered.
   */
  unstaffedScopes: z.array(z.enum(DOMAIN_SCOPES)),
})

export const releaseVersionList = z.object({
  /** Newest first; the current one is the first. */
  versions: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      validFrom: dayOfTheOrganisation,
      obsoletesPrior: z.boolean(),
    }),
  ),
})

/** The audit log, behind `roster` with contact details (ADR 0010). */
export const auditLog = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      /** Epoch milliseconds. A day belongs to the organisation, and this is not one. */
      recordedAt: z.number(),
      actorVolunteerId: z.string().nullable(),
      entity: z.string(),
      entityId: z.string(),
      field: z.string().nullable(),
      before: z.string().nullable(),
      after: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
})

/** A Space, as the wire carries its kind (ADR 0002). */
const spaceKind = z.enum(SPACE_KINDS)

const spaceRef = z.object({ id: z.string(), name: z.string() })

/** One Space: a kind, a name, and who currently holds it — visible even at zero (ADR 0002). */
export const space = z.object({
  id: z.string(),
  kind: spaceKind,
  name: z.string(),
  occupants: z.array(z.object({ id: z.string(), name: z.string() })),
})

export const spaceList = z.object({ spaces: z.array(space) })

/** What a Product is, a fact about the Product and not about where it was written down (ADR 0019). */
const productKind = z.enum(PRODUCT_KINDS)

/** What kind of work a Shift is; only the three that carry a Feed Schedule (`CONTEXT.md`). */
const shiftType = z.enum(SHIFT_TYPES)

/** How a Product reaches the horse — a syringe medication is visibly not in-feed (`CONTEXT.md`). */
const route = z.enum(ROUTES)

/** Where a Product comes from (ADR 0019, `CONTEXT.md`'s Supplier). It never points at a Contact. */
export const supplier = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().nullable(),
  note: z.string().nullable(),
})

export const supplierList = z.object({ suppliers: z.array(supplier) })

/**
 * A posted number: who to phone, the hours it is answered, and what it is for
 * (`CONTEXT.md`'s Contacts; ADR 0014). It carries no field that could let an
 * Escalation resolve to it — the app never dials or routes to this screen.
 */
export const contact = z.object({
  id: z.string(),
  name: z.string(),
  number: z.string(),
  /** Display text a person reads at 2am, not a modelled availability window (ADR 0014). */
  hours: z.string().nullable(),
  purpose: z.string(),
})

/** A rescue-wide safety rule belonging to no Task and no Space (ADR 0018). */
export const standingRule = z.object({ id: z.string(), text: z.string() })

export const contactsPage = z.object({
  contacts: z.array(contact),
  standingRules: z.array(standingRule),
})

/**
 * The catalogue (ADR 0019, `CONTEXT.md`'s Product). `supplierName` rides along
 * so a list renders without a second read; the id is what a Feed Schedule line
 * names.
 */
export const product = z.object({
  id: z.string(),
  name: z.string(),
  kind: productKind,
  supplierId: z.string().nullable(),
  supplierName: z.string().nullable(),
  prescription: z.boolean(),
  reorderPointDays: z.number().nullable(),
  orderingNote: z.string().nullable(),
})

export const productList = z.object({ products: z.array(product) })

/** One Feed Schedule line: a Product, an amount and a Route (`CONTEXT.md`'s Feed Schedule). */
const feedScheduleLine = z.object({
  productId: z.string(),
  productName: z.string(),
  productKind,
  amount: z.string(),
  route,
})

/**
 * The current Feed Schedule for one horse at one Shift Type — only the Shift
 * Types that actually have one appear, so a horse with no Lunch feeding simply
 * has no `lunch` entry (#36's Dawson-and-Apollo case).
 */
const feedSchedule = z.object({
  shiftType,
  validFrom: dayOfTheOrganisation,
  /** Derived from `validFrom` against today, and ageing out on its own (`CONTEXT.md`'s New). */
  isNew: z.boolean(),
  lines: z.array(feedScheduleLine),
})

const measurementKind = z.enum(MEASUREMENT_KINDS)
const measurementMethod = z.enum(MEASUREMENT_METHODS)

/** One weight entry — append-only, and carrying the noise floor's own field: how it was taken. */
const weightEntry = z.object({
  id: z.string(),
  value: z.number(),
  method: measurementMethod.nullable(),
  takenOn: dayOfTheOrganisation,
  recordedBy: z.string().nullable(),
})

/** One body-condition entry — the same shape, minus the weight-only method. */
const bodyConditionEntry = z.object({
  id: z.string(),
  value: z.number(),
  takenOn: dayOfTheOrganisation,
  recordedBy: z.string().nullable(),
})

/** Both measurement series for one horse, oldest first (ADR 0003's measurement tier). */
const horseMeasurements = z.object({
  weights: z.array(weightEntry),
  bodyConditions: z.array(bodyConditionEntry),
})

/**
 * A horse, as ADR 0003's current-state tier and #32's stories carry it for
 * this ticket. `photoUrl` is where the photo is hosted, not the photo itself —
 * this application has no object storage yet (the same gap #34 left the
 * release template pointing at). Alerts is deliberately absent: nothing writes
 * one yet, and the profile screen holds a place for it rather than this
 * schema inventing a field nobody populates.
 */
export const horse = z.object({
  id: z.string(),
  name: z.string(),
  halterColour: z.string().nullable(),
  blanketSize: z.string().nullable(),
  height: z.string().nullable(),
  photoUrl: z.string().nullable(),
  /** A date, never a delete (ADR 0002). `null` for a horse still at the rescue. */
  departedOn: dayOfTheOrganisation.nullable(),
  spaces: z.object({
    stall: spaceRef.nullable(),
    field: spaceRef.nullable(),
    barn: spaceRef.nullable(),
  }),
})

export const horseList = z.object({ horses: z.array(horse) })

/**
 * The single-horse read, carrying what the list does not: the current Feed
 * Schedule per Shift Type and both measurement series, in one round trip
 * rather than three on a connection that mostly works (#36). The list stays
 * `horse` above — a directory of sixty rows has no use for another horse's
 * feed lines, and the phone's list screen never asked for them.
 */
export const horseProfile = horse.extend({
  /** Only the Shift Types this horse currently has a schedule for (#36). */
  feedSchedules: z.array(feedSchedule),
  measurements: horseMeasurements,
})

/**
 * A horse as one row of the Board carries it (`CONTEXT.md`'s Board; #37).
 *
 * The feeding is `feedSchedule` itself rather than a shape of its own: the
 * grid's cell and the profile's section are the same fact read at two
 * distances, and two schemas for it would be two chances to disagree about
 * what a Route is.
 *
 * **No Alerts field**, for the reason `horse` above has none: nothing writes an
 * Alert yet, and the Board holds the column rather than this schema inventing a
 * field nobody populates (#35).
 *
 * No blanket size and no height either, though the whiteboard's rows carry
 * both: #37 names what this surface shows, the grid does not show them, and a
 * promise nothing reads is a promise that goes stale unwitnessed. They are one
 * tap away on the profile, and this schema gains them the day the Board renders
 * them.
 */
const boardHorse = z.object({
  id: z.string(),
  name: z.string(),
  halterColour: z.string().nullable(),
  field: spaceRef.nullable(),
  feedings: z.array(feedSchedule),
})

/**
 * One row: a Stall, the horse in it, or a Stall with no horse — which is how
 * the OPEN stall keeps its row (ADR 0002). A horse with no Stall has a row
 * with no Stall on it, in its barn's section.
 */
const boardRow = z.object({
  stall: spaceRef.nullable(),
  horse: boardHorse.nullable(),
})

/** What a number is measured in, and whose scale it was set against (ADR 0015). */
const metric = z.enum(METRICS)
const weatherProvider = z.enum(WEATHER_PROVIDERS)
const thresholdKind = z.enum(THRESHOLD_KINDS)

/**
 * One Threshold in force: the number, and where it came from.
 *
 * `value` is null exactly when the stance is `follows_default` — a horse
 * deliberately on the rescue's number holds no number of its own, because one
 * copied here would stop moving when the default did (ADR 0015).
 */
const thresholdRecord = z.object({
  kind: thresholdKind,
  stance: z.enum(STANCES),
  value: z.number().nullable(),
  metric,
  provider: weatherProvider,
  validFrom: dayOfTheOrganisation,
  /** Derived from `validFrom` against today, and ageing out on its own (`CONTEXT.md`'s New). */
  isNew: z.boolean(),
})

/**
 * One horse's numbers, and what is still owed on it.
 *
 * `undecided` is the third state made visible: a per-horse kind with no record
 * is an unanswered question rather than agreement with the default, and the
 * screen has to be able to say so (ADR 0015).
 */
const horseThresholds = z.object({
  horseId: z.string(),
  horseName: z.string(),
  records: z.array(thresholdRecord),
  undecided: z.array(thresholdKind),
})

export const thresholds = z.object({
  today: dayOfTheOrganisation,
  /** The rescue-wide numbers — the board's *Rest of Horses*, as a real record. */
  defaults: z.array(thresholdRecord),
  horses: z.array(horseThresholds),
})

/** One hour of the series a Reading read, kept raw (#6, ADR 0015). */
const readingHour = z.object({
  /** Epoch milliseconds. A day belongs to the organisation, and this is not one. */
  at: z.number(),
  day: dayOfTheOrganisation,
  /** Hour of the day, 0–23, in the organisation's timezone. */
  hour: z.number(),
  airTempF: z.number().nullable(),
  /** Null where the provider carried none — the fallback carries no apparent temperature. */
  apparentTempF: z.number().nullable(),
  precipitation: z.boolean().nullable(),
})

/**
 * What a Reading resolved to, per (Condition, subject).
 *
 * `holds` is nullable and that is the point: a Condition the forecast could not
 * answer is **not a false one**, and `unresolved` says which of the three
 * reasons stopped it (ADR 0015).
 */
const conditionResolution = z.object({
  condition: z.enum(CONDITIONS),
  horseId: z.string().nullable(),
  horseName: z.string().nullable(),
  scope: z.enum(CONDITION_SCOPES),
  holds: z.boolean().nullable(),
  unresolved: z.enum(UNRESOLVED_REASONS).nullable(),
  metric,
  thresholdValue: z.number().nullable(),
  thresholdSource: z.enum(THRESHOLD_SOURCES).nullable(),
  /** The number off the forecast that decided it — *Dawson: 38 °F, sheets under 50°*. */
  readingValue: z.number().nullable(),
  atHour: z.number().nullable(),
})

/**
 * The weather as it stood when the day was fixed (`CONTEXT.md`'s Reading).
 *
 * Carried whole rather than as the decision it produced, and **the provider is
 * named**: the rescue has no single authoritative source today, so a Board that
 * says 96 while a volunteer's phone says 89 has to be able to say whose number
 * it is showing (ADR 0015).
 */
export const reading = z.object({
  id: z.string(),
  day: dayOfTheOrganisation,
  provider: weatherProvider,
  fellBackFrom: weatherProvider.nullable(),
  fellBackBecause: z.string().nullable(),
  stale: z.boolean(),
  fetchedAt: z.number(),
  hours: z.array(readingHour),
  conditions: z.array(conditionResolution),
})

export const weather = z.object({
  day: dayOfTheOrganisation,
  /** Null where nothing has fixed today's weather yet — an unanswered question, not a calm day. */
  reading: reading.nullable(),
})

/**
 * News about the rescue, belonging to no Shift and no horse (`CONTEXT.md`'s
 * Announcement; ADR 0018). **No subject field exists**, on either the read or
 * the write below — the type is the refusal ADR 0018 asks for.
 */
export const announcement = z.object({
  id: z.string(),
  text: z.string(),
  expiresOn: dayOfTheOrganisation,
  authoredBy: z.string(),
  authoredByName: z.string(),
  /** Epoch milliseconds. */
  authoredAt: z.number(),
  lastEditedBy: z.string().nullable(),
  lastEditedByName: z.string().nullable(),
  /** Epoch milliseconds, or null before the first edit. */
  lastEditedAt: z.number().nullable(),
})

export const announcementList = z.object({
  today: dayOfTheOrganisation,
  /** Unexpired only, newest posted first — what has already left the wall is not here (ADR 0018). */
  announcements: z.array(announcement),
})

/** The stalls in stall order, then each barn that holds horses without one. */
const boardSection = z.object({ heading: z.string(), rows: z.array(boardRow) })

/**
 * The whole screen in one read, ordered by the server.
 *
 * The tablet repaints all of it every minute; a grid stitched from four reads
 * is four chances for one part of the wall to be a minute older than the rest.
 * There is no `asOf` here on purpose — the screen times its own successful
 * polls, which is an elapsed measurement rather than a comparison between two
 * clocks that a barn tablet has no reason to have agreeing.
 */
export const board = z.object({
  today: dayOfTheOrganisation,
  sections: z.array(boardSection),
  /**
   * Today's Reading and what it resolved to, so *staying in* is visible across
   * the barn (#38). The whole Reading rather than a shape of its own, for the
   * reason the grid carries `feedSchedule` itself: the panel and the weather
   * screen are the same fact read at two distances.
   */
  weather: reading.nullable(),
  /**
   * Unexpired Announcements, the whiteboard's missing panel (#46, ADR 0018) —
   * the same shape and the same read `/announcements` answers with, because
   * the Board and the home screen are the same wall read at two distances.
   */
  announcements: z.array(announcement),
})

/** The day of the week a Shift Pattern recurs on — a word, never a number (ADR 0001). */
const weekday = z.enum(WEEKDAYS)

/** What kind of work a Shift is, Pop-up included (`CONTEXT.md`'s Shift Type). */
const anyShiftType = z.enum(SHIFT_TYPES_INCLUDING_POP_UP)

/** `HH:MM` on the barn's own clock. Not an instant: a Shift starts at six whatever the clocks did. */
const timeOfDay = z.string().refine(isTimeOfDay, { message: 'not a HH:MM time of day' })

/** What somebody may be assigned to; `acting_lead` is claimed, never assigned (ADR 0010). */
const assignablePosition = z.enum(ASSIGNABLE_POSITIONS)

/**
 * One person on a roster, with the gate derived against today beside them.
 *
 * `rosterable` and `gaps` ride along because gating happens at assignment and
 * never at generation (ADR 0011): somebody who went stale after being assigned
 * is still on the Shift, and the screen has to be able to flag that rather than
 * the app quietly dropping them (ADR 0017).
 */
const rosterMember = z.object({
  volunteerId: z.string(),
  name: z.string(),
  position: z.enum(SHIFT_POSITIONS),
  rosterable: z.boolean(),
  gaps: z.array(z.enum(ROSTER_GAPS)),
})

/** A Shift Pattern and the Standing Roster it will copy onto every Shift it generates. */
const shiftPattern = z.object({
  id: z.string(),
  weekday,
  shiftType: anyShiftType,
  startTime: timeOfDay,
  targetHeadcount: z.number(),
  retired: z.boolean(),
  roster: z.array(rosterMember),
})

export const shiftPatternList = z.object({
  today: dayOfTheOrganisation,
  patterns: z.array(shiftPattern),
})

/** One person on one dated Shift: how they got there, and whether they still stand. */
const shiftRosterMember = rosterMember.extend({
  origin: z.enum(ROSTER_ORIGINS),
  /**
   * The qualification, which is a grant on the Volunteer and never a position
   * on this Shift (ADR 0010). Beside the name because *nobody who can give
   * medication* is a sentence the screen has to be able to make concrete, and
   * because an acting Lead without it still cannot medicate.
   */
  medicationAuthority: z.boolean(),
  /**
   * Null while the commitment stands. *Rostered and dropped* is not *never
   * rostered*, and the row is marked rather than removed so both stay
   * answerable (ADR 0011).
   */
  endedAs: z.enum(ROSTER_END_KINDS).nullable(),
  endedReason: z.string().nullable(),
})

/**
 * What the app **computes** about a Shift's staffing (ADR 0011).
 *
 * The internal names cross the wire because the derivation is the server's;
 * `staffingFact` in `src/shared/staffing.ts` is what a screen renders, and the
 * phrase *staffing gap* appears on none of them.
 */
const shiftStaffing = z.object({
  gaps: z.array(z.enum(STAFFING_GAPS)),
  /**
   * Whom to offer the Acting Lead claim to first — Medication Authority, then
   * tenure — or null where somebody already carries Shift Authority. A
   * suggestion and never a restriction: the endpoint takes the claim from
   * anybody rostered (ADR 0010).
   */
  suggestedActingLead: z.string().nullable(),
})

/**
 * What a person **declared** about it, which is a different thing entirely.
 *
 * Null until somebody says so, and null again once somebody clears it: *nobody
 * has said this Shift is short* is not *somebody said it and took it back*, and
 * neither is arithmetic. It carries the actor and the time because it is a
 * judgement somebody is accountable for (ADR 0011).
 */
const declaredShort = z.object({
  /** Epoch milliseconds. A day belongs to the organisation, and this is not one. */
  declaredAt: z.number(),
  declaredBy: z.string().nullable(),
})

/**
 * Arrival and departure only, floor-readable so a Lead can see who has
 * arrived without a `roster` grant (ADR 0012). The full ledger — description,
 * category, who recorded it, the Supervising Adult — is `/attendance`, behind
 * `roster`.
 */
const shiftAttendanceMember = z.object({
  volunteerId: z.string(),
  /** Epoch milliseconds. */
  arrivedAt: z.number(),
  departedAt: z.number().nullable(),
})

/**
 * One dated Shift (`CONTEXT.md`'s Shift).
 *
 * `state` is derived from the clock rather than stored, and there is no
 * `cancelled`: the property is never closed, so a Shift nobody can staff is
 * still a Shift, still visible and escalating (ADR 0001).
 */
const shift = z.object({
  id: z.string(),
  /** Null for a Pop-up, which is an occurrence of nothing (ADR 0011). */
  patternId: z.string().nullable(),
  day: dayOfTheOrganisation,
  shiftType: anyShiftType,
  startTime: timeOfDay,
  targetHeadcount: z.number(),
  staffingMode: z.enum(STAFFING_MODES),
  purpose: z.string().nullable(),
  state: z.enum(SHIFT_STATES),
  roster: z.array(shiftRosterMember),
  staffing: shiftStaffing,
  short: declaredShort.nullable(),
  attendance: z.array(shiftAttendanceMember),
})

/**
 * The schedule, from today to the end of the horizon.
 *
 * One read for the Coordinator's desktop and the volunteer's phone alike: *my
 * Thursday* and *the fortnight* are the same rows at two distances, and two
 * reads would be two chances for the phone to disagree with the desk.
 */
export const shiftList = z.object({
  today: dayOfTheOrganisation,
  shifts: z.array(shift),
})

/** Who a Task or an Item is about — a horse, a Space, or the rescue as a whole (ADR 0013). */
const taskSubjectKind = z.enum(TASK_SUBJECT_KINDS)
const taskPriority = z.enum(TASK_PRIORITIES)
const taskPeriod = z.enum(TASK_PERIODS)
const taskAssignmentStance = z.enum(TASK_ASSIGNMENT_STANCES)
const itemKind = z.enum(ITEM_KINDS)
const conditionName = z.enum(CONDITIONS)

/**
 * A Task, exactly as the rescue may edit it (ADR 0013). What it may choose
 * among is fixed — subject kind, priority, period, whether it needs
 * Medication Authority, an optional Condition gate, an optional Prep target, a
 * nullable tolerance, the closing flag, and instruction text — and this is
 * the whole of it; there is no ninth field to invent.
 */
export const task = z.object({
  id: z.string(),
  subjectKind: taskSubjectKind,
  priority: taskPriority,
  period: taskPeriod,
  requiresMedicationAuthority: z.boolean(),
  conditionName: conditionName.nullable(),
  prepForShiftType: shiftType.nullable(),
  /** Nullable, in this Task's own `period` unit — null means never overdue. */
  toleranceCount: z.number().nullable(),
  closing: z.boolean(),
  instructionText: z.string(),
})

export const taskList = z.object({ tasks: z.array(task) })

/** One Subject a Task Assignment may name — a horse or a Space, carrying its name for a screen to render. */
const taskAssignmentSubject = z.object({
  horseId: z.string().nullable(),
  spaceId: z.string().nullable(),
  name: z.string(),
})

/** One Task Assignment in force: which Shift Type normally does a Task for one Subject (ADR 0013, ADR 0015's tri-state). */
const taskAssignmentRecord = taskAssignmentSubject.extend({
  stance: taskAssignmentStance,
  /** Set exactly when `stance` is `assigned`. */
  shiftType: shiftType.nullable(),
  /** Subject-specific instruction text, shown second on the Item. */
  instructionText: z.string().nullable(),
  validFrom: dayOfTheOrganisation,
})

/**
 * One Task's Assignments, and the Subjects nobody has decided for yet.
 *
 * `undecided` is the unanswered question rendered as one — never as no work
 * (ADR 0013) — the same discipline `HorseThresholds.undecided` follows for a
 * Threshold nobody has set.
 */
const taskAssignmentsForTask = z.object({
  taskId: z.string(),
  assignments: z.array(taskAssignmentRecord),
  undecided: z.array(taskAssignmentSubject),
})

export const taskAssignmentList = z.object({
  today: dayOfTheOrganisation,
  tasks: z.array(taskAssignmentsForTask),
})

/**
 * One materialized Item, as a Shift's checklist carries it (ADR 0013): the
 * frozen decision, with the Subject's name carried along so a card renders
 * without a second read.
 */
const checklistItem = z.object({
  id: z.string(),
  kind: itemKind,
  subjectKind: taskSubjectKind,
  horseId: z.string().nullable(),
  horseName: z.string().nullable(),
  spaceId: z.string().nullable(),
  spaceName: z.string().nullable(),
  priority: taskPriority,
  requiresMedicationAuthority: z.boolean(),
  instructionText: z.string(),
  /** A hint for grouping — which Shift Type normally does this — never a gate (ADR 0013). */
  assignedShiftType: shiftType.nullable(),
  /** True where nobody has decided which Shift Type normally does this — an unanswered question, never no work. */
  assignmentUndecided: z.boolean(),
  prepForShiftType: shiftType.nullable(),
  closing: z.boolean(),
  conditionName: conditionName.nullable(),
})

/**
 * The checklist a Shift shows on opening (ADR 0013): its own Items, plus the
 * day's per-Day ones, and the Prep this Shift Type is owed from earlier today
 * or the day before.
 *
 * `materialized: false` with an empty `items` is a Shift whose day nothing has
 * fixed yet — an honest state rather than a live preview this ticket does not
 * build.
 */
export const shiftChecklist = z.object({
  shiftId: z.string(),
  day: dayOfTheOrganisation,
  shiftType,
  materialized: z.boolean(),
  items: z.array(checklistItem),
  prepOwed: z.array(checklistItem),
})

/** An optional note on a grant, a revocation or a correction (ADR 0010). */
const reason = z.string().max(500).nullish()

const volunteerId = z.uuid()
const horseId = z.uuid()
const spaceId = z.uuid()
const supplierId = z.uuid()
const productId = z.uuid()
const shiftId = z.uuid()
const attendanceCategory = z.enum(ATTENDANCE_CATEGORIES)

/**
 * One row of the sign-in sheet, replaced (ADR 0012): a person, an arrival, a
 * departure, an optional Shift, and — for a Visit — the job in the
 * volunteer's own words plus its category.
 *
 * `departedAt` null is an open Attendance: never invented by the app, and
 * closable only by a person recording it (ADR 0012). Everybody's name rides
 * along rather than an id alone — this is the ledger a report is built from,
 * and a screen resolving sixty names one at a time is the slowness ADR 0007's
 * roster read was written against.
 */
const attendanceRecord = z.object({
  id: z.string(),
  volunteerId: z.string(),
  volunteerName: z.string(),
  /** Null for a Visit. */
  shiftId: z.string().nullable(),
  day: dayOfTheOrganisation,
  category: attendanceCategory,
  description: z.string().nullable(),
  /** Epoch milliseconds. */
  arrivedAt: z.number(),
  arrivedBy: z.string(),
  arrivedByName: z.string(),
  departedAt: z.number().nullable(),
  departedBy: z.string().nullable(),
  departedByName: z.string().nullable(),
  /** Who supervised, as a Volunteer — distinct from who was merely present (ADR 0012). */
  supervisingAdultId: z.string().nullable(),
  supervisingAdultName: z.string().nullable(),
  supervisingAdultPhone: z.string().nullable(),
})

/**
 * The whole ledger, newest first, behind `roster` — the hours report is built
 * from this on the desktop, and it is the one Attendance read this ticket
 * puts behind that scope rather than on ADR 0010's floor (`src/server/attendance/list.ts`
 * says why).
 */
export const attendanceLedger = z.object({ entries: z.array(attendanceRecord) })

/** Where an Observation's subject came from — the closed vocabulary ADR 0014 names. */
const observationSubjectKind = z.enum(OBSERVATION_SUBJECT_KINDS)

/** The Visit's own two exits at sign-out; a Shift's third — curated into Shift Notes — is #45's. */
const observationDisposition = z.enum(OBSERVATION_DISPOSITIONS)

/**
 * One Observation: free text with an optional subject, never edited or
 * deleted once it reaches the server (`CONTEXT.md`'s Observation; ADR 0014).
 * `recordedBy` and `observedBy` differ only when Shift Authority recorded it
 * on a rostered volunteer's behalf. `escalatedScopes` names every Scope it
 * has been escalated to, without the thread each one carries — that is
 * `escalation` below, read from `/escalations`.
 */
export const observation = z.object({
  id: z.string(),
  attendanceId: z.string(),
  text: z.string(),
  subjectKind: observationSubjectKind.nullable(),
  subjectId: z.string().nullable(),
  subjectLabel: z.string().nullable(),
  recordedBy: z.string(),
  recordedByName: z.string(),
  observedBy: z.string(),
  observedByName: z.string(),
  /** Epoch milliseconds. */
  recordedAt: z.number(),
  /** Epoch milliseconds, or null while nobody has dispositioned it yet. */
  dispositionedAt: z.number().nullable(),
  disposition: observationDisposition.nullable(),
  escalatedScopes: z.array(z.enum(DOMAIN_SCOPES)),
})

export const observationList = z.object({ observations: z.array(observation) })

/** One entry in an Escalation's thread — floor-writable, before close and after (ADR 0014). */
const escalationComment = z.object({
  id: z.string(),
  text: z.string(),
  authoredBy: z.string(),
  authoredByName: z.string(),
  /** Epoch milliseconds. */
  authoredAt: z.number(),
})

/**
 * One Escalation: the escalator's own framing, addressed to exactly one
 * Domain Scope, carrying the Observation's own words and its thread whole
 * (`CONTEXT.md`'s Escalation; ADR 0014). `closedAt` null is Open; there is no
 * reopen.
 */
export const escalation = z.object({
  id: z.string(),
  observationId: z.string(),
  observationText: z.string(),
  observationSubjectLabel: z.string().nullable(),
  scope: z.enum(DOMAIN_SCOPES),
  framing: z.string(),
  escalatedBy: z.string(),
  escalatedByName: z.string(),
  /** Epoch milliseconds. */
  escalatedAt: z.number(),
  /** Epoch milliseconds, or null while Open. */
  closedAt: z.number().nullable(),
  closedBy: z.string().nullable(),
  closedByName: z.string().nullable(),
  closingNote: z.string().nullable(),
  comments: z.array(escalationComment),
})

export const escalationList = z.object({ escalations: z.array(escalation) })

const announcementId = z.uuid()
const contactId = z.uuid()
const standingRuleId = z.uuid()
const observationId = z.uuid()
const escalationId = z.uuid()

export const contract = {
  reads: {
    '/day': { answers: day },
    '/me': { answers: me },
    '/volunteers': { answers: people },
    '/release-versions': { answers: releaseVersionList },
    '/audit': { answers: auditLog },
    '/spaces': { answers: spaceList },
    '/horses': { answers: horseList },
    /** The first parameterised path — see `PathParamNames` above. */
    '/horses/:horseId': { answers: horseProfile },
    '/suppliers': { answers: supplierList },
    '/products': { answers: productList },
    /** The read-only screen of posted numbers, and the rescue's standing rules (ADR 0014). */
    '/contacts': { answers: contactsPage },
    /** Unexpired Announcements, newest posted first — the home screen's own read (#46, ADR 0018). */
    '/announcements': { answers: announcementList },
    /**
     * The Board. The one endpoint the barn's tablet may read, and the only one
     * whose authorization is not a person (ADR 0022).
     */
    '/board': { answers: board },
    /** The recurring commitments and their Standing Rosters (ADR 0001). */
    '/shift-patterns': { answers: shiftPatternList },
    /** The schedule: every Shift from today to the end of the horizon, rosters and all. */
    '/shifts': { answers: shiftList },
    /** One dated Shift's checklist — its own Items, the day's, and its Prep owed (ADR 0013). */
    '/shifts/:shiftId': { answers: shiftChecklist },
    /** The numbers the rescue owns, and the decisions still owed (ADR 0015). */
    '/thresholds': { answers: thresholds },
    /** Today's Reading, whole — the hours it read as well as what they resolved to. */
    '/weather': { answers: weather },
    /** The Task catalogue (ADR 0013). */
    '/tasks': { answers: taskList },
    /** Which Shift Type normally does which Task, and the decisions still owed (ADR 0013). */
    '/task-assignments': { answers: taskAssignmentList },
    /** The sign-in sheet, whole, behind `roster` — the hours report is built from this (ADR 0012). */
    '/attendance': { answers: attendanceLedger },
    /** One Attendance's own Observations — the Visit sign-out screen's own read (ADR 0014). */
    '/observations/:attendanceId': { answers: observationList },
    /** Every Escalation, on the floor — a holder's open ones are this same read, filtered (ADR 0014). */
    '/escalations': { answers: escalationList },
  },
  writes: {
    /**
     * The Coordinator creating a Volunteer — no Account, no code, no login
     * (ADR 0008). The email is loose rather than `z.email()` for the reason the
     * sign-in screen's is: a rescue's address book has addresses in it that a
     * validator would refuse and a volunteer still receives mail at.
     */
    '/volunteers': {
      accepts: z.object({
        name: z.string().min(1).max(200),
        email: z.string().min(1).max(320),
        mobile: z.string().max(50).nullish(),
      }),
      answers: z.object({ volunteerId: z.string() }),
    },
    '/volunteers/date-of-birth': {
      accepts: z.object({
        volunteerId,
        dateOfBirth: dayOfTheOrganisation,
        provenance: z.enum(['photo_id', 'parent_provided']),
        reason,
      }),
      answers: z.void(),
    },
    '/volunteers/orientation': {
      accepts: z.object({ volunteerId, orientedOn: dayOfTheOrganisation }),
      answers: z.void(),
    },
    '/volunteers/consent': {
      accepts: z.object({
        volunteerId,
        consentedOn: dayOfTheOrganisation,
        parentName: z.string().min(1).max(200),
      }),
      answers: z.void(),
    },
    '/volunteers/release': {
      accepts: z.object({
        volunteerId,
        releaseVersionId: z.uuid(),
        signedOn: dayOfTheOrganisation,
        byParent: z.boolean(),
      }),
      answers: z.object({ signatureId: z.string() }),
    },
    '/volunteers/release-revocation': {
      accepts: z.object({ signatureId: z.uuid(), reason }),
      answers: z.void(),
    },
    '/volunteers/removal': {
      accepts: z.object({ volunteerId, reason }),
      answers: z.void(),
    },
    '/volunteers/roles': {
      accepts: z.object({ volunteerId, role: z.enum(ROLES), reason }),
      answers: z.void(),
    },
    '/volunteers/role-revocation': {
      accepts: z.object({ volunteerId, role: z.enum(ROLES), reason }),
      answers: z.void(),
    },
    /**
     * One endpoint for both directions, because it is one qualification with
     * one state and two endpoints would let a screen ask for *granted* and
     * *revoked* in the same breath.
     */
    '/volunteers/medication-authority': {
      accepts: z.object({ volunteerId, granted: z.boolean(), reason }),
      answers: z.void(),
    },
    '/release-versions': {
      accepts: z.object({
        label: z.string().min(1).max(200),
        validFrom: dayOfTheOrganisation,
        /**
         * Whether publishing this stales every signature given before
         * `validFrom`. It flags and never removes (ADR 0017).
         */
        obsoletesPrior: z.boolean(),
      }),
      answers: z.object({ releaseVersionId: z.string() }),
    },
    '/spaces': {
      accepts: z.object({ kind: spaceKind, name: z.string().min(1).max(200) }),
      answers: z.object({ spaceId: z.string() }),
    },
    /**
     * A rename, a change of kind, or both — the whole of how splitting or
     * merging a joined Space happens: an edit by someone with the authority
     * to make it, never a gate sensor (ADR 0002).
     */
    '/spaces/edit': {
      accepts: z.object({ spaceId, kind: spaceKind, name: z.string().min(1).max(200), reason }),
      answers: z.void(),
    },
    '/horses': {
      accepts: z.object({
        name: z.string().min(1).max(200),
        halterColour: z.string().max(100).nullish(),
        blanketSize: z.string().max(100).nullish(),
        height: z.string().max(50).nullish(),
        photoUrl: z.string().max(2000).nullish(),
      }),
      answers: z.object({ horseId: z.string() }),
    },
    /** A partial edit: an omitted field is unchanged, and `null` clears one that may be (ADR 0003). */
    '/horses/attributes': {
      accepts: z.object({
        horseId,
        name: z.string().min(1).max(200).optional(),
        halterColour: z.string().max(100).nullish(),
        blanketSize: z.string().max(100).nullish(),
        height: z.string().max(50).nullish(),
        photoUrl: z.string().max(2000).nullish(),
        reason,
      }),
      answers: z.void(),
    },
    /** `spaceId: null` clears the assignment for that kind (ADR 0002). */
    '/horses/space': {
      accepts: z.object({ horseId, kind: spaceKind, spaceId: spaceId.nullable() }),
      answers: z.void(),
    },
    /** `departedOn: null` corrects a mistaken Departure — a date, never a delete (ADR 0002, #32). */
    '/horses/departure': {
      accepts: z.object({ horseId, departedOn: dayOfTheOrganisation.nullable(), reason }),
      answers: z.void(),
    },
    '/suppliers': {
      accepts: z.object({
        name: z.string().min(1).max(200),
        url: z.string().max(2000).nullish(),
        note: z.string().max(2000).nullish(),
      }),
      answers: z.object({ supplierId: z.string() }),
    },
    '/products': {
      accepts: z.object({
        name: z.string().min(1).max(200),
        kind: productKind,
        supplierId: supplierId.nullish(),
        prescription: z.boolean(),
        reorderPointDays: z.number().int().positive().nullish(),
        orderingNote: z.string().max(2000).nullish(),
      }),
      answers: z.object({ productId: z.string() }),
    },
    /** A partial edit, the same discipline `/horses/attributes` follows (ADR 0003, ADR 0019). */
    '/products/edit': {
      accepts: z.object({
        productId,
        name: z.string().min(1).max(200).optional(),
        kind: productKind.optional(),
        supplierId: supplierId.nullish(),
        prescription: z.boolean().optional(),
        reorderPointDays: z.number().int().positive().nullish(),
        orderingNote: z.string().max(2000).nullish(),
        reason,
      }),
      answers: z.void(),
    },
    /** Posts a Contact, under `roster` (ADR 0014). */
    '/contacts': {
      accepts: z.object({
        name: z.string().min(1).max(200),
        number: z.string().min(1).max(50),
        hours: z.string().max(200).nullish(),
        purpose: z.string().min(1).max(500),
      }),
      answers: z.object({ contactId: z.string() }),
    },
    /** A partial edit, the same discipline `/products/edit` follows (ADR 0003). */
    '/contacts/edit': {
      accepts: z.object({
        contactId,
        name: z.string().min(1).max(200).optional(),
        number: z.string().min(1).max(50).optional(),
        hours: z.string().max(200).nullish(),
        purpose: z.string().min(1).max(500).optional(),
        reason,
      }),
      answers: z.void(),
    },
    /** Adds a standing rule — the Reminders panel's residue, under `roster` (ADR 0018). */
    '/standing-rules': {
      accepts: z.object({ text: z.string().min(1).max(500) }),
      answers: z.object({ standingRuleId: z.string() }),
    },
    /** Edits a standing rule's text in place. */
    '/standing-rules/edit': {
      accepts: z.object({ standingRuleId, text: z.string().min(1).max(500), reason }),
      answers: z.void(),
    },
    /**
     * Posts an Announcement. Any single Domain Scope, and there is no field
     * here that could name a subject — anything about one horse already has a
     * better home (ADR 0018).
     *
     * **`neverQueued`**, under ADR 0018's restated rule: an Announcement is not
     * true until it arrives, because the app is the medium here rather than the
     * ledger. An author who sees their own phone say *posted* while the wall
     * never got it is the same failure shape as two volunteers each believing
     * they have Thursday covered.
     */
    '/announcements': {
      accepts: z.object({ text: z.string().min(1).max(2000), expiresOn: dayOfTheOrganisation }),
      answers: z.object({ announcementId: z.string() }),
      neverQueued: true,
    },
    /**
     * Edits an Announcement in place — by the author or any Domain Scope
     * holder, which is the same check as posting: ADR 0010 has no authorship
     * axis for this to lean on (ADR 0018).
     */
    '/announcements/edit': {
      accepts: z.object({
        announcementId,
        text: z.string().min(1).max(2000).optional(),
        expiresOn: dayOfTheOrganisation.optional(),
      }),
      answers: z.void(),
      neverQueued: true,
    },
    /**
     * Publishes a new Feed Schedule version for one horse at one Shift Type
     * (ADR 0003). An empty `lines` array is legal — it is how a horse_care
     * holder retires a schedule, as a version rather than a deletion.
     */
    '/feed-schedules': {
      accepts: z.object({
        horseId,
        shiftType,
        validFrom: dayOfTheOrganisation,
        lines: z.array(z.object({ productId, amount: z.string().min(1).max(200), route })),
      }),
      answers: z.object({ feedScheduleVersionId: z.string() }),
    },
    /** A recurring commitment. It generates nothing by itself (ADR 0001). */
    '/shift-patterns': {
      accepts: z.object({
        weekday,
        shiftType,
        startTime: timeOfDay,
        targetHeadcount: z.number().int().positive(),
      }),
      answers: z.object({ shiftPatternId: z.string() }),
    },
    /**
     * Edits a Pattern — and, if that is the answer, the Shifts already
     * generated from it that have not happened yet.
     *
     * `applyToScheduled` is **required and never defaulted**: ADR 0001 says the
     * prompt is not optional polish, because without it the model is quietly
     * wrong in the most common editing case — a Coordinator moves a start time
     * and next Tuesday keeps the old one.
     */
    '/shift-patterns/edit': {
      accepts: z.object({
        shiftPatternId: z.uuid(),
        startTime: timeOfDay.optional(),
        targetHeadcount: z.number().int().positive().optional(),
        applyToScheduled: z.boolean(),
        reason,
      }),
      answers: z.object({ scheduledTouched: z.number() }),
    },
    /** Somebody onto a Standing Roster — the first door the #34 gates stand at. */
    '/shift-patterns/roster': {
      accepts: z.object({
        shiftPatternId: z.uuid(),
        volunteerId,
        position: assignablePosition,
        applyToScheduled: z.boolean(),
      }),
      answers: z.object({
        scheduledTouched: z.number(),
        /**
         * How many scheduled Shifts were left alone because somebody else
         * already holds Lead on them. At most one Lead per Shift (ADR 0010),
         * so carrying a Pattern change forward has to be able to say *not
         * there* rather than quietly making a second one.
         */
        leadHeldOn: z.number(),
      }),
    },
    /**
     * Retiring a Pattern, or bringing it back. How a rescue stops a Tuesday
     * morning without deleting the Shifts it already made (ADR 0001).
     */
    '/shift-patterns/retirement': {
      accepts: z.object({ shiftPatternId: z.uuid(), retired: z.boolean(), reason }),
      answers: z.void(),
    },
    '/shift-patterns/roster-removal': {
      accepts: z.object({
        shiftPatternId: z.uuid(),
        volunteerId,
        applyToScheduled: z.boolean(),
        reason,
      }),
      answers: z.object({ scheduledTouched: z.number() }),
    },
    /**
     * Fills the horizon (ADR 0001). Deliberate, never at boot, and safe to run
     * twice — the second run creates nothing.
     */
    '/shifts/generation': {
      accepts: z.object({}),
      answers: z.object({ created: z.number(), through: dayOfTheOrganisation }),
    },
    /** A Pop-up: a Shift with no Pattern behind it, staffed by Sign-up (ADR 0011). */
    '/shifts': {
      accepts: z.object({
        day: dayOfTheOrganisation,
        startTime: timeOfDay,
        targetHeadcount: z.number().int().positive(),
        purpose: z.string().min(1).max(500),
      }),
      answers: z.object({ shiftId: z.string() }),
    },
    /** The Coordinator putting somebody on one dated Shift — the gates' second door. */
    '/shifts/roster': {
      accepts: z.object({ shiftId: z.uuid(), volunteerId, position: assignablePosition }),
      answers: z.object({ rosterId: z.string() }),
    },
    '/shifts/roster-removal': {
      accepts: z.object({ shiftId: z.uuid(), volunteerId, reason }),
      answers: z.void(),
    },
    /**
     * A Cover: claiming a place on a Shift you were not rostered on. It lands
     * as a volunteer and never as a Lead, and is **never refused for what the
     * volunteer lacks** (ADR 0011).
     */
    '/shifts/cover': {
      accepts: z.object({ shiftId: z.uuid() }),
      answers: z.object({ rosterId: z.string() }),
      neverQueued: true,
    },
    /** A Drop: taking yourself off one dated Shift, and never off the Pattern. */
    '/shifts/drop': {
      accepts: z.object({ shiftId: z.uuid(), reason }),
      answers: z.void(),
      neverQueued: true,
    },
    /**
     * An Acting Lead claim: a rostered volunteer taking charge of a Shift with
     * nobody leading it (ADR 0010). Suggested by Medication Authority then
     * tenure, and **claimable by any** — restricting it to the suggested person
     * leaves a Shift leaderless exactly when that person did not show.
     *
     * `neverQueued`, decided by **ADR 0018's restated rule** rather than by a
     * new carve-out from ADR 0005: *the app queues when it is the ledger, and
     * does not queue when it is the medium*. A tick is true whether or not the
     * app knows; a claim to be in charge of Thursday is not true until it
     * arrives, because the app is the thing doing the communicating. Two
     * volunteers each looking at their own phone and each seeing that they are
     * leading Thursday is character-for-character the Unsent failure that rule
     * was restated to catch.
     */
    '/shifts/acting-lead': {
      accepts: z.object({ shiftId: z.uuid() }),
      answers: z.object({ rosterId: z.string() }),
      neverQueued: true,
    },
    /**
     * Short: declared and cleared by a person, never by the app (ADR 0011).
     *
     * One endpoint and a boolean rather than two, the way retiring a Pattern
     * is: declaring and clearing are the same judgement pointed two ways.
     *
     * It **queues** like every other write, and deliberately so under the same
     * rule: here the app is the ledger. *Thursday needs more people than it has*
     * is true in the barn whether or not the app knows, the way a tick is —
     * unlike a Cover, nobody can be misled into thinking a commitment exists —
     * and ADR 0011 already accepts a stale Short as possible. So the queue is
     * transport for a fact, which is exactly where ADR 0018 leaves it.
     */
    '/shifts/short': {
      accepts: z.object({ shiftId: z.uuid(), short: z.boolean() }),
      answers: z.void(),
    },
    /**
     * The evening digest: the **one** thing this application sends about
     * staffing, to holders of `roster` (ADR 0011).
     *
     * A write with a deliberate trigger, exactly like `/weather/readings` and
     * generation: an in-process interval is a job that stops the next time the
     * container restarts and nobody notices for a fortnight. It becomes the
     * evening job's one step the day there is a scheduler.
     *
     * The counts come back rather than a bare acknowledgement, because a send
     * that failed must be visible: `sent` below `recipients` is the thing a
     * Coordinator has to be able to see (ADR 0009).
     */
    '/shifts/digest': {
      accepts: z.object({}),
      answers: z.object({
        recipients: z.number(),
        sent: z.number(),
        shifts: z.number(),
      }),
    },
    /**
     * Adds a Task to the catalogue (ADR 0013). What the rescue may choose
     * among is fixed — this is the whole of it, and there is no ninth field.
     */
    '/tasks': {
      accepts: z.object({
        subjectKind: taskSubjectKind,
        priority: taskPriority,
        period: taskPeriod,
        requiresMedicationAuthority: z.boolean(),
        conditionName: conditionName.nullish(),
        prepForShiftType: shiftType.nullish(),
        toleranceCount: z.number().int().positive().nullish(),
        closing: z.boolean(),
        instructionText: z.string().min(1).max(2000),
      }),
      answers: z.object({ taskId: z.string() }),
    },
    /**
     * A partial edit, the same discipline `/products/edit` follows. `subjectKind`
     * and `period` are not editable — either changes what every Item this Task
     * has already produced meant, which is bigger than a catalogue correction.
     */
    '/tasks/edit': {
      accepts: z.object({
        taskId: z.uuid(),
        priority: taskPriority.optional(),
        requiresMedicationAuthority: z.boolean().optional(),
        conditionName: conditionName.nullish(),
        prepForShiftType: shiftType.nullish(),
        toleranceCount: z.number().int().positive().nullish(),
        closing: z.boolean().optional(),
        instructionText: z.string().min(1).max(2000).optional(),
        reason,
      }),
      answers: z.void(),
    },
    /**
     * Publishes a Task Assignment version — which Shift Type normally does
     * one Task for one Subject (ADR 0013, ADR 0015's tri-state, reused). A
     * Subject is a horse, a Space, or the rescue: exactly the fields that
     * match the Task's own `subjectKind`, checked on the server.
     */
    '/task-assignments': {
      accepts: z.object({
        taskId: z.uuid(),
        horseId: horseId.nullable(),
        spaceId: spaceId.nullable(),
        stance: taskAssignmentStance,
        /** Required by `assigned`; null for `deliberately_none`. */
        shiftType: shiftType.nullable(),
        instructionText: z.string().max(2000).nullish(),
        validFrom: dayOfTheOrganisation,
      }),
      answers: z.object({ taskAssignmentId: z.string() }),
    },
    /**
     * Materializes today's Items (ADR 0013): resolves the catalogue, the Feed
     * Schedules, the Task Assignments and the day's Reading into the Items
     * every Shift today shows on opening.
     *
     * A write with a deliberate trigger, exactly like `/shifts/generation` and
     * `/weather/readings` — never at boot, and safe to run twice: the same
     * discipline that makes generation idempotent makes this idempotent too.
     */
    '/items/materialization': {
      accepts: z.object({}),
      answers: z.object({ day: dayOfTheOrganisation, created: z.number() }),
    },
    /**
     * Publishes a Threshold version — the rescue default with a null
     * `horseId`, a horse's own otherwise (ADR 0015, ADR 0003's versioned tier).
     *
     * `metric` and `provider` are optional because the kind already knows them:
     * cold is air temperature and heat is real feel, and a screen asking a
     * volunteer to restate that is a screen inviting the one answer that
     * silently re-calibrates the barn. A caller may still state them, which is
     * what a rescue recalibrating against a different provider would do.
     */
    '/thresholds': {
      accepts: z.object({
        horseId: horseId.nullable(),
        kind: thresholdKind,
        stance: z.enum(STANCES),
        /** Required by `overridden`; a `follows_default` row carries none. */
        value: z.number().nullish(),
        metric: metric.optional(),
        provider: weatherProvider.optional(),
        validFrom: dayOfTheOrganisation,
      }),
      answers: z.object({ thresholdVersionId: z.string() }),
    },
    /**
     * Fixes today's weather: fetches the forecast, evaluates every Condition
     * against it and records the whole thing as one Reading.
     *
     * A write rather than a read with a side effect, and a queueable one like
     * every other: it is the act the day's plan is built on. It becomes the
     * daily job's first step when there is a daily job; until then a person at
     * a desk does it, which is the same act with a different hand on it.
     */
    '/weather/readings': {
      accepts: z.object({}),
      answers: z.object({
        readingId: z.string(),
        provider: weatherProvider,
        stale: z.boolean(),
      }),
    },
    /**
     * Appends a weight or body-condition entry. On the floor — any signed-in
     * Volunteer, not a Domain Scope — because recording that a horse was
     * weighed today is not an edit to a care instruction (`CONTEXT.md`'s Weight).
     */
    '/measurements': {
      accepts: z.object({
        horseId,
        kind: measurementKind,
        value: z.number().positive(),
        method: measurementMethod.nullish(),
        takenOn: dayOfTheOrganisation,
      }),
      answers: z.object({ measurementId: z.string() }),
    },
    /**
     * An arrival, against a Shift or as a Visit (ADR 0012). `volunteerId` is
     * who arrived — self, or somebody else, always attributed to whoever
     * called this rather than to them.
     *
     * `shiftId` present means a Shift row: `description` and `category` are
     * ignored, and the server writes `category: 'shift'` regardless of what
     * was sent. `shiftId` absent means a Visit: both are required, and
     * `category` is never `shift`.
     *
     * Queues, like every ordinary statement about work that already happened
     * (ADR 0005, ADR 0012) — this is not a Cover or a Drop, so it carries no
     * `neverQueued`.
     */
    '/attendance/sign-in': {
      accepts: z.object({
        volunteerId,
        shiftId: shiftId.nullish(),
        description: z.string().max(1000).nullish(),
        category: attendanceCategory.nullish(),
      }),
      answers: z.object({ attendanceId: z.string() }),
    },
    /**
     * A departure, resolved rather than named: the server finds the open
     * Attendance for `volunteerId` — against `shiftId` where one is given, the
     * open Visit otherwise — and closes it. **A missing sign-out is never
     * invented by the app**; this is the one thing that ever closes one, and
     * it always names who did (ADR 0012).
     *
     * `supervisingAdultId` and `supervisingAdultPhone` are captured here,
     * alongside the sign-out that already happens at this moment — the adult
     * who supervised a minor, distinct from who was merely present.
     */
    '/attendance/sign-out': {
      accepts: z.object({
        volunteerId,
        shiftId: shiftId.nullish(),
        supervisingAdultId: volunteerId.nullish(),
        supervisingAdultPhone: z.string().max(30).nullish(),
      }),
      answers: z.void(),
    },
    /**
     * Records an Observation, on ADR 0010's floor: free text with an optional
     * subject, attaching to the recorder's own open Attendance (ADR 0014).
     * `shiftId` names a Shift row; omitted, it attaches to the caller's open
     * Visit. `observerVolunteerId` is Shift Authority's own act — naming a
     * rostered volunteer as the observer instead of the caller — checked in
     * `src/server/observations/records.ts` rather than declared here, because
     * `shiftId` is nullable and so this write's `MutationAuthorization` can
     * never be Shift Authority's own type (`src/server/api/route.ts`).
     */
    '/observations': {
      accepts: z.object({
        shiftId: shiftId.nullish(),
        text: z.string().min(1).max(2000),
        subjectKind: observationSubjectKind.nullish(),
        subjectId: z.uuid().nullish(),
        subjectLabel: z.string().max(200).nullish(),
        observerVolunteerId: volunteerId.nullish(),
      }),
      answers: z.object({ observationId: z.string() }),
    },
    /**
     * A Visit's own second exit at sign-out: noted, with no action — belongs
     * to the Observation's own recorder alone (ADR 0014). The first exit,
     * Escalate, is the ordinary `/escalations` write below, which
     * dispositions the Observation itself the moment it lands.
     */
    '/observations/note': {
      accepts: z.object({ observationId }),
      answers: z.void(),
    },
    /**
     * Escalates an Observation to exactly one Domain Scope: Shift Authority
     * over the Shift it was recorded on, or a holder of `scope` adopting it
     * into their own (ADR 0014). `framing` is the escalator's own words, never
     * the Observation's — curation the app was about to lose. One Observation
     * may carry many Escalations, and they share no state with each other.
     */
    '/escalations': {
      accepts: z.object({
        observationId,
        scope: z.enum(DOMAIN_SCOPES),
        framing: z.string().min(1).max(2000),
      }),
      answers: z.object({ escalationId: z.string() }),
    },
    /**
     * Appends to an Escalation's thread — ADR 0010's fourth scope-free write
     * (ADR 0014). Anyone signed in, before close and after.
     */
    '/escalations/comments': {
      accepts: z.object({ escalationId, text: z.string().min(1).max(2000) }),
      answers: z.object({ commentId: z.string() }),
    },
    /**
     * Closes an Escalation: a holder of its own addressed Scope, and a note —
     * never the escalator, never the reporter, and never a reopen (ADR 0014).
     */
    '/escalations/close': {
      accepts: z.object({ escalationId, note: z.string().min(1).max(2000) }),
      answers: z.void(),
    },
  },
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
  z.input<C['reads'][P]['answers']> | Failure

/** What a write's handler must answer with, or a refusal. */
export type SendsWrite<C extends Contract, P extends WritePath<C>> =
  z.input<C['writes'][P]['answers']> | Failure

/** What a write's handler receives: the payload it declared, and the key. */
export type Received<C extends Contract, P extends WritePath<C>> = z.output<
  C['writes'][P]['accepts']
> & { readonly idempotencyKey: string }
