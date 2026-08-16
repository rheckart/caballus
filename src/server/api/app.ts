/**
 * The `/api/v1` application. Every queueable write in the system arrives here
 * (ADR 0007), and every handler declares what it requires (ADR 0010).
 *
 * There is one endpoint so far. It is the one the client cannot do without:
 * the day, in the organisation's timezone, since a browser deriving its own
 * would be right for most of the year and wrong at the edges that matter.
 */
import { forOrg } from '../../db/for-org'
import { orgs } from '../../db/schema'
import { readEverything } from './authorization'
import { createApi, json } from './route'
import { today } from '../time'

export const api = createApi()

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
