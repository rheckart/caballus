/**
 * What counts as still on the wall (`CONTEXT.md`'s Announcement; ADR 0018).
 *
 * Pure, for the reason `src/shared/board.ts` and `src/shared/staffing.ts` are:
 * the database answers *what did somebody post and when does it expire*, and
 * whether that is still true today is arithmetic a table of inputs can
 * exercise directly. It is also read from two places — the home screen and
 * the Board — and a second copy of the comparison would be two chances for
 * one of them to keep a note up a day past the other.
 *
 * **Expiry is a day, never an instant** (ADR 0018): an Announcement that
 * expires today is still true for the whole of today, the same way a Shift's
 * day is a `DayString` rather than a moment. `DayString` sorts lexically
 * exactly like the calendar it names, so the comparison below is a plain
 * string comparison rather than anything that needs `Date`.
 */
import type { DayString } from './time'

/** What this module needs to know about one Announcement, and nothing else. */
export interface AnnouncementFacts {
  readonly expiresOn: DayString
}

/**
 * Whether an Announcement is still posted on `today` — true through the whole
 * of its expiry day, and false the day after. Once false it is not deleted,
 * only off every surface that reads this (ADR 0018).
 */
export function isPosted(announcement: AnnouncementFacts, today: DayString): boolean {
  return announcement.expiresOn >= today
}

/**
 * Every Announcement still posted on `today`, in the order it was given them.
 *
 * Generic over the row so the caller's own shape — text, author, whatever a
 * screen carries — travels through untouched, the same discipline
 * `arrangeBoard` follows for a horse.
 */
export function unexpiredAnnouncements<T extends AnnouncementFacts>(
  announcements: readonly T[],
  today: DayString,
): readonly T[] {
  return announcements.filter((announcement) => isPosted(announcement, today))
}
