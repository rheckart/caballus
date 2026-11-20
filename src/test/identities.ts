/**
 * Clearing Better Auth's rows for one test organisation, and nobody else's.
 *
 * `user`, `session` and `verification` carry no `org_id` and no policy
 * (ADR 0008), so they are shared with every suite running in parallel, and a
 * wholesale delete reaches into whichever file is mid-sign-in next door. Since
 * ADR 0030 a `user` is keyed by the Volunteer it was minted for, so the rows
 * that belong to an organisation's tests are exactly the ones its Volunteers
 * were keyed for or claimed — both read **before** the Volunteers are deleted,
 * which is why a suite calls this first. `session` and `volunteer_accounts`
 * cascade from `user`.
 *
 * Verification rows are found the same way: the sign-in code is minted under
 * `sign-in-otp-<key>`. A suite whose codes are keyed by a real address — the
 * `change-email-otp-<address>` rows of `/me/email` — clears those by its own
 * address suffix besides.
 */
import type postgres from 'postgres'

import { ACCOUNT_KEY_DOMAIN } from '../server/auth/volunteers'

export async function forgetIdentities(owner: postgres.Sql, orgId: string): Promise<void> {
  const keyed = `@${ACCOUNT_KEY_DOMAIN}`
  await owner`
    delete from verification
    where identifier in (
      select 'sign-in-otp-' || id::text || ${keyed} from volunteers where org_id = ${orgId}
    )
  `
  await owner`
    delete from "user"
    where id in (select user_id from volunteer_accounts where org_id = ${orgId})
    or email in (select id::text || ${keyed} from volunteers where org_id = ${orgId})
  `
}
