/**
 * The only sanctioned way to reach the database.
 *
 * ADR 0007 enforces multi-tenancy in the database rather than by discipline:
 * every request opens a transaction issuing `SET LOCAL app.org_id`, and the
 * policies filter every table, so forgetting returns zero rows rather than
 * another organisation's rows.
 *
 * Two invariants, one mechanism each (ADR 0016). *Which handle* is the lint
 * rule on `src/db/client`. *Which organisation* is the branded `OrgId` below:
 * `forOrg(row.orgId)` would lint clean and hand the policies a faithful scope
 * to the wrong organisation, so a plain string does not type-check here. The
 * brand is minted in `src/server/request-context.ts` and nowhere else.
 */
import { sql } from 'drizzle-orm'

import { rawDb, type Database } from './client'

declare const orgIdBrand: unique symbol

/** An organisation id that came from the request, not from a row. */
export type OrgId = string & { readonly [orgIdBrand]: true }

/** The handle inside a scoped transaction. */
export type OrgScopedDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]

export interface OrgScope {
  readonly orgId: OrgId
  /**
   * Runs `work` in a transaction with `app.org_id` set. Everything the work
   * touches is filtered by the policies of that organisation.
   */
  run<T>(work: (db: OrgScopedDatabase) => Promise<T>): Promise<T>
}

/**
 * Closes the connection, for tests and for a clean shutdown.
 *
 * Re-exported rather than reached for directly, so that nothing outside this
 * module imports `./client` — a re-export is how an import ban goes intact and
 * useless (ADR 0016), which is why it is this one function and not the handle.
 */
export { closeDb } from './client'

export function forOrg(orgId: OrgId): OrgScope {
  return {
    orgId,
    run(work) {
      return rawDb().transaction(async (tx) => {
        // `set_config(..., true)` is `SET LOCAL` in a form that takes a
        // parameter, so the organisation id is never interpolated into SQL.
        await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`)
        return work(tx)
      })
    },
  }
}
