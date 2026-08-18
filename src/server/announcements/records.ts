/**
 * Posting and editing an Announcement (`CONTEXT.md`'s Announcement; ADR
 * 0018, #46).
 *
 * **No audit entry, ever** — the whole point ADR 0018 makes about who gets to
 * read this: the only reader of *who changed this and when* is somebody
 * standing at the wall, and `authoredBy`/`lastEditedBy` on the row answer that
 * directly. `src/server/roster/audit.ts` is deliberately never imported here.
 *
 * Takes the scoped transaction `mutation` opened rather than opening one of
 * its own, the same discipline every other domain follows (ADR 0020) — though
 * there is no second write inside this one for it to keep in step with.
 */
import { eq, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { announcements } from '../../db/schema'
import type { DayString } from '../../shared/time'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

export interface NewAnnouncement {
  readonly text: string
  readonly expiresOn: DayString
}

/**
 * Posts an Announcement. **There is no subject argument** — `NewAnnouncement`
 * carries text and an expiry and nothing that could name a horse, a Space or
 * a Product, which is what "refuses a subject by construction" means: the
 * type is the refusal, and no runtime check backs it up because none is
 * needed.
 */
export async function createAnnouncement(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  details: NewAnnouncement,
): Promise<Recorded<{ id: string }>> {
  const id = uuidv7()
  await db.insert(announcements).values({
    id,
    orgId,
    text: details.text.trim(),
    expiresOn: details.expiresOn,
    authoredBy: actorVolunteerId,
  })

  return recorded({ id })
}

interface AnnouncementEdit {
  readonly announcementId: string
  /** `undefined` leaves the field unchanged. Neither field may be cleared — a wall notice with no text or no expiry is not a lesser Announcement, it is not one. */
  readonly text?: string
  readonly expiresOn?: DayString
}

/**
 * Edits an Announcement in place — by the author or by any Domain Scope
 * holder, which `mutation`'s `anyScopeHolder()` check already settles before
 * this runs (ADR 0018 does not carve out an authorship axis ADR 0010 refuses
 * to have). Whoever is editing becomes `lastEditedBy`, whether or not they
 * posted it.
 */
export async function editAnnouncement(
  db: OrgScopedDatabase,
  _orgId: OrgId,
  actorVolunteerId: string,
  about: AnnouncementEdit,
): Promise<Recorded> {
  const [existing] = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(eq(announcements.id, about.announcementId))
    .limit(1)
  if (existing === undefined) return refused('announcement_not_found')

  const next: { text?: string; expiresOn?: DayString } = {}
  if (about.text !== undefined) next.text = about.text.trim()
  if (about.expiresOn !== undefined) next.expiresOn = about.expiresOn

  await db
    .update(announcements)
    .set({ ...next, lastEditedBy: actorVolunteerId, lastEditedAt: sql`now()` })
    .where(eq(announcements.id, about.announcementId))

  return recorded(null)
}
