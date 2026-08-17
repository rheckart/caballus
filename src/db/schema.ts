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
  index,
  integer,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

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
    pgPolicy('idempotency_keys_in_scope', {
      for: 'all',
      using: sql`org_id::text = current_setting('app.org_id', true)`,
      withCheck: sql`org_id::text = current_setting('app.org_id', true)`,
    }),
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
    pgPolicy('volunteers_in_scope', {
      for: 'all',
      using: sql`org_id::text = current_setting('app.org_id', true)`,
      withCheck: sql`org_id::text = current_setting('app.org_id', true)`,
    }),
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
    pgPolicy('volunteer_accounts_in_scope', {
      for: 'all',
      using: sql`org_id::text = current_setting('app.org_id', true)`,
      withCheck: sql`org_id::text = current_setting('app.org_id', true)`,
    }),
  ],
).enableRLS()

/**
 * A role somebody holds, carrying the barn's own words (ADR 0010). The mapping
 * from a role to the Domain Scopes it confers is a constant in code — in
 * `src/server/api/authorization.ts` — and never a row, because nobody at this
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
    /** One of `ROLES` in `src/server/api/authorization.ts`. */
    role: text('role').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.volunteerId, table.role] }),
    pgPolicy('volunteer_roles_in_scope', {
      for: 'all',
      using: sql`org_id::text = current_setting('app.org_id', true)`,
      withCheck: sql`org_id::text = current_setting('app.org_id', true)`,
    }),
  ],
).enableRLS()
