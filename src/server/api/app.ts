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
import { startObservability } from '../observability'
import { today } from '../time'

// The server's one entry point, so this is where reporting starts. It is a
// no-op without a DSN, which is the state of every machine until one is set.
startObservability()

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

// Every path the contract declares now has a handler, or this throws and the
// container does not start. Registering a path nothing declares is a type
// error; this is the other direction, which would otherwise be a 404 that the
// phone in the barn finds first (ADR 0021).
api.sealed()
