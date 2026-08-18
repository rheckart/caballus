/**
 * The tables. The domain lands ticket by ticket, and inventing rows ahead of
 * the decisions that shape them is how the two previous attempts at this
 * application accumulated a model nobody wanted.
 *
 * Two things nearly every table here carries: an `org_id` (the `orgs` table is
 * the organisation itself) and a row-level security policy that fails closed
 * when `app.org_id` is unset — ADR 0007's one structural guarantee.
 *
 * **Better Auth's three are the exception, deliberately** (ADR 0008). `user`,
 * `session` and `verification` are identity, and identity is not org-scoped:
 * one person signing in is one person, and which rescue they act for is a
 * membership row of ours that the policies do reach. They also cannot be
 * scoped even if we wanted to — Better Auth issues its own queries outside
 * `forOrg`, so a policy over `app.org_id` would fail closed on every sign-in.
 * The membership half is `volunteer_accounts`, and it is scoped like
 * everything else.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

/**
 * The policy nearly every table carries (ADR 0007). One function rather than
 * eleven copies of the same two lines: a policy that fails closed is the single
 * structural guarantee this stack was chosen for, and the way to keep that true
 * across a growing schema is to make the correct one the shortest thing to
 * write.
 *
 * `current_setting('app.org_id', true)` is null when nothing set it, and `=`
 * against null is null rather than true — so a query outside `forOrg` sees zero
 * rows instead of somebody else's.
 */
function inScope(name: string) {
  return pgPolicy(name, {
    for: 'all',
    using: sql`org_id::text = current_setting('app.org_id', true)`,
    withCheck: sql`org_id::text = current_setting('app.org_id', true)`,
  })
}

export const orgs = pgTable(
  'orgs',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    /** IANA zone. The day boundary belongs to the organisation (ADR 0007). */
    timeZone: text('time_zone').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('orgs_in_scope', {
      for: 'all',
      using: sql`id::text = current_setting('app.org_id', true)`,
      withCheck: sql`id::text = current_setting('app.org_id', true)`,
    }),
  ],
).enableRLS()

/**
 * What the server already answered for a key it has seen (ADR 0005).
 *
 * This is the half a type could not enforce. `mutation` will not compile
 * without a key and logs the one it got, but a key nothing is written down
 * beside dedupes nothing — and a retry is indistinguishable, from the phone's
 * side, between *the request never arrived* and *the response was lost on the
 * way back*. The row is written inside the same transaction as the work it
 * describes, so the record and the effect commit together or not at all.
 *
 * The primary key is the uniqueness ADR 0007 asks for. That ADR calls it a
 * *partial* unique index, which is the shape it takes when the key lives on
 * the table it created a row in — and the same ADR gives the reason that does
 * not work here: ticking a checklist item and closing a shift create no row,
 * and those are the majority of a shift's writes. A key with nowhere to live
 * needs a table of its own, and on that table the constraint is total.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    /** Minted on the phone before the first attempt, and never an entity id. */
    key: uuid('idempotency_key').notNull(),
    /** `POST /observations`, for the log and for reading the table at 2am. */
    route: text('route').notNull(),
    /** The request this key first arrived with — see `src/server/api/fingerprint.ts`. */
    fingerprint: text('fingerprint').notNull(),
    /**
     * What was answered. Null only between the insert that claims the key and
     * the update that records the answer, which are two statements of one
     * transaction — so a *committed* null cannot exist, and the code that
     * reads these treats one as a conflict rather than pretending it is a
     * replay of nothing.
     */
    status: integer('status'),
    response: text('response'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.key] }),
    // For the sweep that enforces retention, which is a scan of this column
    // and nothing else.
    index('idempotency_keys_recorded_at').on(table.recordedAt),
    inScope('idempotency_keys_in_scope'),
  ],
).enableRLS()

/**
 * Better Auth's user, and the whole of what identity owns about a person
 * (ADR 0008). The name and email here are the ones the sign-in was performed
 * against; the barn's record of who somebody is lives on `volunteers`, which
 * exists before this row and outlives it.
 *
 * The shape is Better Auth's rather than ours — the adapter reads these keys —
 * so the columns are named the way its models are, with SQL names in this
 * repository's snake case.
 */
export const users = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * A session is a row, and that is the entire security model (ADR 0008).
 *
 * There are no JWTs anywhere, so revocation is a delete with no staleness
 * window — and because ADR 0004 makes sessions permanent, revocation is the
 * only control there is. `expires_at` is set as far out as a browser will hold
 * a cookie by `src/server/auth/auth.ts`, so that nothing but a decision signs
 * anybody out inside the horizon a volunteer works on; see that file for what
 * the 400-day cap in RFC 6265bis costs and where the remaining gap is.
 */
export const sessions = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Revoking an account deletes every session a user holds, which is this
  // index and not a scan.
  (table) => [index('session_user_id').on(table.userId)],
)

/**
 * Where a six-digit code lives for the five minutes it is worth anything
 * (ADR 0009). Better Auth writes it, expires it, and invalidates it after the
 * allowed attempts; nothing in this application reads the table.
 */
export const verifications = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('verification_identifier').on(table.identifier)],
)

/**
 * A person at the rescue. **This record exists before an Account and after
 * it** (ADR 0008): the Coordinator creates a Volunteer from a name and an
 * email address and that record is immediately rosterable, because ADR 0001
 * has shifts copying their roster and somebody must be able to roster a person
 * who has not onboarded and may never.
 *
 * Everything in the care record references this row and never `user` — which
 * is what makes revoking an Account survivable: the work they did still
 * happened, and it still has a subject.
 *
 * Removal is a date, not a delete, for the same reason.
 */
export const volunteers = pgTable(
  'volunteers',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    name: text('name').notNull(),
    /**
     * Required at invite and lower-cased on the way in (ADR 0009): it is the
     * precondition for having an account at all, since the credential is a
     * code sent to it. Comparison is exact, so normalisation happens once, in
     * `src/server/auth/volunteers.ts`, rather than at every call site.
     */
    email: text('email').notNull(),
    /**
     * Still collected, no longer enforced (ADR 0009). Backfilling sixty of
     * these later is the kind of chore that never happens, and it is what SMS
     * returns to.
     */
    mobile: text('mobile'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Removed from the rescue. The work they did still happened. */
    removedAt: timestamp('removed_at', { withTimezone: true }),

    /**
     * The date of birth, and **how it was established** (ADR 0017).
     *
     * A column and not a table, because it is one fact about one person that
     * cannot be held twice — ADR 0012's under-16 flag was deleted rather than
     * deprecated for exactly the reason ADR 0003 gives about halter colour on
     * the name plate *and* in a separate panel: the two already disagree.
     *
     * Who may read it is where the care goes. Day and month are a birthday and
     * sit on the floor; **the year and the derived age sit behind `roster`**
     * with contact details, because the year is the whole of the sensitive part
     * and the whole of the gate input. Redaction is
     * `src/server/roster/people.ts`, not this table.
     *
     * The app never holds the identity document — no image, no number, no
     * issuing state. Sixty driver's licence scans would be the highest-value
     * target in the system and would assert nothing the sighting below does not.
     */
    dateOfBirth: date('date_of_birth'),
    /** `photo_id` or `parent_provided` — see `DATE_OF_BIRTH_PROVENANCE`. */
    dateOfBirthProvenance: text('date_of_birth_provenance'),
    dateOfBirthRecordedBy: uuid('date_of_birth_recorded_by').references(
      (): AnyPgColumn => volunteers.id,
    ),
    dateOfBirthRecordedAt: timestamp('date_of_birth_recorded_at', { withTimezone: true }),

    /**
     * The Orientation: a date and who recorded it, on the Volunteer (ADR 0011).
     *
     * The first of the three gates and the one the barn treats as the moment
     * somebody joins. **It never lapses and is never revoked** — leaving the
     * rescue is the act that exists for that — so there is no revoked-at here
     * and there should never be one. Not yet oriented is a real state, and its
     * name is Candidate.
     */
    orientedOn: date('oriented_on'),
    orientationRecordedBy: uuid('orientation_recorded_by').references(
      (): AnyPgColumn => volunteers.id,
    ),
    orientationRecordedAt: timestamp('orientation_recorded_at', { withTimezone: true }),
  },
  (table) => [
    // One email, one *current* Volunteer within a rescue — because the email is
    // what a sign-in resolves through, and two live rows would make that
    // ambiguous at the moment somebody is standing in a barn.
    //
    // Partial, over the ones still here. Removal is a date rather than a delete
    // (the work they did still happened), so a total index would mean a
    // volunteer who leaves and comes back a season later cannot be created at
    // all — the coordinator would get a raw unique violation for an action the
    // app has no way to explain. `volunteerByEmail` matches the same predicate,
    // so the two cannot disagree about which row is the live one.
    uniqueIndex('volunteers_email_in_org')
      .on(table.orgId, table.email)
      .where(sql`removed_at is null`),
    inScope('volunteers_in_scope'),
  ],
).enableRLS()

/**
 * The Account, *claimed* rather than created (ADR 0008): a Volunteer with this
 * row has signed in at least once, and the `user` it points at is Better
 * Auth's. This is the membership fact ADR 0008 refused to let a token carry —
 * a row, in the same database, that an indexed read resolves on every request,
 * so removing it takes effect immediately rather than whenever something
 * forces a refresh.
 *
 * Revoking is `revoked_at` plus the delete of every session the user holds.
 * The row stays so that a revocation is a fact somebody can read, and so that
 * the next code request cannot silently re-claim what an officer just took
 * away.
 */
export const volunteerAccounts = pgTable(
  'volunteer_accounts',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    volunteerId: uuid('volunteer_id')
      .notNull()
      .references(() => volunteers.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.volunteerId] }),
    // One Better Auth user is one Volunteer **within a rescue**, and the
    // lookup every authenticated request makes.
    //
    // Scoped by `org_id` rather than unique on `user_id` alone, because an
    // index is not row-level-security-aware: a global one would enforce
    // itself across organisations and make somebody who volunteers at two
    // rescues unrepresentable — which is precisely the case ADR 0008 says
    // resolves through a server-side active organisation, and which ADR 0007
    // put `org_id` on every table to keep cheap.
    uniqueIndex('volunteer_accounts_user_in_org').on(table.orgId, table.userId),
    inScope('volunteer_accounts_in_scope'),
  ],
).enableRLS()

/**
 * A role somebody holds, carrying the barn's own words (ADR 0010). The mapping
 * from a role to the Domain Scopes it confers is a constant in code — in
 * `src/shared/roles.ts` — and never a row, because nobody at this
 * rescue will ever redefine what Head of Maintenance means and the price of
 * letting them would be a permissions screen with its own audit problem.
 *
 * **Grants attach to the Volunteer, never the Account.** A report addressed to
 * `maintenance` has to reach Terry whether or not Terry has ever logged in.
 */
export const volunteerRoles = pgTable(
  'volunteer_roles',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    volunteerId: uuid('volunteer_id')
      .notNull()
      .references(() => volunteers.id),
    /** One of `ROLES` in `src/shared/roles.ts`. */
    role: text('role').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Who conferred it. Nobody grants themselves a role (ADR 0010), and the
     * check needs the actor rather than only the date — the audit entry carries
     * the same fact for the log, and this carries it for the row.
     */
    grantedBy: uuid('granted_by').references(() => volunteers.id),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.volunteerId, table.role] }),
    inScope('volunteer_roles_in_scope'),
  ],
).enableRLS()

/**
 * Permission to prepare and administer medication — **a qualification granted
 * to a Volunteer under `horse_care`, and not a Domain Scope** (ADR 0010).
 *
 * It is not derived from leading a Shift, which is what `CONTEXT.md` originally
 * read like. Being permitted to handle Bute is a training fact about a person
 * that does not stop being true between Shifts and is revocable for cause; and
 * the roster being built a fortnight out has to answer *will this Shift have
 * Medication Authority present*, which is a question about people rather than
 * about a position on a Shift that has not happened.
 *
 * Revoking keeps the row, like `volunteer_accounts`: a revocation is a fact
 * somebody can read, and an acting Lead without the qualification still cannot
 * medicate.
 */
export const medicationAuthority = pgTable(
  'medication_authority',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    volunteerId: uuid('volunteer_id')
      .notNull()
      .references(() => volunteers.id),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => volunteers.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => volunteers.id),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.volunteerId] }),
    inScope('medication_authority_in_scope'),
  ],
).enableRLS()

/**
 * One issue of the release text (ADR 0017). **On ADR 0003's versioned tier:
 * immutable, carrying a valid-from date, and the current one is the latest.**
 *
 * Immutability is that nothing updates one — there is no endpoint that does,
 * and a correction is a new Version. That is what keeps *which text did she
 * actually sign* answerable in 2031 when 2020 is three revisions back.
 *
 * `obsoletesPrior` is the whole reason a Version is an entity rather than a
 * label on a signature. The one foreseeable event here is the rescue
 * re-papering after Md. CJP § 5-401.2, and that day needs to sweep sixty people
 * back through a signature — a query if Versions are real, and a spreadsheet if
 * they are a string. Publishing without the flag is a typo fix that invalidates
 * nobody.
 *
 * The blank template the Version carries is **not here**: ADR 0017 puts one
 * file per Version under `roster`, and object storage is out of scope for v1.
 * The column lands with the storage rather than sitting here pointing at
 * nothing. No signature image and no personal data goes to object storage at
 * all — the executed copies stay paper in the cabinet.
 */
export const releaseVersions = pgTable(
  'release_versions',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    /** The rescue's words for it — the current one is marked *Updated 2020*. */
    label: text('label').notNull(),
    validFrom: date('valid_from').notNull(),
    /** Whether publishing this stales every signature given before `validFrom`. */
    obsoletesPrior: boolean('obsoletes_prior').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid('published_by').references(() => volunteers.id),
  },
  (table) => [
    // The current Version is the latest, and the staleness sweep is a scan of
    // the obsoleting ones — both are this index rather than a sort of the table.
    index('release_versions_valid_from').on(table.orgId, table.validFrom),
    inScope('release_versions_in_scope'),
  ],
).enableRLS()

/**
 * A Volunteer's signature against one Release Version (ADR 0017).
 *
 * **The app records the fact, not the executed artifact**: who signed, when,
 * which Version. The signed paper stays in the cabinet as the original, because
 * an application presenting itself as the five-year home of a legal document,
 * on a stack whose restore window is thirty days (ADR 0006), would be worse
 * than the filing cabinet *and* look better than it.
 *
 * **Never self-recorded.** Unlike Attendance, where self-report is the norm,
 * this is a statement about a piece of paper that only the person holding the
 * paper can see, and a volunteer asserting their own release exists is evidence
 * of nothing. The check is in `src/server/roster/releases.ts`.
 *
 * Rows are kept indefinitely. Pruning is the only mechanism by which somebody
 * who needs this two years later gets told no — and the app never computes a
 * shred date, because a minor's claims toll and a five-year clock from
 * signature would authorise destroying paper years before the claim it answers
 * can be filed.
 */
export const releaseSignatures = pgTable(
  'release_signatures',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    volunteerId: uuid('volunteer_id')
      .notNull()
      .references(() => volunteers.id),
    releaseVersionId: uuid('release_version_id')
      .notNull()
      .references(() => releaseVersions.id),
    /** Read off the paper, which is why the backfill is real dates. */
    signedOn: date('signed_on').notNull(),
    /**
     * The Parent/Guardian block, which does real work in Maryland under *BJ's
     * Wholesale Club v. Rosen* and is what an eighteenth birthday obsoletes.
     */
    byParent: boolean('by_parent').notNull().default(false),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => volunteers.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Expressly revoked in writing, which is how a release stops being
     * effective and is the entire feature — no status enum, no reason field, no
     * workflow. The column is worth its weight because the alternative, when it
     * does happen, is somebody editing a row so that a true past fact
     * disappears.
     */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => volunteers.id),
  },
  (table) => [
    // Every gate check reads one Volunteer's signatures.
    index('release_signatures_volunteer').on(table.orgId, table.volunteerId),
    inScope('release_signatures_in_scope'),
  ],
).enableRLS()

/**
 * A parent's written permission for a Volunteer under 18 (ADR 0017).
 *
 * **Two records, one interaction.** On paper this is frequently a second
 * signature line on the release form, and collapsing them is the temptation
 * this table exists against: a Consent satisfies a statutory condition on
 * Maryland's child-labour exemption and is meaningless the day the volunteer
 * turns 18, while a Release is the participant's own waiver and rides Versions.
 * One row cannot expire on two clocks.
 *
 * One per Volunteer, kept after the eighteenth birthday because it was true.
 * That it has stopped gating is derived at read time in
 * `src/shared/rostering.ts`, never written here by a job.
 */
export const volunteerConsents = pgTable(
  'volunteer_consents',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    volunteerId: uuid('volunteer_id')
      .notNull()
      .references(() => volunteers.id),
    consentedOn: date('consented_on').notNull(),
    /** Who gave it, as the paper names them. The parent holds no Volunteer row. */
    parentName: text('parent_name').notNull(),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => volunteers.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.volunteerId] }),
    inScope('volunteer_consents_in_scope'),
  ],
).enableRLS()

/**
 * The audit log: actor, instant, entity reference, field, before, after, and an
 * optional reason — written by the same transaction as the edit it records.
 *
 * **It is derived, and an event store is the app.** Keeping it derived is what
 * keeps ADR 0006's restore simple: this table could be lost without losing the
 * application, and that is the property being protected.
 *
 * ADR 0003's three tiers decide what lands here, and the distinction is the
 * point rather than an accident. **Versioned-tier changes are versions, not
 * audit entries** — publishing a Release Version writes nothing here, because
 * the Version *is* the record of the change. **Current-state edits get audit
 * entries.** Measurement-tier appends get neither, being their own record.
 *
 * Reading it is behind `roster`, one of ADR 0010's two carve-outs from the
 * read-everything floor.
 */
/**
 * A Space (ADR 0002): a named area of one *kind* — stall, field, barn — that
 * may be one or more physical units joined together. `2 & 3` and `All of C +
 * D` are single rows with a compound name, not sets.
 *
 * Current state plus an audit entry (ADR 0003): renaming a Space or changing
 * its kind is an edit in place, which is the whole of how splitting or
 * merging a joined Space happens — a deliberate act by someone with the
 * authority to make it, never a gate sensor.
 *
 * An unoccupied Space is a row with nothing assigned to it, and stays exactly
 * that visible: nothing here ties a Space to whether a horse holds it.
 */
export const spaces = pgTable(
  'spaces',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    /** One of `SPACE_KINDS` in `src/shared/spaces.ts`. */
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [inScope('spaces_in_scope')],
).enableRLS()

/**
 * The horse record (ADR 0002, 0003). This ticket carries the three
 * descriptive attributes ADR 0003 puts on the current-state tier — halter
 * colour, blanket size, height — plus the one identifying photo, all edited in
 * place with an audit entry. Everything else on ADR 0003's versioned and
 * measurement tiers (feed schedule, weight, body condition) lands with the
 * domains that need them.
 *
 * `photoUrl` carries wherever the photo is hosted rather than the bytes
 * themselves — this application holds no object storage yet, and a column
 * pointing at nothing would be worse than the column's absence (the same call
 * #34 made about the release template).
 *
 * Departed is a date, never a delete (ADR 0002's brief and #32's stories): the
 * row and its history outlive the horse leaving, and redaction from a work
 * surface is the reader's concern rather than this table's.
 */
export const horses = pgTable(
  'horses',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    name: text('name').notNull(),
    halterColour: text('halter_colour'),
    blanketSize: text('blanket_size'),
    height: text('height'),
    photoUrl: text('photo_url'),
    departedOn: date('departed_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [inScope('horses_in_scope')],
).enableRLS()

/**
 * A horse's Space assignment for one kind (ADR 0002): a row rather than a
 * column per kind, the way `volunteer_roles` and `medication_authority` are
 * rows rather than flags on `volunteers` — a horse holds at most one row per
 * kind, which is the primary key, and holding none for a kind is a horse
 * intake has not placed yet rather than a value to invent.
 *
 * `kind` is stored on the row rather than resolved by joining `spaces.kind`,
 * because the primary key needs it independent of which Space is assigned —
 * the same reason a stored `role` string is checked against `ROLE_SCOPES`
 * rather than assumed to agree with itself.
 */
export const horseSpaceAssignments = pgTable(
  'horse_space_assignments',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    horseId: uuid('horse_id')
      .notNull()
      .references(() => horses.id),
    /** One of `SPACE_KINDS`, and always the assigned Space's own kind. */
    kind: text('kind').notNull(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid('assigned_by').references(() => volunteers.id),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.horseId, table.kind] }),
    // The admin screen's other read: which horses hold a given Space.
    index('horse_space_assignments_space').on(table.spaceId),
    inScope('horse_space_assignments_in_scope'),
  ],
).enableRLS()

export const auditEntries = pgTable(
  'audit_entries',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    /**
     * The Volunteer who did it, never the Account. Nullable for the one act
     * with no actor inside the application: `npm run bootstrap` making the
     * first President before anybody can sign in.
     */
    actorVolunteerId: uuid('actor_volunteer_id').references(() => volunteers.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    /** `volunteer`, `release_signature`, `volunteer_role` — the kind of thing. */
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    /**
     * Which field changed, or null for the record as a whole — a creation, a
     * removal, a grant. A grant has no field to name and inventing one would
     * make the column lie in the rows that are read most.
     */
    field: text('field'),
    before: text('before'),
    after: text('after'),
    /** Optional, and asked for on the acts where somebody has a reason. */
    reason: text('reason'),
  },
  (table) => [
    // The two ways it is read: everything about one record, and the tail.
    index('audit_entries_entity').on(table.orgId, table.entity, table.entityId),
    index('audit_entries_recorded_at').on(table.orgId, table.recordedAt),
    inScope('audit_entries_in_scope'),
  ],
).enableRLS()

/**
 * Where a Product comes from (ADR 0019, `CONTEXT.md`'s Supplier): a name, an
 * optional web address, an optional note — referenced by many Products. Current
 * state plus an audit entry (ADR 0003), the same tier as a Product: what a
 * Supplier used to be called answers no question this rescue asks.
 *
 * It never points at a Contact — ADR 0014 keeps the Contacts screen outside
 * every reference the app resolves, and this table carries no column that
 * could.
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    name: text('name').notNull(),
    url: text('url'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [inScope('suppliers_in_scope')],
).enableRLS()

/**
 * Something the rescue buys and gives to a horse — a feed, a supplement or a
 * medication (`CONTEXT.md`'s Product; ADR 0019). It is also the catalogue:
 * Supplier, prescription status, an optional reorder point in days and a
 * free-text ordering note hang off the same record rather than a second list,
 * which is what makes *we're low on Senior* connectable to *these nine horses
 * eat Senior*.
 *
 * Current state plus an audit entry (ADR 0003) — not versioned, because what a
 * Product used to cost or come from answers no question here; a Feed Schedule
 * line names one by id, so its identity outlives an edit to its fields.
 *
 * Editable by holders of `horse_care` **or** `supplies` (ADR 0019's one
 * two-Scope record) — refused as field-level scoping, which ADR 0010 calls the
 * forbidden third axis, in favour of either holder editing the whole row.
 *
 * Deliberately does not stretch to what the rescue buys and does not feed a
 * horse: shavings and light bulbs stay an Observation with no subject, not a
 * catalogue row.
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    name: text('name').notNull(),
    /** One of `PRODUCT_KINDS` in `src/shared/products.ts` — feed, supplement, medication. */
    kind: text('kind').notNull(),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    prescription: boolean('prescription').notNull().default(false),
    /** Optional, in days — the same unit a days-of-supply reading will use (ADR 0019). */
    reorderPointDays: integer('reorder_point_days'),
    orderingNote: text('ordering_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The catalogue screen's other read: every Product a given Supplier carries.
    index('products_supplier').on(table.supplierId),
    inScope('products_in_scope'),
  ],
).enableRLS()

/**
 * One version of a Feed Schedule for one horse at one Shift Type (`CONTEXT.md`'s
 * Feed Schedule; ADR 0003's versioned tier). Immutable, carrying a valid-from
 * date; the current one for a `(horseId, shiftType)` pair is the latest by
 * `validFrom`. Editing creates a version rather than updating a row, so *what
 * was she eating the week she lost thirty pounds* stays answerable.
 *
 * **No audit entry** — the same discipline `release_versions` follows: a
 * versioned-tier change *is* a version, and a second copy of it in
 * `audit_entries` would be the two-places-disagreeing failure ADR 0003 was
 * written against.
 *
 * Not every horse has a version at every Shift Type — Lunch exists only for the
 * horses that get a midday feeding — so the absence of a row is the state
 * "this horse has no Lunch schedule" rather than a value to invent.
 */
export const feedScheduleVersions = pgTable(
  'feed_schedule_versions',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    horseId: uuid('horse_id')
      .notNull()
      .references(() => horses.id),
    /** One of `SHIFT_TYPES` in `src/shared/feed-schedule.ts`. */
    shiftType: text('shift_type').notNull(),
    validFrom: date('valid_from').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => volunteers.id),
  },
  (table) => [
    // The current version for one (horse, Shift Type) is the latest row here —
    // the read the horse profile and, later, materialization both make.
    index('feed_schedule_versions_current').on(table.horseId, table.shiftType, table.validFrom),
    inScope('feed_schedule_versions_in_scope'),
  ],
).enableRLS()

/**
 * One line of a Feed Schedule version: a Product, an amount and a Route
 * (`CONTEXT.md`'s Feed Schedule). `amount` is free text — *1/2 sc*, *2 wells*,
 * *6 cups water* — because no unit field exists anywhere in the settled model
 * (ADR 0019): a sack of grain does not divide by *two wells*, and the app does
 * not pretend otherwise.
 */
export const feedScheduleLines = pgTable(
  'feed_schedule_lines',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    versionId: uuid('version_id')
      .notNull()
      .references(() => feedScheduleVersions.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    amount: text('amount').notNull(),
    /** One of `ROUTES` in `src/shared/feed-schedule.ts` — a syringe medication is visibly not in-feed. */
    route: text('route').notNull(),
  },
  (table) => [
    index('feed_schedule_lines_version').on(table.versionId),
    inScope('feed_schedule_lines_in_scope'),
  ],
).enableRLS()

/**
 * A weight or body-condition entry (`CONTEXT.md`'s Weight; ADR 0003's
 * measurement-series tier): append-only, never edited, no reason field — the
 * same shape a Days of Supply reading will take, for the same reason.
 *
 * `method` — `tape` or `scale` — is weight-only and optional. #15's own
 * evidence is why it exists despite that ticket concluding no method field was
 * needed: two people weighed the same horse 23 lb apart on the same day, best
 * explained by weight-tape technique, so how a weight was taken is worth
 * recording and awkward to backfill later.
 *
 * Written by any signed-in Volunteer — the floor, like an Observation — rather
 * than a Domain Scope: recording that a horse was weighed today is not an edit
 * to a care instruction.
 */
export const horseMeasurements = pgTable(
  'horse_measurements',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    horseId: uuid('horse_id')
      .notNull()
      .references(() => horses.id),
    /** `weight` or `body_condition` — see `MEASUREMENT_KINDS`. */
    kind: text('kind').notNull(),
    value: numeric('value', { mode: 'number' }).notNull(),
    /** `tape` or `scale`. Null for a body-condition entry, and for a weight nobody named a method for. */
    method: text('method'),
    takenOn: date('taken_on').notNull(),
    recordedBy: uuid('recorded_by').references(() => volunteers.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The series a horse's profile renders: one horse, one kind, oldest to newest.
    index('horse_measurements_horse').on(table.horseId, table.kind, table.takenOn),
    inScope('horse_measurements_in_scope'),
  ],
).enableRLS()

/**
 * One version of a Threshold (ADR 0015; `CONTEXT.md`'s Threshold; ADR 0003's
 * versioned tier). A `horseId` of null is the **rescue-wide default** — a real
 * record rather than the absence of one, because copying the default onto
 * twelve horses gives eight rows of identical numbers that drift apart the
 * first time somebody edits one.
 *
 * **Three-valued per horse, and the third state is the absence of a row.**
 * `stance` says `overridden` — with a number of its own — or `follows_default`,
 * which is a horse deliberately on the rescue's number and carries none. A
 * horse with no row at all is *not yet decided*, which is an unanswered
 * question rather than agreement with the default, and rendering one as the
 * other converts a gap into a rule nobody made (ADR 0015, ADR 0013).
 *
 * **Every row carries its metric and the provider it was calibrated against.**
 * Cold is written in air temperature and heat in real feel, and measured
 * divergence between two providers' apparent temperature at the same
 * coordinates ran from −11.5 to +9.6 °F (#6) — so a provider swap without the
 * stamp silently re-calibrates every horse in the barn.
 *
 * **No audit entry**, the discipline `release_versions` and
 * `feed_schedule_versions` follow: a versioned-tier change *is* a version.
 */
export const thresholdVersions = pgTable(
  'threshold_versions',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    /** Null is the rescue-wide default — the board's *Rest of Horses*. */
    horseId: uuid('horse_id').references(() => horses.id),
    /** One of `THRESHOLD_KINDS` in `src/shared/weather.ts`. */
    kind: text('kind').notNull(),
    /** One of `STANCES`; the rescue default is always `overridden`, since it is the number. */
    stance: text('stance').notNull(),
    /** Null exactly when the stance is `follows_default`. */
    valueF: numeric('value_f', { mode: 'number' }),
    /** One of `METRICS` — what this number is measured in. */
    metric: text('metric').notNull(),
    /** One of `WEATHER_PROVIDERS` — whose scale it was set against. */
    provider: text('provider').notNull(),
    validFrom: date('valid_from').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => volunteers.id),
  },
  (table) => [
    // The read every evaluation makes: the latest row per (horse, kind), with
    // the rescue default beside it.
    index('threshold_versions_current').on(table.orgId, table.kind, table.horseId, table.validFrom),
    inScope('threshold_versions_in_scope'),
  ],
).enableRLS()

/**
 * A Reading: the weather as it stood when the Conditions were evaluated
 * (`CONTEXT.md`'s Reading; ADR 0015).
 *
 * Kept **whole** rather than as the decision it produced — the provider, the
 * metric, the hours it read, when it was fetched and whether it was stale —
 * because *why was this horse blanketed* is answered by the conditions as read
 * at the time, and a re-fetch tomorrow answers a different question (#6's
 * implementation note, which is unambiguous about persisting the raw fields).
 *
 * One per day per org today. When Shifts exist, a Shift points at the Reading
 * its list was fixed against, and the day-scoped resolutions here are the ones
 * every Shift that day shares.
 */
export const weatherReadings = pgTable(
  'weather_readings',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    day: date('day').notNull(),
    /** One of `WEATHER_PROVIDERS` — who actually answered. */
    provider: text('provider').notNull(),
    /**
     * The provider that was asked first and did not answer, where the fallback
     * was used. Null on the ordinary path. *A failed primary falls back and
     * says so* is this column plus `stale` below.
     */
    fellBackFrom: text('fell_back_from'),
    /** Why the primary did not answer, in one line, for the log and the panel. */
    fellBackBecause: text('fell_back_because'),
    /** True where no provider answered and an earlier Reading was reused (ADR 0015). */
    stale: boolean('stale').notNull().default(false),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    recordedBy: uuid('recorded_by').references(() => volunteers.id),
  },
  (table) => [
    // The Board's read: today's Reading for this organisation, newest first.
    index('weather_readings_day').on(table.orgId, table.day, table.recordedAt),
    inScope('weather_readings_in_scope'),
  ],
).enableRLS()

/**
 * One hour of the forecast a Reading read — the raw series, not the derived
 * recommendation (#6, ADR 0015).
 *
 * `at` is the instant and `day` and `hour` are that instant in the
 * organisation's timezone, resolved on the way in: *85 real feel at or before
 * noon* is a question about the barn's clock, and re-deriving it later in
 * whatever zone the reader is in is exactly the day-boundary bug ADR 0007
 * exists against.
 *
 * Every value is nullable because a provider may not carry it: the fallback
 * has air temperature and no apparent temperature, and a null says so where a
 * zero would lie.
 */
export const weatherReadingHours = pgTable(
  'weather_reading_hours',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    readingId: uuid('reading_id')
      .notNull()
      .references(() => weatherReadings.id),
    at: timestamp('at', { withTimezone: true }).notNull(),
    day: date('day').notNull(),
    /** Hour of the day, 0–23, in the organisation's timezone. */
    hour: integer('hour').notNull(),
    airTempF: numeric('air_temp_f', { mode: 'number' }),
    apparentTempF: numeric('apparent_temp_f', { mode: 'number' }),
    precipitation: boolean('precipitation'),
  },
  (table) => [
    index('weather_reading_hours_reading').on(table.readingId, table.at),
    inScope('weather_reading_hours_in_scope'),
  ],
).enableRLS()

/**
 * What a Reading resolved to: one row per (Condition, subject), which is
 * ADR 0015's correction to ADR 0013 in the table — *Staying In* is one row and
 * *Sheet Weather* is one per horse.
 *
 * `holds` is nullable on purpose. A Condition the forecast could not answer is
 * **not a false one**: defaulting to false on a 90 ° day is horses going out
 * and getting the normal hay, so an unresolved Condition says which of
 * `UNRESOLVED_REASONS` stopped it and waits for somebody to resolve it by hand.
 *
 * The number and the threshold that decided it are kept beside the answer, so
 * an item card can state *Sheet — Dawson: 38 °F, sheets under 50°* instead of
 * looking arbitrary a month later.
 */
export const weatherConditionResolutions = pgTable(
  'weather_condition_resolutions',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    readingId: uuid('reading_id')
      .notNull()
      .references(() => weatherReadings.id),
    /** One of `CONDITIONS` in `src/shared/weather.ts`. */
    condition: text('condition').notNull(),
    /** The horse it is about, or null for the barn's own answer. */
    horseId: uuid('horse_id').references(() => horses.id),
    /** One of `CONDITION_SCOPES` — which window it was read over. */
    scope: text('scope').notNull(),
    /** Null where it could not be resolved; `unresolved` then says why. */
    holds: boolean('holds'),
    /** One of `UNRESOLVED_REASONS`, or null where it resolved. */
    unresolved: text('unresolved'),
    metric: text('metric').notNull(),
    thresholdValueF: numeric('threshold_value_f', { mode: 'number' }),
    /** One of `THRESHOLD_SOURCES` — override, default, or a horse nobody decided for. */
    thresholdSource: text('threshold_source'),
    readingValueF: numeric('reading_value_f', { mode: 'number' }),
    /** The hour of the day that decided it, in the organisation's timezone. */
    atHour: integer('at_hour'),
  },
  (table) => [
    index('weather_condition_resolutions_reading').on(table.readingId, table.condition),
    inScope('weather_condition_resolutions_in_scope'),
  ],
).enableRLS()

/**
 * A Shift Pattern: the recurring commitment (`CONTEXT.md`'s Shift Pattern;
 * ADR 0001). A weekday, a time of day and a type, from which dated Shifts are
 * generated on a rolling two-week horizon.
 *
 * Current state plus an audit entry (ADR 0003): a Pattern is *what we do on
 * Tuesdays*, and what it used to be is answered by the Shifts it generated
 * rather than by a version of the Pattern — which is the whole of ADR 0001's
 * copy-on-generate rule. Editing one therefore changes future generations only,
 * and whether it reaches the Shifts already inside the horizon is a question
 * the Coordinator answers on the way in.
 *
 * `retiredAt` rather than a delete, for the reason a horse Departs rather than
 * vanishing: the Shifts it generated keep pointing at it, and *what were the
 * Tuesday mornings before we stopped* stays answerable.
 */
export const shiftPatterns = pgTable(
  'shift_patterns',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    /** One of `WEEKDAYS` in `src/shared/shifts.ts` — a word, never a number. */
    weekday: text('weekday').notNull(),
    /** One of `SHIFT_TYPES` — a Pattern never generates a Pop-up, which has no Pattern. */
    shiftType: text('shift_type').notNull(),
    /** `HH:MM` on the barn's own clock, copied onto every Shift generated from it. */
    startTime: time('start_time').notNull(),
    /** What the Shift is meant to have: three for a Feed Shift, one for Lunch. */
    targetHeadcount: integer('target_headcount').notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => volunteers.id),
  },
  (table) => [
    index('shift_patterns_weekday').on(table.orgId, table.weekday),
    inScope('shift_patterns_in_scope'),
  ],
).enableRLS()

/**
 * The Standing Roster: who is normally expected on a Pattern
 * (`CONTEXT.md`'s Standing Roster; ADR 0001).
 *
 * A row per Volunteer per Pattern, the way a Role is a row rather than a column
 * — one Volunteer holds one position on one Pattern, which is the primary key.
 * At most one `lead` per Pattern is enforced by the write rather than by an
 * index, because **zero of both Lead and Co-Lead is legal** (ADR 0010) and a
 * partial unique index would say nothing about the case that actually matters.
 */
export const shiftPatternRoster = pgTable(
  'shift_pattern_roster',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    patternId: uuid('pattern_id')
      .notNull()
      .references(() => shiftPatterns.id),
    volunteerId: uuid('volunteer_id')
      .notNull()
      .references(() => volunteers.id),
    /** One of `ASSIGNABLE_POSITIONS`; `acting_lead` is claimed on a Shift, never assigned. */
    position: text('position').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid('assigned_by').references(() => volunteers.id),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.patternId, table.volunteerId] }),
    index('shift_pattern_roster_volunteer').on(table.volunteerId),
    inScope('shift_pattern_roster_in_scope'),
  ],
).enableRLS()

/**
 * One dated occurrence of work (`CONTEXT.md`'s Shift; ADR 0001).
 *
 * **It copies rather than resolves.** `startTime`, `targetHeadcount` and the
 * roster are written here when the Shift is generated, so that *who was
 * supposed to be there on the 14th* is a fact recorded at the time and not a
 * value recomputed from a Pattern somebody has since edited.
 *
 * `patternId` is null for a **Pop-up** — a Shift with no Pattern behind it and
 * Staffing Mode `sign_up` from birth (ADR 0011) — which is also why the unique
 * index below covers `(pattern_id, day)` and leaves Pop-ups alone: two Pop-ups
 * on one morning are two calls for help, and generation never makes either.
 *
 * **There is no `cancelled` and there is no state column.** A Shift nobody can
 * staff is still a Shift, still visible and escalating (ADR 0001); and
 * *in progress* is derived from the clock until something can honestly write
 * the transition, which is Attendance in a later ticket.
 */
export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    /** Null for a Pop-up, which is an occurrence of nothing. */
    patternId: uuid('pattern_id').references(() => shiftPatterns.id),
    day: date('day').notNull(),
    /** One of `SHIFT_TYPES_INCLUDING_POP_UP` in `src/shared/shifts.ts`. */
    shiftType: text('shift_type').notNull(),
    /** Copied from the Pattern at generation, and editable on this Shift alone. */
    startTime: time('start_time').notNull(),
    targetHeadcount: integer('target_headcount').notNull(),
    /** One of `STAFFING_MODES` — a property of the Shift, not of its type. */
    staffingMode: text('staffing_mode').notNull(),
    /** What a Pop-up is for, in the words of whoever called it. Null on a generated Shift. */
    purpose: text('purpose'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => volunteers.id),
  },
  (table) => [
    // What makes two runs at the same moment create nothing twice. The
    // application decides which occurrences are missing (`shiftsToGenerate`);
    // this is what holds when two deciders overlap.
    uniqueIndex('shifts_occurrence').on(table.orgId, table.patternId, table.day),
    // The schedule read: this organisation's Shifts from today forward.
    index('shifts_day').on(table.orgId, table.day),
    inScope('shifts_in_scope'),
  ],
).enableRLS()

/**
 * One person on one dated Shift — the copied roster row of ADR 0001, and the
 * thing ADR 0010 hangs Shift Authority off.
 *
 * **A row is marked, never deleted** (ADR 0011). *Beth was rostered and
 * dropped*, *Beth was never on Thursday* and — when Attendance lands — *Beth
 * was rostered and did not come* are three different facts, and deleting the
 * row collapses all three. `endedKind` says whether she took herself off or
 * somebody holding `roster` did.
 *
 * `origin` records how she came to be here: copied from the Standing Roster, or
 * a Cover she claimed. That distinction is the Coordinator's actual interest in
 * Cover — noticing who turns up outside their assignment, rather than gating it.
 */
export const shiftRoster = pgTable(
  'shift_roster',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id),
    volunteerId: uuid('volunteer_id')
      .notNull()
      .references(() => volunteers.id),
    /** One of `SHIFT_POSITIONS`. A Cover always lands as `volunteer` (ADR 0011). */
    position: text('position').notNull(),
    /** One of `ROSTER_ORIGINS`. */
    origin: text('origin').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    addedBy: uuid('added_by').references(() => volunteers.id),
    /** When the row stopped being a commitment. Null while it stands. */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** One of `ROSTER_END_KINDS` — `dropped` by the volunteer, `removed` under `roster`. */
    endedKind: text('ended_kind'),
    /** Optional free text. A required reason collects the word "personal" sixty times. */
    endedReason: text('ended_reason'),
    endedBy: uuid('ended_by').references(() => volunteers.id),
  },
  (table) => [
    // One row per Volunteer per Shift: a Drop marks the row it finds, and a
    // Cover after a Drop is that same row coming back rather than a second one.
    uniqueIndex('shift_roster_person').on(table.orgId, table.shiftId, table.volunteerId),
    // A volunteer's own upcoming Shifts, which is what the phone reads.
    index('shift_roster_volunteer').on(table.orgId, table.volunteerId),
    inScope('shift_roster_in_scope'),
  ],
).enableRLS()
