/**
 * The `/api/v1` application. Every queueable write in the system arrives here
 * (ADR 0007), and every handler declares what it requires (ADR 0010).
 *
 * Two endpoints so far: the day in the organisation's timezone, since a
 * browser deriving its own would be right for most of the year and wrong at
 * the edges that matter, and who the session says is asking.
 */
import { eq } from 'drizzle-orm'

import { forOrg } from '../../db/for-org'
import { orgs, volunteers } from '../../db/schema'
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
  // Sound: `readEverything` refused a null actor before this handler ran.
  const actor = context.actor
  if (actor === null) return json({ error: 'not_authorized' }, 401)

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

// Every path the contract declares now has a handler, or this throws and the
// container does not start. Registering a path nothing declares is a type
// error; this is the other direction, which would otherwise be a 404 that the
// phone in the barn finds first (ADR 0021).
api.sealed()
