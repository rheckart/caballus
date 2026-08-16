/**
 * The tables. There are two so far, because the domain lands ticket by ticket
 * and inventing rows ahead of the decisions that shape them is how the two
 * previous attempts at this application accumulated a model nobody wanted.
 * Neither of these is a domain table: they are the organisation, and the
 * bookkeeping that makes a queued write safe to send twice.
 *
 * Two things every table here will carry: an `org_id` (the `orgs` table is the
 * one exception, being the organisation itself) and a row-level security
 * policy that fails closed when `app.org_id` is unset — ADR 0007's one
 * structural guarantee.
 */
import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
