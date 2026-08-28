/**
 * The one read: every unexpired Announcement, newest first — what the home
 * screen and the Board both show (`CONTEXT.md`'s Announcement; ADR 0018).
 *
 * One function rather than two, because the two surfaces read the same wall:
 * a second copy of *what counts as still posted* is exactly the risk
 * `src/shared/announcements.ts`'s doc comment names.
 */
import { desc, eq, inArray } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import { announcements, volunteers } from '../../db/schema'
import { unexpiredAnnouncements } from '../../shared/announcements'
import { dayString, type DayString } from '../../shared/time'

export interface Announcement {
  readonly id: string
  readonly text: string
  readonly expiresOn: DayString
  readonly authoredBy: string
  readonly authoredByName: string
  /** Epoch milliseconds. */
  readonly authoredAt: number
  readonly lastEditedBy: string | null
  readonly lastEditedByName: string | null
  /** Epoch milliseconds, or null before the first edit. */
  readonly lastEditedAt: number | null
  /**
   * When somebody put this in front of people by text, or null (#77). Carried
   * so the screen does not offer a send `already_sent` would refuse — *nobody
   * is told twice* has to be visible and not only enforced.
   */
  readonly urgentSentAt: number | null
}

/** Every Announcement still posted on `today`, most recently posted first. */
export async function currentAnnouncements(
  db: OrgScopedDatabase,
  today: DayString,
): Promise<readonly Announcement[]> {
  const rows = await db
    .select({
      id: announcements.id,
      text: announcements.text,
      expiresOn: announcements.expiresOn,
      authoredBy: announcements.authoredBy,
      authoredByName: volunteers.name,
      authoredAt: announcements.authoredAt,
      lastEditedBy: announcements.lastEditedBy,
      lastEditedAt: announcements.lastEditedAt,
      urgentSentAt: announcements.urgentSentAt,
    })
    .from(announcements)
    .innerJoin(volunteers, eq(volunteers.id, announcements.authoredBy))
    .orderBy(desc(announcements.authoredAt))

  // The editor's name, in a second small read rather than a second join: most
  // Announcements carry no edit at all, and a left join for the rare case
  // would ask the database to duplicate every author's row for a column that
  // is usually null.
  const editorIds = [
    ...new Set(rows.map((row) => row.lastEditedBy).filter((id): id is string => id !== null)),
  ]
  const editorNameById = new Map<string, string>()
  if (editorIds.length > 0) {
    const editors = await db
      .select({ id: volunteers.id, name: volunteers.name })
      .from(volunteers)
      .where(inArray(volunteers.id, editorIds))
    for (const editor of editors) editorNameById.set(editor.id, editor.name)
  }

  return unexpiredAnnouncements(
    rows.map((row) => ({
      id: row.id,
      text: row.text,
      expiresOn: dayString(row.expiresOn),
      authoredBy: row.authoredBy,
      authoredByName: row.authoredByName,
      authoredAt: row.authoredAt.getTime(),
      lastEditedBy: row.lastEditedBy,
      lastEditedByName:
        row.lastEditedBy === null ? null : (editorNameById.get(row.lastEditedBy) ?? null),
      lastEditedAt: row.lastEditedAt === null ? null : row.lastEditedAt.getTime(),
      urgentSentAt: row.urgentSentAt === null ? null : row.urgentSentAt.getTime(),
    })),
    today,
  )
}
