/**
 * The `/api/v1` application. Every queueable write in the system arrives here
 * (ADR 0007), and every handler declares what it requires (ADR 0010).
 *
 * The roster is the first domain on it. The Coordinator creates a Volunteer,
 * establishes a date of birth, ticks an Orientation, records a Release against
 * the current Version and — for a minor — a Consent; officers confer Roles
 * under `grants`, and `horse_care` confers Medication Authority.
 *
 * **Recording these queues, and that is not a carve-out.** ADR 0011's boundary
 * governs — *work that happened queues; a promise about work that has not
 * happened yet does not* — and every write here is a statement about the past.
 * ADR 0017 says so in as many words for the signature, and notes what it costs:
 * an Unsent one leaves a volunteer who genuinely signed briefly un-rosterable,
 * which is a Coordinator at a desk on wifi momentarily blocked, and nothing
 * like two volunteers each believing they have Thursday.
 *
 * **Every refusal is a 4xx naming itself**, and specifically a 409 for the ones
 * a retry cannot fix — an Orientation already ticked, a release somebody tried
 * to record about themselves. A queue reads 409 as *stop*, which is the right
 * thing for all of them, and a silent empty answer would be indistinguishable
 * from success to it (ADR 0010).
 */
import { eq } from 'drizzle-orm'

import { forOrg, type OrgScopedDatabase } from '../../db/for-org'
import { orgs, volunteers } from '../../db/schema'
import type { contract } from '../../shared/api-contract'
import { type DayString } from '../../shared/time'
import { anyDomainScope, board, domainScope, floor, readEverything } from './authorization'
import { createApi, json, noContent, type Api, type ApiOptions } from './route'
import type { Actor, RequestContext } from '../request-context'
import { auditLog, peopleList, unstaffedScopes } from '../roster/people'
import {
  createVolunteerIn,
  recordConsent,
  recordDateOfBirth,
  recordOrientation,
  removeVolunteerIn,
  type Refusal,
} from '../roster/records'
import {
  grantMedicationAuthority,
  grantRoleIn,
  revokeMedicationAuthority,
  revokeRoleIn,
} from '../roster/grants'
import {
  publishReleaseVersion,
  recordReleaseSignature,
  releaseVersionList,
  revokeReleaseSignature,
} from '../roster/releases'
import { startObservability } from '../observability'
import { today } from '../time'
import { horseById, horseList, spaceList } from '../horses/list'
import {
  assignHorseSpace,
  createHorse,
  createSpace,
  editHorseAttributes,
  editSpace,
  recordHorseDeparture,
  type Refusal as HorseRefusal,
} from '../horses/records'
import { publishFeedSchedule } from '../horses/feed-schedules'
import { recordMeasurement } from '../horses/measurements'
import { productList, supplierList } from '../products/list'
import { boardGrid } from '../board/grid'
import { createProduct, createSupplier, editProduct } from '../products/records'
import { currentThresholds, publishThreshold } from '../weather/thresholds'
import { readingFor, recordReading } from '../weather/readings'
import type { Refusal as WeatherRefusal } from '../weather/outcome'
import { THRESHOLD_SPECS } from '../../shared/weather'

// The server's one entry point, so this is where reporting starts. It is a
// no-op without a DSN, which is the state of every machine until one is set.
startObservability()

/**
 * Registers every endpoint against a fresh API.
 *
 * A function rather than a module-level `api.route(...)` sequence so that a
 * test can bind its own request context and idempotency store — the seam the
 * spec names first: features are exercised through this fetch entry, against
 * contract-declared endpoints, with somebody put in the barn rather than signed
 * in. The application calls it once, below, with the real ones.
 */
export function buildApi(
  options: Omit<ApiOptions<typeof contract>, 'contract'> = {},
): Api<typeof contract> {
  const api = createApi(options)

  /**
   * The actor, where the authorization already guaranteed one.
   *
   * Every declaration but `read-everything` on a signed-out request refuses a
   * null actor before a handler runs, and `read-everything` refuses one too — so
   * by the time any handler below is reached there is somebody there. Saying that
   * once, loudly, beats eleven copies of a nullability check that can only ever
   * be a comment about what already happened.
   */
  function actorOf(context: RequestContext): Actor {
    if (context.actor === null) {
      throw new Error(
        'A handler ran with no actor; the authorization declaration did not refuse it.',
      )
    }
    return context.actor
  }

  /**
   * The day, in the organisation's timezone (ADR 0007).
   *
   * Every gate here is a question about a day — is she a minor *today*, was this
   * signature given before the Version became valid — and a browser deriving its
   * own would be right for most of the year and wrong at the edges that matter.
   */
  async function dayHere(db: OrgScopedDatabase): Promise<DayString> {
    const [org] = await db.select({ timeZone: orgs.timeZone }).from(orgs).limit(1)
    if (org === undefined) {
      throw new Error('The organisation is not visible; APP_ORG_ID names one that does not exist.')
    }
    return today(org.timeZone)
  }

  /**
   * What a refusal answers with.
   *
   * 404 where the thing named is not there, and **409 for everything else** — a
   * conflict is precisely *this will not become true by retrying*, which is what
   * a phone's queue needs to hear about an Orientation that is already ticked or
   * a release somebody tried to record about themselves. A 400 would invite the
   * queue to treat it as a malformed body and a 403 would claim it was about
   * authorization, and neither is true.
   */
  function refusal(because: Refusal) {
    const missing =
      because === 'volunteer_not_found' ||
      because === 'release_version_not_found' ||
      because === 'signature_not_found'
    return json({ error: because }, missing ? 404 : 409)
  }

  /** The same shape as `refusal`, for the horses-and-Spaces domain's own outcome union. */
  function horseRefusal(because: HorseRefusal) {
    const missing =
      because === 'horse_not_found' ||
      because === 'space_not_found' ||
      because === 'product_not_found' ||
      because === 'supplier_not_found'
    return json({ error: because }, missing ? 404 : 409)
  }

  /**
   * The same shape again, for the weather domain — and the one place a refusal
   * here is deliberately **not** a 409.
   *
   * 409 means *this will not become true by retrying*, and a phone's queue
   * drops on it. A Threshold that needs a number it does not carry is exactly
   * that. **A forecast nobody answered is the opposite**: both providers were
   * slow for a minute and there was nothing to reuse, which is the single most
   * retryable outcome in the domain, and dropping the day's Reading over it
   * would be the queue doing the wrong thing confidently. Unconfigured
   * coordinates are a deployment fault, which is the same 503 `/day` already
   * answers with when `APP_ORG_ID` names nothing.
   */
  function weatherRefusal(because: WeatherRefusal) {
    if (because === 'horse_not_found') return json({ error: because }, 404)
    const deployment = because === 'coordinates_not_set' || because === 'forecast_unavailable'
    return json({ error: because }, deployment ? 503 : 409)
  }

  api.route('GET', '/day', readEverything(), async ({ context }) => {
    const [org] = await forOrg(context.orgId).run((db) =>
      db.select({ name: orgs.name, timeZone: orgs.timeZone }).from(orgs).limit(1),
    )

    if (org === undefined) {
      // The policies fail closed, so this is either an unconfigured APP_ORG_ID
      // or an organisation that does not exist. Both are deployment faults and
      // both should say so rather than answer with a day.
      return json({ error: 'organisation_not_found' }, 503)
    }

    return json({ day: today(org.timeZone), timeZone: org.timeZone, organisation: org.name })
  })

  /**
   * Who the session says is asking.
   *
   * `readEverything()` and not a floor of its own: the question *who am I* is
   * answerable to a Volunteer and to nobody else, which is exactly what the
   * floor already says. A signed-out request therefore gets the same explicit
   * `401 not_authorized` every other read gives it, rather than a body
   * announcing that nobody is signed in — one fact, one shape (ADR 0010).
   */
  api.route('GET', '/me', readEverything(), async ({ context }) => {
    const actor = actorOf(context)

    const [volunteer] = await forOrg(context.orgId).run((db) =>
      db
        .select({ name: volunteers.name })
        .from(volunteers)
        .where(eq(volunteers.id, actor.volunteerId))
        .limit(1),
    )

    if (volunteer === undefined) {
      // The session resolved to a Volunteer that the policies cannot see, which
      // means the row went while the session stayed. Saying so beats answering
      // with a nameless person.
      return json({ error: 'volunteer_not_found' }, 503)
    }

    return json({
      volunteerId: actor.volunteerId,
      name: volunteer.name,
      domainScopes: [...actor.domainScopes],
    })
  })

  /**
   * The people list — one surface for all three gates (ADR 0017).
   *
   * `readEverything()`, because ADR 0010's floor is that every Volunteer reads
   * everything and this list is the rescue's own noticeboard. The carve-outs are
   * enforced **inside** the answer rather than by refusing the request: contact
   * details, the year of a date of birth and the signatures behind it come back
   * only for a holder of `roster`, and as `null` rather than as an empty object
   * for everybody else.
   */
  api.route('GET', '/volunteers', readEverything(), async ({ context }) => {
    const actor = actorOf(context)
    const seesRoster = actor.domainScopes.includes('roster')

    return forOrg(context.orgId).run(async (db) => {
      const on = await dayHere(db)
      const people = await peopleList(db, on, seesRoster)
      return json({
        today: on,
        people: people.map((person) => ({
          ...person,
          gaps: [...person.gaps],
          roles: [...person.roles],
          domainScopes: [...person.domainScopes],
          behindRoster:
            person.behindRoster === null
              ? null
              : { ...person.behindRoster, signatures: [...person.behindRoster.signatures] },
        })),
        unstaffedScopes: [...unstaffedScopes(people)],
      })
    })
  })

  /**
   * The Release Versions, newest first.
   *
   * On the floor, because a Version is the *blank* text and there is nothing
   * personal in it — the asymmetry ADR 0017 calls the point: the executed copies
   * are sixty pieces of paper and stay paper, the unexecuted text is one document
   * and is what makes *which text did she sign* answerable in 2031.
   */
  api.route('GET', '/release-versions', readEverything(), async ({ context }) => {
    const versions = await forOrg(context.orgId).run((db) => releaseVersionList(db))
    return json({ versions: versions.map((version) => ({ ...version })) })
  })

  /**
   * The audit log. Behind `roster`, which is one of ADR 0010's two carve-outs
   * from the read-everything floor — the other being contact details.
   */
  api.route('GET', '/audit', domainScope('roster'), async ({ context }) => {
    const entries = await forOrg(context.orgId).run((db) => auditLog(db, 200))
    return json({ entries: entries.map((entry) => ({ ...entry })) })
  })

  api.mutation('/volunteers', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await createVolunteerIn(db, context.orgId, actor.volunteerId, {
      name: input.name,
      email: input.email,
      mobile: input.mobile ?? null,
    })
    if (!outcome.ok) return refusal(outcome.because)
    return json({ volunteerId: outcome.value.id }, 201)
  })

  api.mutation(
    '/volunteers/date-of-birth',
    domainScope('roster'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await recordDateOfBirth(db, context.orgId, actor.volunteerId, {
        volunteerId: input.volunteerId,
        dateOfBirth: input.dateOfBirth,
        provenance: input.provenance,
        reason: input.reason ?? null,
      })
      return outcome.ok ? noContent() : refusal(outcome.because)
    },
  )

  api.mutation('/volunteers/orientation', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await recordOrientation(db, context.orgId, actor.volunteerId, input)
    return outcome.ok ? noContent() : refusal(outcome.because)
  })

  api.mutation('/volunteers/consent', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await recordConsent(db, context.orgId, actor.volunteerId, {
      ...input,
      today: await dayHere(db),
    })
    return outcome.ok ? noContent() : refusal(outcome.because)
  })

  /**
   * A Release signature. Recorded under `roster`, by the same hand and in the
   * same minute as the Orientation tick — and **never self-recorded**, which the
   * record enforces rather than this endpoint.
   */
  api.mutation('/volunteers/release', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await recordReleaseSignature(db, context.orgId, actor.volunteerId, input)
    if (!outcome.ok) return refusal(outcome.because)
    return json({ signatureId: outcome.value.id }, 201)
  })

  api.mutation(
    '/volunteers/release-revocation',
    domainScope('roster'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await revokeReleaseSignature(db, context.orgId, actor.volunteerId, {
        signatureId: input.signatureId,
        reason: input.reason ?? null,
      })
      return outcome.ok ? noContent() : refusal(outcome.because)
    },
  )

  api.mutation('/volunteers/removal', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await removeVolunteerIn(db, context.orgId, actor.volunteerId, {
      volunteerId: input.volunteerId,
      reason: input.reason ?? null,
    })
    return outcome.ok ? noContent() : refusal(outcome.because)
  })

  /**
   * Conferring a Role, under `grants` and never under `roster`.
   *
   * Letting `roster` grant Roles would make `roster` transitively every scope,
   * which would render the domain partition the whole authorization model rests
   * on decorative (ADR 0010). Hence a scope of its own, held only by officers.
   */
  api.mutation('/volunteers/roles', domainScope('grants'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await grantRoleIn(db, context.orgId, actor.volunteerId, {
      volunteerId: input.volunteerId,
      role: input.role,
      reason: input.reason ?? null,
    })
    return outcome.ok ? noContent() : refusal(outcome.because)
  })

  api.mutation(
    '/volunteers/role-revocation',
    domainScope('grants'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await revokeRoleIn(db, context.orgId, actor.volunteerId, {
        volunteerId: input.volunteerId,
        role: input.role,
        reason: input.reason ?? null,
      })
      return outcome.ok ? noContent() : refusal(outcome.because)
    },
  )

  /**
   * Medication Authority, under `horse_care` — the scope that owns medication
   * schedules, and not `roster`, which owns who is on a Shift. The two acts are
   * different and are held by different people.
   */
  api.mutation(
    '/volunteers/medication-authority',
    domainScope('horse_care'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const about = { volunteerId: input.volunteerId, reason: input.reason ?? null }
      const outcome = input.granted
        ? await grantMedicationAuthority(db, context.orgId, actor.volunteerId, about)
        : await revokeMedicationAuthority(db, context.orgId, actor.volunteerId, about)
      return outcome.ok ? noContent() : refusal(outcome.because)
    },
  )

  /**
   * Publishing a Release Version.
   *
   * **It removes nothing.** With `obsoletesPrior` set, every signature given
   * before `validFrom` stales — and every affected Volunteer's release gap
   * appears on the next read of the people list, derived. Existing roster rows
   * stand and are flagged, because a re-papering would otherwise fire that
   * failure across every roster in the system on a single morning (ADR 0017).
   */
  api.mutation('/release-versions', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const published = await publishReleaseVersion(db, context.orgId, actor.volunteerId, input)
    return json({ releaseVersionId: published.id }, 201)
  })

  /** Every Space, occupied or not — an empty Stall is exactly as visible (ADR 0002). */
  api.route('GET', '/spaces', readEverything(), async ({ context }) => {
    const listed = await forOrg(context.orgId).run((db) => spaceList(db))
    return json({
      spaces: listed.map((space) => ({ ...space, occupants: [...space.occupants] })),
    })
  })

  /** Every horse, current or Departed — hiding a Departed one is the phone's concern, not this read's (#32). */
  api.route('GET', '/horses', readEverything(), async ({ context }) => {
    const listed = await forOrg(context.orgId).run((db) => horseList(db))
    return json({ horses: listed.map((horse) => ({ ...horse })) })
  })

  /**
   * One horse's profile — the first parameterised path (ADR 0021). Carries
   * the current Feed Schedule per Shift Type and both measurement series in
   * the same read, so the phone gets the whole profile in one round trip
   * (#36).
   */
  api.route('GET', '/horses/:horseId', readEverything(), async ({ context, params }) => {
    const found = await forOrg(context.orgId).run(async (db) => {
      const on = await dayHere(db)
      return horseById(db, params.horseId ?? '', on)
    })
    if (found === null) return json({ error: 'horse_not_found' }, 404)
    return json({
      ...found,
      feedSchedules: found.feedSchedules.map((schedule) => ({
        ...schedule,
        lines: [...schedule.lines],
      })),
      measurements: {
        weights: [...found.measurements.weights],
        bodyConditions: [...found.measurements.bodyConditions],
      },
    })
  })

  /** Every Supplier, referenced by many Products (ADR 0019). */
  api.route('GET', '/suppliers', readEverything(), async ({ context }) => {
    const listed = await forOrg(context.orgId).run((db) => supplierList(db))
    return json({ suppliers: listed.map((supplier) => ({ ...supplier })) })
  })

  /** The Product catalogue, every Supplier's name carried along (ADR 0019). */
  api.route('GET', '/products', readEverything(), async ({ context }) => {
    const listed = await forOrg(context.orgId).run((db) => productList(db))
    return json({ products: listed.map((product) => ({ ...product })) })
  })

  /**
   * The Board: the faithful grid, read-only, whole (#37).
   *
   * `board()` rather than `readEverything()` — a signed-in Volunteer, or the
   * rescue's tablet presenting the kiosk token. The tablet is not an actor and
   * this handler never asks for one, which is what *the Board credits nobody*
   * means once it is a property of the code rather than of the screen
   * (ADR 0022).
   */
  api.route('GET', '/board', board(), async ({ context }) => {
    const grid = await forOrg(context.orgId).run(async (db) => {
      const on = await dayHere(db)
      return boardGrid(db, on)
    })

    return json({
      today: grid.today,
      weather:
        grid.weather === null
          ? null
          : {
              ...grid.weather,
              hours: [...grid.weather.hours],
              conditions: [...grid.weather.conditions],
            },
      sections: grid.sections.map((section) => ({
        heading: section.heading,
        rows: section.rows.map((row) => ({
          stall: row.stall === null ? null : { ...row.stall },
          horse:
            row.horse === null
              ? null
              : {
                  id: row.horse.id,
                  name: row.horse.name,
                  halterColour: row.horse.halterColour,
                  field: row.horse.field === null ? null : { ...row.horse.field },
                  feedings: row.horse.feedings.map((feeding) => ({
                    ...feeding,
                    lines: [...feeding.lines],
                  })),
                },
        })),
      })),
    })
  })

  /**
   * The numbers the rescue owns, and the decisions still owed on them.
   *
   * `readEverything()`, because a volunteer standing in a barn at 38 ° has
   * every reason to know which horses get sheets — the numbers are on a
   * whiteboard in that barn today. Editing them is `horse_care` (ADR 0015).
   */
  api.route('GET', '/thresholds', readEverything(), async ({ context }) => {
    const current = await forOrg(context.orgId).run(async (db) => {
      const on = await dayHere(db)
      return { on, thresholds: await currentThresholds(db, on) }
    })

    return json({
      today: current.on,
      defaults: current.thresholds.defaults.map((record) => ({ ...record })),
      horses: current.thresholds.horses.map((horse) => ({
        horseId: horse.horseId,
        horseName: horse.horseName,
        records: horse.records.map((record) => ({ ...record })),
        undecided: [...horse.undecided],
      })),
    })
  })

  /**
   * Today's Reading, whole — the hours it read as well as what they resolved
   * to, because *why was this horse blanketed* is answered by the conditions
   * as read at the time (ADR 0015, #6).
   */
  api.route('GET', '/weather', readEverything(), async ({ context }) => {
    const answered = await forOrg(context.orgId).run(async (db) => {
      const on = await dayHere(db)
      return { on, reading: await readingFor(db, on) }
    })

    return json({
      day: answered.on,
      reading:
        answered.reading === null
          ? null
          : {
              ...answered.reading,
              hours: [...answered.reading.hours],
              conditions: [...answered.reading.conditions],
            },
    })
  })

  api.mutation('/spaces', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await createSpace(db, context.orgId, actor.volunteerId, input)
    if (!outcome.ok) return horseRefusal(outcome.because)
    return json({ spaceId: outcome.value.id }, 201)
  })

  api.mutation('/spaces/edit', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await editSpace(db, context.orgId, actor.volunteerId, input)
    return outcome.ok ? noContent() : horseRefusal(outcome.because)
  })

  api.mutation('/horses', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await createHorse(db, context.orgId, actor.volunteerId, {
      name: input.name,
      halterColour: input.halterColour ?? null,
      blanketSize: input.blanketSize ?? null,
      height: input.height ?? null,
      photoUrl: input.photoUrl ?? null,
    })
    if (!outcome.ok) return horseRefusal(outcome.because)
    return json({ horseId: outcome.value.id }, 201)
  })

  api.mutation('/horses/attributes', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await editHorseAttributes(db, context.orgId, actor.volunteerId, input)
    return outcome.ok ? noContent() : horseRefusal(outcome.because)
  })

  api.mutation('/horses/space', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await assignHorseSpace(db, context.orgId, actor.volunteerId, input)
    return outcome.ok ? noContent() : horseRefusal(outcome.because)
  })

  api.mutation('/horses/departure', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await recordHorseDeparture(db, context.orgId, actor.volunteerId, input)
    return outcome.ok ? noContent() : horseRefusal(outcome.because)
  })

  api.mutation(
    '/suppliers',
    anyDomainScope(['horse_care', 'supplies']),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await createSupplier(db, context.orgId, actor.volunteerId, {
        name: input.name,
        url: input.url ?? null,
        note: input.note ?? null,
      })
      if (!outcome.ok) return horseRefusal(outcome.because)
      return json({ supplierId: outcome.value.id }, 201)
    },
  )

  /** ADR 0019's one two-Scope record: writable by `horse_care` or `supplies`. */
  api.mutation(
    '/products',
    anyDomainScope(['horse_care', 'supplies']),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await createProduct(db, context.orgId, actor.volunteerId, {
        name: input.name,
        kind: input.kind,
        supplierId: input.supplierId ?? null,
        prescription: input.prescription,
        reorderPointDays: input.reorderPointDays ?? null,
        orderingNote: input.orderingNote ?? null,
      })
      if (!outcome.ok) return horseRefusal(outcome.because)
      return json({ productId: outcome.value.id }, 201)
    },
  )

  api.mutation(
    '/products/edit',
    anyDomainScope(['horse_care', 'supplies']),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await editProduct(db, context.orgId, actor.volunteerId, input)
      return outcome.ok ? noContent() : horseRefusal(outcome.because)
    },
  )

  /**
   * Publishing a Feed Schedule version. Under `horse_care` — a care
   * instruction, not a catalogue fact, so `supplies` does not reach it even
   * though it reaches the Product a line names (ADR 0003, ADR 0019).
   */
  api.mutation('/feed-schedules', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await publishFeedSchedule(db, context.orgId, actor.volunteerId, input)
    if (!outcome.ok) return horseRefusal(outcome.because)
    return json({ feedScheduleVersionId: outcome.value.id }, 201)
  })

  /**
   * Publishing a Threshold version — the rescue default or one horse's own.
   *
   * Under `horse_care`, the scope that owns care instructions: these numbers
   * decide what goes on a horse at 38 °, and they are edited by the people who
   * decide that rather than by whoever is on the roster (ADR 0015).
   *
   * The metric and the provider default from the kind. Cold is air temperature
   * and heat is real feel, and a form asking a volunteer to restate that is a
   * form inviting the one answer that silently re-calibrates every horse in the
   * barn (#6).
   */
  api.mutation('/thresholds', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await publishThreshold(db, context.orgId, actor.volunteerId, {
      horseId: input.horseId,
      kind: input.kind,
      stance: input.stance,
      value: input.value ?? null,
      metric: input.metric ?? THRESHOLD_SPECS[input.kind].metric,
      // The provider the number is calibrated against, which is the one this
      // deployment fetches from unless the caller says otherwise.
      provider: input.provider ?? 'open_meteo',
      validFrom: input.validFrom,
    })
    if (!outcome.ok) return weatherRefusal(outcome.because)
    return json({ thresholdVersionId: outcome.value.id }, 201)
  })

  /**
   * Fixing today's weather: the fetch, the evaluation and the Reading, in one
   * act.
   *
   * Under `horse_care` for now, and it is the daily job's first step the day
   * there is a daily job (ADR 0013's materialization). It is a write and not a
   * read with a side effect, because everything downstream reads the row it
   * wrote rather than the internet.
   */
  api.mutation('/weather/readings', domainScope('horse_care'), async (_input, { context, db }) => {
    const actor = actorOf(context)
    const [org] = await db.select({ timeZone: orgs.timeZone }).from(orgs).limit(1)
    if (org === undefined) {
      throw new Error('The organisation is not visible; APP_ORG_ID names one that does not exist.')
    }

    const outcome = await recordReading(db, context.orgId, actor.volunteerId, {
      day: await dayHere(db),
      timeZone: org.timeZone,
    })
    if (!outcome.ok) return weatherRefusal(outcome.because)
    return json(
      { readingId: outcome.value.id, provider: outcome.value.provider, stale: outcome.value.stale },
      201,
    )
  })

  /**
   * A weight or body-condition entry, on the floor: any signed-in Volunteer
   * may record one, because it is not an edit to a care instruction
   * (`CONTEXT.md`'s Weight).
   */
  api.mutation('/measurements', floor('record-a-measurement'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await recordMeasurement(db, context.orgId, actor.volunteerId, {
      horseId: input.horseId,
      kind: input.kind,
      value: input.value,
      method: input.method ?? null,
      takenOn: input.takenOn,
    })
    if (!outcome.ok) return horseRefusal(outcome.because)
    return json({ measurementId: outcome.value.id }, 201)
  })

  // Every path the contract declares now has a handler, or this throws and the
  // container does not start. Registering a path nothing declares is a type
  // error; this is the other direction, which would otherwise be a 404 that the
  // phone in the barn finds first (ADR 0021).
  api.sealed()

  return api
}

/**
 * The application's own, with the real session lookup and the real idempotency
 * table behind it.
 */
export const api = buildApi()
