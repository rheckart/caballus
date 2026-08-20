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
import {
  anyDomainScope,
  anyScopeHolder,
  board,
  domainScope,
  floor,
  readEverything,
  shiftAuthority,
} from './authorization'
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
  createSpaces,
  editHorseAttributes,
  editSpace,
  recordHorseDeparture,
  recordSpaceRetirement,
  type Refusal as HorseRefusal,
} from '../horses/records'
import { publishFeedSchedule } from '../horses/feed-schedules'
import { recordMeasurement } from '../horses/measurements'
import { productList, supplierList } from '../products/list'
import { boardGrid } from '../board/grid'
import { createProduct, createSupplier, editProduct } from '../products/records'
import { patternList, shiftList } from '../shifts/list'
import {
  assignToStandingRoster,
  createPattern,
  editPattern,
  removeFromStandingRoster,
  retirePattern,
} from '../shifts/patterns'
import { generateHorizon } from '../shifts/generation'
import {
  assignToShift,
  claimActingLead,
  coverShift,
  createPopUp,
  dropFromShift,
  removeFromShift,
} from '../shifts/roster'
import { declareShort } from '../shifts/short'
import { sendStaffingDigest } from '../shifts/digest'
import { closeCountsFor, closeShift } from '../shifts/close'
import { addShiftNote, shiftNotesFor } from '../shifts/notes'
import type { Refusal as ShiftRefusal } from '../shifts/outcome'
import { holdsShiftAuthority } from '../shifts/authority'
import { currentThresholds, publishThreshold } from '../weather/thresholds'
import { readingFor, recordReading } from '../weather/readings'
import type { Refusal as WeatherRefusal } from '../weather/outcome'
import { THRESHOLD_SPECS } from '../../shared/weather'
import {
  currentTaskAssignments,
  publishTaskAssignment,
  subjectsFor,
  taskList,
} from '../checklist/assignments'
import { createTask, editTask } from '../checklist/records'
import { checklistForShift, materializeDayFor, type Checklist } from '../checklist/materialize'
import type { Refusal as ChecklistRefusal } from '../checklist/outcome'
import {
  assignItem,
  dropItem,
  notDoneItem,
  tickItemDone,
  type Refusal as TickRefusal,
} from '../checklist/tick'
import { shiftById } from '../shifts/list'
import type { ShiftType } from '../../shared/feed-schedule'
import { attendanceLedger } from '../attendance/list'
import { signIn, signOut, type Refusal as AttendanceRefusal } from '../attendance/records'
import { escalationList, observationsFor, reporterEmail } from '../observations/list'
import {
  dispositionShiftObservation,
  noteObservation,
  recordObservation,
} from '../observations/records'
import {
  addEscalationComment,
  closeEscalation,
  escalateObservation,
  type Refusal as ObservationRefusal,
} from '../observations/escalations'
import { notifyClosed, notifyCommented, notifyEscalated } from '../observations/notify'
import { currentAnnouncements } from '../announcements/list'
import { createAnnouncement, editAnnouncement } from '../announcements/records'
import type { Refusal as AnnouncementRefusalKind } from '../announcements/outcome'
import { contactList, standingRuleList } from '../contacts/list'
import {
  createContact,
  createStandingRule,
  editContact,
  editStandingRule,
} from '../contacts/records'
import type { Refusal as ContactRefusalKind } from '../contacts/outcome'
import { reorderList, suppliesList } from '../supplies/list'
import {
  addReorderComment,
  closeReorder,
  openReorder,
  recordSuppliesReading,
  type Refusal as SuppliesRefusal,
} from '../supplies/records'

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
    return (await clockHere(db)).today
  }

  /**
   * The day, the zone it was resolved in, and the rescue's own name.
   *
   * Three things need the zone itself — generating a fortnight of weekdays,
   * deciding whether a Shift has started, and the digest's tomorrow — and the
   * digest also signs itself with the name. All of it comes off the one row, on
   * the rule this function was written for: re-reading the organisation for the
   * second fact is a second query for something the first already had.
   */
  async function clockHere(
    db: OrgScopedDatabase,
  ): Promise<{ today: DayString; timeZone: string; organisation: string }> {
    const [org] = await db.select({ name: orgs.name, timeZone: orgs.timeZone }).from(orgs).limit(1)
    if (org === undefined) {
      throw new Error('The organisation is not visible; APP_ORG_ID names one that does not exist.')
    }
    return { today: today(org.timeZone), timeZone: org.timeZone, organisation: org.name }
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

  /**
   * And again for the Shift domain. A thing that is not there is a 404; a gate
   * that does not hold and a Lead somebody else already holds are conflicts,
   * because neither becomes true by retrying — which is what a phone's queue
   * needs to hear, on the two writes here that it may carry.
   */
  function shiftRefusal(because: ShiftRefusal) {
    const missing =
      because === 'pattern_not_found' ||
      because === 'shift_not_found' ||
      because === 'volunteer_not_found'
    return json({ error: because }, missing ? 404 : 409)
  }

  /** And again for Tasks and Task Assignments (ADR 0013). */
  function checklistRefusal(because: ChecklistRefusal) {
    const missing =
      because === 'task_not_found' || because === 'horse_not_found' || because === 'space_not_found'
    return json({ error: because }, missing ? 404 : 409)
  }

  /**
   * And again for ticking an Item — *not rostered* and *needs Medication
   * Authority* are both conflicts, because neither becomes true by retrying
   * under the same key; the phone's queue has to stop and say so rather than
   * hold the claim forever (ADR 0013, #42).
   */
  function tickRefusal(because: TickRefusal) {
    const missing = because === 'shift_not_found' || because === 'item_not_found'
    return json({ error: because }, missing ? 404 : 409)
  }

  /**
   * And again for Attendance. A thing that is not there — the Volunteer, the
   * Shift — is a 404; everything else is a conflict, because none of them
   * becomes true by retrying (ADR 0012).
   */
  function attendanceRefusal(because: AttendanceRefusal) {
    const missing = because === 'volunteer_not_found' || because === 'shift_not_found'
    return json({ error: because }, missing ? 404 : 409)
  }

  /** And again for Observations and Escalations (ADR 0014). */
  function observationRefusal(because: ObservationRefusal) {
    const missing =
      because === 'observation_not_found' ||
      because === 'escalation_not_found' ||
      because === 'subject_not_found'
    return json({ error: because }, missing ? 404 : 409)
  }

  /** The Contacts screen's one refusal — a thing that is not there. */
  function contactRefusal(because: ContactRefusalKind) {
    return json({ error: because }, 404)
  }

  /** An Announcement's one refusal — a thing that is not there. */
  function announcementRefusal(because: AnnouncementRefusalKind) {
    return json({ error: because }, 404)
  }

  /** And again for Days-of-Supply readings and Reorders (ADR 0019). */
  function suppliesRefusal(because: SuppliesRefusal) {
    const missing =
      because === 'product_not_found' ||
      because === 'reorder_not_found' ||
      because === 'escalation_not_found'
    return json({ error: because }, missing ? 404 : 409)
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
   * Every Product's days-of-supply forecast, whole (ADR 0019, #47) — "every
   * Volunteer reads everything," the same as the catalogue itself.
   */
  api.route('GET', '/supplies', readEverything(), async ({ context }) => {
    const answered = await forOrg(context.orgId).run(async (db) => {
      const { today: on } = await clockHere(db)
      return { today: on, products: await suppliesList(db, on) }
    })
    return json({
      today: answered.today,
      products: answered.products.map((product) => ({
        ...product,
        latestReading: product.latestReading === null ? null : { ...product.latestReading },
      })),
    })
  })

  /**
   * Every Reorder, on the floor — a `supplies` holder's own open ones are
   * this same read, filtered on the phone (ADR 0019).
   */
  api.route('GET', '/reorders', readEverything(), async ({ context }) => {
    const entries = await forOrg(context.orgId).run((db) => reorderList(db))
    return json({
      reorders: entries.map((entry) => ({ ...entry, comments: [...entry.comments] })),
    })
  })

  /**
   * The Contacts screen: posted numbers and the rescue's standing rules, both
   * read by everyone (ADR 0014, ADR 0018).
   */
  api.route('GET', '/contacts', readEverything(), async ({ context }) => {
    const answered = await forOrg(context.orgId).run(async (db) => ({
      contacts: await contactList(db),
      standingRules: await standingRuleList(db),
    }))
    return json({
      contacts: answered.contacts.map((contact) => ({ ...contact })),
      standingRules: answered.standingRules.map((rule) => ({ ...rule })),
    })
  })

  /**
   * Unexpired Announcements, newest posted first — the home screen's own read
   * (#46, ADR 0018). `readEverything()`, because a wall in the barn is read by
   * every Volunteer who walks past it.
   */
  api.route('GET', '/announcements', readEverything(), async ({ context }) => {
    const answered = await forOrg(context.orgId).run(async (db) => {
      const on = await dayHere(db)
      return { on, announcements: await currentAnnouncements(db, on) }
    })
    return json({
      today: answered.on,
      announcements: answered.announcements.map((announcement) => ({ ...announcement })),
    })
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
      announcements: grid.announcements.map((announcement) => ({ ...announcement })),
    })
  })

  /**
   * The Patterns and their Standing Rosters.
   *
   * `readEverything()`: a volunteer looking at Tuesday mornings is reading the
   * rescue's own noticeboard, and the gate on each name is shown rather than
   * the read refused (ADR 0010).
   */
  api.route('GET', '/shift-patterns', readEverything(), async ({ context }) => {
    const answered = await forOrg(context.orgId).run(async (db) => {
      const on = await dayHere(db)
      return { on, patterns: await patternList(db, on) }
    })

    return json({
      today: answered.on,
      patterns: answered.patterns.map((pattern) => ({
        ...pattern,
        roster: pattern.roster.map((member) => ({ ...member, gaps: [...member.gaps] })),
      })),
    })
  })

  /**
   * The schedule from today forward — the Coordinator's fortnight and the
   * volunteer's own Shifts, which are the same rows read at two distances.
   */
  api.route('GET', '/shifts', readEverything(), async ({ context }) => {
    const answered = await forOrg(context.orgId).run(async (db) => {
      const clock = await clockHere(db)
      return { clock, shifts: await shiftList(db, clock.today, clock.timeZone) }
    })

    return json({
      today: answered.clock.today,
      shifts: answered.shifts.map((shift) => ({
        ...shift,
        roster: shift.roster.map((member) => ({ ...member, gaps: [...member.gaps] })),
        staffing: { ...shift.staffing, gaps: [...shift.staffing.gaps] },
        attendance: shift.attendance.map((member) => ({ ...member })),
      })),
    })
  })

  /**
   * One dated Shift's checklist, on opening (ADR 0013): its own Items, the
   * day's per-Day ones, and the Prep it is owed.
   *
   * `readEverything()`: a volunteer opening a Shift is reading a checklist
   * that already hangs on the barn wall.
   */
  api.route('GET', '/shifts/:shiftId', readEverything(), async ({ context, params }) => {
    interface Found {
      readonly id: string
      readonly day: DayString
      readonly shiftType: ShiftType
      readonly closedAt: number | null
      readonly checklist: Checklist
      readonly openAttendanceCount: number
      readonly undispositionedObservationCount: number
      readonly shiftNotes: Awaited<ReturnType<typeof shiftNotesFor>>
    }

    const found: Found | null = await forOrg(context.orgId).run(
      async (db): Promise<Found | null> => {
        const clock = await clockHere(db)
        const shift = await shiftById(db, params.shiftId ?? '')
        if (shift === null || shift.shiftType === 'pop_up') return null
        const shiftType = shift.shiftType
        const [checklist, counts, notes] = await Promise.all([
          checklistForShift(db, { id: shift.id, day: shift.day, shiftType }, clock.timeZone),
          closeCountsFor(db, shift.id),
          shiftNotesFor(db, shift.day, clock.timeZone),
        ])
        return {
          id: shift.id,
          day: shift.day,
          shiftType,
          closedAt: shift.closedAt,
          checklist,
          openAttendanceCount: counts.openAttendanceCount,
          undispositionedObservationCount: counts.undispositionedObservationCount,
          shiftNotes: notes,
        }
      },
    )
    if (found === null) return json({ error: 'shift_not_found' }, 404)

    return json({
      shiftId: found.id,
      day: found.day,
      shiftType: found.shiftType,
      materialized: found.checklist.materialized,
      items: found.checklist.items.map((item) => ({ ...item })),
      prepOwed: found.checklist.prepOwed.map((item) => ({ ...item })),
      closedAt: found.closedAt,
      openAttendanceCount: found.openAttendanceCount,
      undispositionedObservationCount: found.undispositionedObservationCount,
      shiftNotes: found.shiftNotes.map((note) => ({ ...note })),
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

  /**
   * The Task catalogue (ADR 0013). `readEverything()`: what a checklist Item
   * is made of is barn knowledge, the same reason `/thresholds` is on the
   * floor. Editing is `horse_care`.
   */
  api.route('GET', '/tasks', readEverything(), async ({ context }) => {
    const listed = await forOrg(context.orgId).run((db) => taskList(db))
    return json({ tasks: listed.map((each) => ({ ...each })) })
  })

  /**
   * Which Shift Type normally does which Task, and the decisions still owed —
   * the tri-state ADR 0015 gave Thresholds, generalized (ADR 0013).
   */
  api.route('GET', '/task-assignments', readEverything(), async ({ context }) => {
    const answered = await forOrg(context.orgId).run(async (db) => {
      const on = await dayHere(db)
      const [catalog, assignments] = await Promise.all([
        taskList(db),
        currentTaskAssignments(db, on),
      ])
      const tasks = await Promise.all(
        catalog.map(async (item) => {
          const subjects = await subjectsFor(db, item.subjectKind)
          const forTask = assignments.filter((row) => row.taskId === item.id)
          const known = (row: (typeof subjects)[number]) =>
            forTask.some((each) => each.horseId === row.horseId && each.spaceId === row.spaceId)
          return {
            taskId: item.id,
            assignments: forTask.flatMap((row) => {
              const subject = subjects.find(
                (each) => each.horseId === row.horseId && each.spaceId === row.spaceId,
              )
              if (subject === undefined) return []
              return [{ ...row, name: subject.name }]
            }),
            undecided: subjects.filter((row) => !known(row)),
          }
        }),
      )
      return { on, tasks }
    })

    return json({
      today: answered.on,
      tasks: answered.tasks.map((entry) => ({
        ...entry,
        assignments: [...entry.assignments],
        undecided: [...entry.undecided],
      })),
    })
  })

  /**
   * The sign-in sheet, whole — every Visit and every Shift sign-in, newest
   * first. Behind `roster`, which is where this ticket puts the hours report
   * built from it (`src/server/attendance/list.ts` says why, against ADR
   * 0012's own tension on this point).
   */
  api.route('GET', '/attendance', domainScope('roster'), async ({ context }) => {
    const entries = await forOrg(context.orgId).run(async (db) => {
      const clock = await clockHere(db)
      return attendanceLedger(db, clock.timeZone)
    })
    return json({ entries: entries.map((entry) => ({ ...entry })) })
  })

  /**
   * One Attendance's own Observations — the Visit sign-out screen's own read,
   * and readable to everyone on ADR 0010's floor (ADR 0014).
   */
  api.route('GET', '/observations/:attendanceId', readEverything(), async ({ context, params }) => {
    const entries = await forOrg(context.orgId).run((db) =>
      observationsFor(db, params.attendanceId ?? ''),
    )
    return json({
      observations: entries.map((entry) => ({
        ...entry,
        escalatedScopes: [...entry.escalatedScopes],
      })),
    })
  })

  /**
   * Every Escalation, on the floor — "everyone reads everything," and the
   * home section that shows only a holder's open ones is the phone filtering
   * this same read rather than a second one (ADR 0014).
   */
  api.route('GET', '/escalations', readEverything(), async ({ context }) => {
    const entries = await forOrg(context.orgId).run((db) => escalationList(db))
    return json({
      escalations: entries.map((entry) => ({ ...entry, comments: [...entry.comments] })),
    })
  })

  api.mutation('/spaces', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await createSpace(db, context.orgId, actor.volunteerId, input)
    if (!outcome.ok) return horseRefusal(outcome.because)
    return json({ spaceId: outcome.value.id }, 201)
  })

  /**
   * Several Spaces in one act — the ten-stalls-in-the-Big-Barn write. The
   * names arrive already made (`seriesNames` on the screen), and what already
   * existed comes back named rather than silently dropped.
   */
  api.mutation('/spaces/batch', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await createSpaces(db, context.orgId, actor.volunteerId, input)
    if (!outcome.ok) return horseRefusal(outcome.because)
    return json(
      {
        spaceIds: outcome.value.created.map((space) => space.id),
        skipped: outcome.value.skipped,
      },
      201,
    )
  })

  api.mutation('/spaces/edit', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await editSpace(db, context.orgId, actor.volunteerId, input)
    return outcome.ok ? noContent() : horseRefusal(outcome.because)
  })

  api.mutation('/spaces/retirement', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await recordSpaceRetirement(db, context.orgId, actor.volunteerId, input)
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

  /** Posts a Contact, under `roster` — the same Scope Contacts is edited under (ADR 0014). */
  api.mutation('/contacts', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await createContact(db, context.orgId, actor.volunteerId, {
      name: input.name,
      number: input.number,
      hours: input.hours ?? null,
      purpose: input.purpose,
    })
    if (!outcome.ok) return contactRefusal(outcome.because)
    return json({ contactId: outcome.value.id }, 201)
  })

  api.mutation('/contacts/edit', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await editContact(db, context.orgId, actor.volunteerId, input)
    return outcome.ok ? noContent() : contactRefusal(outcome.because)
  })

  /** Adds a standing rule — the Reminders panel's residue, under `roster` (ADR 0018). */
  api.mutation('/standing-rules', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await createStandingRule(db, context.orgId, actor.volunteerId, input)
    if (!outcome.ok) return contactRefusal(outcome.because)
    return json({ standingRuleId: outcome.value.id }, 201)
  })

  api.mutation('/standing-rules/edit', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await editStandingRule(db, context.orgId, actor.volunteerId, {
      standingRuleId: input.standingRuleId,
      text: input.text,
      reason: input.reason ?? null,
    })
    return outcome.ok ? noContent() : contactRefusal(outcome.because)
  })

  /**
   * Posts an Announcement. Any single Domain Scope — the check ADR 0018 asks
   * for, unnamed rather than enumerated (`anyScopeHolder`).
   */
  api.mutation('/announcements', anyScopeHolder(), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await createAnnouncement(db, context.orgId, actor.volunteerId, input)
    if (!outcome.ok) return announcementRefusal(outcome.because)
    return json({ announcementId: outcome.value.id }, 201)
  })

  /**
   * Edits an Announcement in place — by the author or any Domain Scope
   * holder, which is the same check as posting: ADR 0010 has no authorship
   * axis for this to lean on instead (ADR 0018).
   */
  api.mutation('/announcements/edit', anyScopeHolder(), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await editAnnouncement(db, context.orgId, actor.volunteerId, {
      announcementId: input.announcementId,
      text: input.text,
      expiresOn: input.expiresOn,
    })
    return outcome.ok ? noContent() : announcementRefusal(outcome.because)
  })

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
   * A Shift Pattern, under `roster` — the Domain Scope that owns who is on a
   * Shift (ADR 0010). Creating one generates nothing: generation is a
   * deliberate act of its own (ADR 0001).
   */
  api.mutation('/shift-patterns', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await createPattern(db, context.orgId, actor.volunteerId, input)
    if (!outcome.ok) return shiftRefusal(outcome.because)
    return json({ shiftPatternId: outcome.value.id }, 201)
  })

  /**
   * Editing a Pattern, and answering ADR 0001's prompt in the same request.
   *
   * The prompt is the endpoint's shape rather than a screen's habit: a caller
   * that did not decide cannot send this, which is what stops the most common
   * editing case from being quietly wrong.
   */
  api.mutation('/shift-patterns/edit', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await editPattern(db, context.orgId, actor.volunteerId, {
      patternId: input.shiftPatternId,
      startTime: input.startTime,
      targetHeadcount: input.targetHeadcount,
      applyToScheduled: input.applyToScheduled,
      reason: input.reason ?? null,
      today: await dayHere(db),
    })
    if (!outcome.ok) return shiftRefusal(outcome.because)
    return json({ scheduledTouched: outcome.value.scheduledTouched })
  })

  api.mutation('/shift-patterns/roster', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await assignToStandingRoster(db, context.orgId, actor.volunteerId, {
      patternId: input.shiftPatternId,
      volunteerId: input.volunteerId,
      position: input.position,
      applyToScheduled: input.applyToScheduled,
      today: await dayHere(db),
    })
    if (!outcome.ok) return shiftRefusal(outcome.because)
    return json({
      scheduledTouched: outcome.value.scheduledTouched,
      leadHeldOn: outcome.value.leadHeldOn,
    })
  })

  /**
   * Retiring a Pattern. It generates nothing from here on, and every Shift it
   * already made stands (ADR 0001).
   */
  api.mutation(
    '/shift-patterns/retirement',
    domainScope('roster'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await retirePattern(db, context.orgId, actor.volunteerId, {
        patternId: input.shiftPatternId,
        retired: input.retired,
        reason: input.reason ?? null,
      })
      return outcome.ok ? noContent() : shiftRefusal(outcome.because)
    },
  )

  api.mutation(
    '/shift-patterns/roster-removal',
    domainScope('roster'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await removeFromStandingRoster(db, context.orgId, actor.volunteerId, {
        patternId: input.shiftPatternId,
        volunteerId: input.volunteerId,
        applyToScheduled: input.applyToScheduled,
        reason: input.reason ?? null,
        today: await dayHere(db),
      })
      if (!outcome.ok) return shiftRefusal(outcome.because)
      return json({ scheduledTouched: outcome.value.scheduledTouched })
    },
  )

  /**
   * Filling the horizon (ADR 0001). A write rather than a job, for now and
   * deliberately: it must never run at boot, and until there is a scheduler the
   * hand that runs it is the Coordinator's.
   */
  api.mutation('/shifts/generation', domainScope('roster'), async (_input, { context, db }) => {
    const actor = actorOf(context)
    const clock = await clockHere(db)
    const outcome = await generateHorizon(db, context.orgId, actor.volunteerId, clock)
    if (!outcome.ok) return shiftRefusal(outcome.because)
    return json({ created: outcome.value.created, through: outcome.value.through }, 201)
  })

  /** A Pop-up, created on demand and staffed by Sign-up (ADR 0011). */
  api.mutation('/shifts', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await createPopUp(db, context.orgId, actor.volunteerId, input)
    if (!outcome.ok) return shiftRefusal(outcome.because)
    return json({ shiftId: outcome.value.id }, 201)
  })

  api.mutation('/shifts/roster', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await assignToShift(db, context.orgId, actor.volunteerId, {
      shiftId: input.shiftId,
      volunteerId: input.volunteerId,
      position: input.position,
      today: await dayHere(db),
    })
    if (!outcome.ok) return shiftRefusal(outcome.because)
    return json({ rosterId: outcome.value.id }, 201)
  })

  /** Taking somebody else off, which is authority over the roster (ADR 0010). */
  api.mutation('/shifts/roster-removal', domainScope('roster'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await removeFromShift(db, context.orgId, actor.volunteerId, {
      shiftId: input.shiftId,
      volunteerId: input.volunteerId,
      reason: input.reason ?? null,
    })
    return outcome.ok ? noContent() : shiftRefusal(outcome.because)
  })

  /**
   * A Cover, on the floor: anybody oriented, claiming a place themselves.
   *
   * It credits the actor and nobody else — you cannot Cover on somebody's
   * behalf, because a commitment made for you is not a commitment. It is
   * refused only for a Shift that is not there or an Orientation that is not
   * recorded, and **never for what the volunteer lacks** (ADR 0011).
   */
  api.mutation(
    '/shifts/cover',
    floor('commit-to-or-leave-a-shift'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await coverShift(db, context.orgId, actor.volunteerId, {
        shiftId: input.shiftId,
        today: await dayHere(db),
      })
      if (!outcome.ok) return shiftRefusal(outcome.because)
      return json({ rosterId: outcome.value.id }, 201)
    },
  )

  /**
   * A Drop, on the floor and about yourself: it marks the roster row on this
   * Shift alone and never touches the Pattern behind it (ADR 0001, ADR 0011).
   */
  api.mutation(
    '/shifts/drop',
    floor('commit-to-or-leave-a-shift'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await dropFromShift(db, context.orgId, actor.volunteerId, {
        shiftId: input.shiftId,
        reason: input.reason ?? null,
        today: await dayHere(db),
      })
      return outcome.ok ? noContent() : shiftRefusal(outcome.because)
    },
  )

  /**
   * An Acting Lead claim, on the floor and about a Shift you are already on.
   *
   * `floor('work-on-a-shift-you-are-rostered-on')` rather than `roster` or
   * Shift Authority, and that is ADR 0010's own arrangement: **any** rostered
   * volunteer may claim, because restricting it to the suggested person leaves
   * a Shift leaderless exactly when that person did not show. Being on the
   * roster is the condition, and `claimActingLead` is where it is checked
   * because it is a fact about this Shift's rows rather than about the caller.
   */
  api.mutation(
    '/shifts/acting-lead',
    floor('work-on-a-shift-you-are-rostered-on'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await claimActingLead(db, actor.volunteerId, {
        shiftId: input.shiftId,
        today: await dayHere(db),
      })
      if (!outcome.ok) return shiftRefusal(outcome.because)
      return json({ rosterId: outcome.value.id }, 201)
    },
  )

  /**
   * Short: declared and cleared by a person (ADR 0011).
   *
   * `shiftAuthority(['roster'])`, which is the **first endpoint in the system
   * to declare it** — ADR 0010's second reason anybody may act, unresolvable
   * until #39 made Shifts real. It resolves to a standing `lead`, `co_lead` or
   * `acting_lead` row on this Shift, **or** `roster`, which is ADR 0011's own
   * list for this act and is where officers come in since they hold every
   * scope. The scope is named here rather than built into Shift Authority
   * itself, so that a later write declaring it does not silently inherit a
   * Coordinator. `src/server/api/route.ts` runs the join before this handler,
   * from the `shiftId` below.
   *
   * The app is on neither side of the judgement. It does not declare Short and
   * it does not withdraw it — not even when a third volunteer Covers.
   */
  api.mutation('/shifts/short', shiftAuthority(['roster']), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await declareShort(db, actor.volunteerId, {
      shiftId: input.shiftId,
      short: input.short,
    })
    return outcome.ok ? noContent() : shiftRefusal(outcome.because)
  })

  /**
   * The evening digest, sent on a deliberate press (ADR 0011).
   *
   * Under `roster` — the people it mails are the people who may send it, which
   * is right for the one message the app sends about staffing. The counts come
   * back so a send that failed is visible rather than assumed.
   */
  api.mutation('/shifts/digest', domainScope('roster'), async (_input, { db }) => {
    return json(await sendStaffingDigest(db, await clockHere(db)), 200)
  })

  /**
   * Adding a Task to the catalogue, under `horse_care` — the scope that owns
   * care instructions, the same reason it edits Thresholds and Feed Schedules
   * (ADR 0013).
   */
  api.mutation('/tasks', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await createTask(db, context.orgId, actor.volunteerId, input)
    if (!outcome.ok) return checklistRefusal(outcome.because)
    return json({ taskId: outcome.value.id }, 201)
  })

  api.mutation('/tasks/edit', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await editTask(db, context.orgId, actor.volunteerId, input)
    return outcome.ok ? noContent() : checklistRefusal(outcome.because)
  })

  /**
   * Publishing a Task Assignment — which Shift Type normally does one Task
   * for one Subject, the `GROOM` column generalized (ADR 0013). Under
   * `horse_care`, the same scope that owns the catalogue behind it.
   */
  api.mutation('/task-assignments', domainScope('horse_care'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await publishTaskAssignment(db, context.orgId, actor.volunteerId, input)
    if (!outcome.ok) return checklistRefusal(outcome.because)
    return json({ taskAssignmentId: outcome.value.id }, 201)
  })

  /**
   * Materializes today's Items — deliberate, like `/shifts/generation` and
   * `/weather/readings`, and safe to run twice (ADR 0013). Under `horse_care`:
   * it resolves care instructions the same scope owns.
   */
  api.mutation(
    '/items/materialization',
    domainScope('horse_care'),
    async (_input, { context, db }) => {
      const clock = await clockHere(db)
      return json(await materializeDayFor(db, context.orgId, clock.today, clock.timeZone), 200)
    },
  )

  /**
   * Ticks an Item Done, on the floor: any Volunteer rostered on the Shift
   * named may complete any Item it shows (ADR 0013) — never Shift Authority,
   * which #34 already refused as a third axis past ADR 0010's two. The roster
   * join and the Medication Authority check both live in `tickItemDone`,
   * because they are facts about this Shift's rows and this Item, not about
   * the caller in general.
   */
  api.mutation(
    '/items/done',
    floor('work-on-a-shift-you-are-rostered-on'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await tickItemDone(db, context.orgId, actor.volunteerId, {
        shiftId: input.shiftId,
        itemId: input.itemId,
      })
      if (!outcome.ok) return tickRefusal(outcome.because)
      return json({ itemOutcomeId: outcome.value.id }, 201)
    },
  )

  /**
   * Drops a Discretionary Item — recorded, never silent (ADR 0013, #45).
   * `shiftAuthority()`: `mutation`'s own join settles the position over the
   * Shift named; `dropItem` checks what that join cannot — whether the Item
   * is Discretionary at all, and whether it has already gone overdue.
   */
  api.mutation('/items/drop', shiftAuthority(), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await dropItem(db, context.orgId, actor.volunteerId, {
      shiftId: input.shiftId,
      itemId: input.itemId,
      reason: input.reason ?? null,
    })
    if (!outcome.ok) return tickRefusal(outcome.because)
    return json({ itemOutcomeId: outcome.value.id }, 201)
  })

  /**
   * Records an Item Not done, with a required reason — on the floor, the same
   * stand `/items/done` takes: ADR 0013 gives Not done no Shift-Authority gate,
   * and this is also how a deviation from the materialized plan is recorded
   * without the plan itself ever changing mid-Shift (#45).
   */
  api.mutation(
    '/items/not-done',
    floor('work-on-a-shift-you-are-rostered-on'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await notDoneItem(db, context.orgId, actor.volunteerId, {
        shiftId: input.shiftId,
        itemId: input.itemId,
        reason: input.reason,
      })
      if (!outcome.ok) return tickRefusal(outcome.because)
      return json({ itemOutcomeId: outcome.value.id }, 201)
    },
  )

  /**
   * Sets or clears who is expected to do an Item — a hint, never a gate (ADR
   * 0013, #45). On the floor: self-claim needs only to be rostered, and
   * naming somebody else needs Shift Authority, both checked inside
   * `assignItem` because half of it is a fact about this Shift's own roster
   * rows.
   */
  api.mutation(
    '/items/assign',
    floor('work-on-a-shift-you-are-rostered-on'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const holdsAuthority = await holdsShiftAuthority(context.orgId, actor, input.shiftId)
      const outcome = await assignItem(
        db,
        { volunteerId: actor.volunteerId, holdsShiftAuthority: holdsAuthority },
        { shiftId: input.shiftId, itemId: input.itemId, volunteerId: input.volunteerId },
      )
      return outcome.ok ? noContent() : tickRefusal(outcome.because)
    },
  )

  /**
   * Curates a Shift Note (ADR 0013, #45): Shift Authority while the Shift
   * stands, `horse_care` after it closes — `shiftAuthority(['horse_care'])`
   * settles both, and `addShiftNote` refuses the one case that check cannot:
   * Shift Authority alone, against a Shift that has already closed.
   */
  api.mutation('/shifts/notes', shiftAuthority(['horse_care']), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await addShiftNote(
      db,
      context.orgId,
      { volunteerId: actor.volunteerId, holdsHorseCare: actor.domainScopes.includes('horse_care') },
      { shiftId: input.shiftId, text: input.text, horseId: input.horseId ?? null },
    )
    if (!outcome.ok) return shiftRefusal(outcome.because)
    return json({ shiftNoteId: outcome.value.id }, 201)
  })

  /**
   * Closes a Shift — the record becoming true (ADR 0013, ADR 0014, #45).
   * `shiftAuthority()`: only the position over this Shift closes it, and the
   * concrete blockers a refusal here answers with are the same read the phone
   * already had before it ever attempted this.
   */
  api.mutation('/shifts/close', shiftAuthority(), async (input, { context, db }) => {
    const actor = actorOf(context)
    const clock = await clockHere(db)
    const outcome = await closeShift(
      db,
      context.orgId,
      actor.volunteerId,
      { shiftId: input.shiftId },
      clock.timeZone,
    )
    if (!outcome.ok) return shiftRefusal(outcome.because)
    return json({ closedAt: outcome.value.closedAt }, 200)
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

  /**
   * An arrival, against a Shift or as a Visit (ADR 0012). On the floor: this
   * is what makes recording your own presence — or somebody else's, in either
   * direction — a thing that needs no Domain Scope, on the same reasoning as
   * Cover and Drop. What makes it safe rather than a forgery surface is that
   * `signIn` always attributes the write to the actor, never to the subject
   * alone.
   */
  api.mutation(
    '/attendance/sign-in',
    floor('record-your-own-presence'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await signIn(db, context.orgId, actor.volunteerId, {
        volunteerId: input.volunteerId,
        shiftId: input.shiftId ?? null,
        description: input.description ?? null,
        category: input.category ?? null,
      })
      if (!outcome.ok) return attendanceRefusal(outcome.because)
      return json({ attendanceId: outcome.value.id }, 201)
    },
  )

  /**
   * A departure. Never invented by the app — this is the one write that ever
   * closes an Attendance, and it always names who did (ADR 0012). Resolved
   * from the Volunteer and, where given, the Shift, rather than an Attendance
   * id: that is what lets a plain Volunteer close their own Visit without
   * first reading the ledger behind `roster`.
   */
  api.mutation(
    '/attendance/sign-out',
    floor('record-your-own-presence'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await signOut(db, context.orgId, actor.volunteerId, {
        volunteerId: input.volunteerId,
        shiftId: input.shiftId ?? null,
        supervisingAdultId: input.supervisingAdultId ?? null,
        supervisingAdultPhone: input.supervisingAdultPhone ?? null,
        attestationRelationship: input.attestationRelationship ?? null,
      })
      return outcome.ok ? noContent() : attendanceRefusal(outcome.because)
    },
  )

  /**
   * Records an Observation, on ADR 0010's floor: needs no Domain Scope, and
   * attaches to the recorder's own open Attendance. `observerVolunteerId` is
   * Shift Authority's own act, checked inside `recordObservation` because
   * `shiftId` is nullable here and so this write can never declare Shift
   * Authority's own type (`src/server/api/route.ts`).
   */
  api.mutation('/observations', floor('record-an-observation'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await recordObservation(db, context.orgId, actor, {
      shiftId: input.shiftId ?? null,
      text: input.text,
      subjectKind: input.subjectKind ?? null,
      subjectId: input.subjectId ?? null,
      subjectLabel: input.subjectLabel ?? null,
      observerVolunteerId: input.observerVolunteerId ?? null,
    })
    if (!outcome.ok) return observationRefusal(outcome.because)
    return json({ observationId: outcome.value.id }, 201)
  })

  /**
   * A Visit's own second exit at sign-out: noted, with no action — belongs to
   * the Observation's own recorder alone, checked inside `noteObservation`
   * (ADR 0014).
   */
  api.mutation(
    '/observations/note',
    floor('disposition-your-own-observation'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await noteObservation(db, actor.volunteerId, {
        observationId: input.observationId,
      })
      return outcome.ok ? noContent() : observationRefusal(outcome.because)
    },
  )

  /**
   * A Shift's own two remaining exits, at close — Shift Authority's own act
   * (ADR 0014, #45). `shiftAuthority()` settles the position over the Shift
   * named; `dispositionShiftObservation` checks the rest — that the
   * Observation is actually this Shift's, and that nobody has dispositioned
   * it yet.
   */
  api.mutation('/observations/disposition', shiftAuthority(), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await dispositionShiftObservation(db, context.orgId, actor, {
      shiftId: input.shiftId,
      observationId: input.observationId,
      disposition: input.disposition,
      noteText: input.noteText ?? null,
    })
    return outcome.ok ? noContent() : observationRefusal(outcome.because)
  })

  /**
   * Escalates an Observation to one Domain Scope: Shift Authority over the
   * Shift it was recorded on, or a holder of `scope` adopting it into their
   * own — both resolved inside `escalateObservation` rather than declared
   * here, for the same reason the on-behalf check above is (ADR 0014). Mails
   * the Scope's current holders.
   */
  api.mutation('/escalations', floor('escalate-an-observation'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await escalateObservation(db, context.orgId, actor, {
      observationId: input.observationId,
      scope: input.scope,
      framing: input.framing,
    })
    if (!outcome.ok) return observationRefusal(outcome.because)

    const clock = await clockHere(db)
    await notifyEscalated(db, clock, {
      scope: input.scope,
      framing: input.framing,
      observationText: outcome.value.observationText,
    })
    return json({ escalationId: outcome.value.id }, 201)
  })

  /**
   * Appends to an Escalation's thread — ADR 0010's fourth scope-free write
   * (ADR 0014). Mails the destination Scope's current holders and the
   * reporter.
   */
  api.mutation(
    '/escalations/comments',
    floor('comment-on-an-escalation'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await addEscalationComment(db, context.orgId, actor.volunteerId, {
        escalationId: input.escalationId,
        text: input.text,
      })
      if (!outcome.ok) return observationRefusal(outcome.because)

      const clock = await clockHere(db)
      const to = await reporterEmail(db, outcome.value.observedBy)
      await notifyCommented(db, clock, outcome.value.scope, to, { text: input.text })
      return json({ commentId: outcome.value.id }, 201)
    },
  )

  /**
   * Closes an Escalation: a holder of its own addressed Scope, and a note —
   * checked inside `closeEscalation`, for the reason escalating is (ADR
   * 0014). Mails the reporter the closing note in full — never a teaser.
   */
  api.mutation(
    '/escalations/close',
    floor('close-an-escalation'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await closeEscalation(db, actor, {
        escalationId: input.escalationId,
        note: input.note,
      })
      if (!outcome.ok) return observationRefusal(outcome.because)

      const clock = await clockHere(db)
      const to = await reporterEmail(db, outcome.value.observedBy)
      await notifyClosed(clock.organisation, to, { closingNote: input.note })
      return noContent()
    },
  )

  /**
   * Appends a Days-of-Supply reading — a `supplies` holder from anywhere, or
   * Shift Authority over the Shift named, both resolved inside
   * `recordSuppliesReading` rather than declared here, for the same reason
   * the on-behalf check on `/observations` is (ADR 0019).
   */
  api.mutation(
    '/supplies/readings',
    floor('record-a-supplies-reading'),
    async (input, { context, db }) => {
      const actor = actorOf(context)
      const outcome = await recordSuppliesReading(db, context.orgId, actor, {
        productId: input.productId,
        daysRemaining: input.daysRemaining,
        countedOn: input.countedOn,
        shiftId: input.shiftId ?? null,
      })
      if (!outcome.ok) return suppliesRefusal(outcome.because)
      return json({ readingId: outcome.value.id }, 201)
    },
  )

  /**
   * Opens a Reorder against one Product, under `supplies` — `escalationId`
   * links it back to the Escalation it may have been created from, sharing no
   * state with it (ADR 0019).
   */
  api.mutation('/reorders', domainScope('supplies'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await openReorder(db, context.orgId, actor.volunteerId, {
      productId: input.productId,
      escalationId: input.escalationId ?? null,
    })
    if (!outcome.ok) return suppliesRefusal(outcome.because)
    return json({ reorderId: outcome.value.id }, 201)
  })

  /**
   * Appends to a Reorder's thread, under `supplies` — never floor-writable,
   * unlike the Escalation's own thread (ADR 0019).
   */
  api.mutation('/reorders/comments', domainScope('supplies'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await addReorderComment(db, context.orgId, actor.volunteerId, {
      reorderId: input.reorderId,
      text: input.text,
    })
    if (!outcome.ok) return suppliesRefusal(outcome.because)
    return json({ commentId: outcome.value.id }, 201)
  })

  /** Closes a Reorder with a note, under `supplies` — there is no reopen (ADR 0019). */
  api.mutation('/reorders/close', domainScope('supplies'), async (input, { context, db }) => {
    const actor = actorOf(context)
    const outcome = await closeReorder(db, actor.volunteerId, {
      reorderId: input.reorderId,
      note: input.note,
    })
    return outcome.ok ? noContent() : suppliesRefusal(outcome.because)
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
