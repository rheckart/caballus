/**
 * The tables. There is one so far, because the domain lands ticket by ticket
 * and inventing rows ahead of the decisions that shape them is how the two
 * previous attempts at this application accumulated a model nobody wanted.
 *
 * Two things every table here will carry: an `org_id` (the `orgs` table is the
 * one exception, being the organisation itself) and a row-level security
 * policy that fails closed when `app.org_id` is unset — ADR 0007's one
 * structural guarantee.
 */
import { sql } from 'drizzle-orm'
import { pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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
