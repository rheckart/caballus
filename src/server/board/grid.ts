/**
 * The Board's one read: the faithful grid, assembled (`CONTEXT.md`'s Board;
 * #37).
 *
 * It answers with the whole screen — every row of every section, in order —
 * because the tablet repaints the lot every minute and a grid stitched
 * together from four reads is four chances for one of them to be a minute
 * older than the others on a wall people are reading across a barn.
 *
 * **Departed horses and Retired Spaces are left out here**, which is the one
 * place this read departs from `horseList`'s and `spaceList`'s rule that
 * hiding one is the reader's concern. The Board *is* that reader: it is the
 * whiteboard, and a horse that left the rescue, or a stall that no longer
 * exists, is off the whiteboard. Their records stay reachable at the horse's
 * profile and the admin Spaces screen, where the history lives (ADR 0002).
 *
 * It records nothing and credits nobody (ADR 0022). **Today's Reading rides
 * along** (#38): the barn reads *staying in* off the wall, and a grid stitched
 * from two reads is two chances for the weather panel and the rows to be
 * describing different minutes. **Unexpired Announcements ride along too**
 * (#46, ADR 0018) — the whiteboard's missing panel is on the same read as the
 * rows it sits beside, rather than a fifth request the tablet's poll has to
 * keep in step with the other four.
 */
import { eq, isNull } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import { horseSpaceAssignments, horses, spaces } from '../../db/schema'
import { currentAnnouncements, type Announcement } from '../announcements/list'
import { arrangeBoard, type BoardSection, type BoardSpaceRef } from '../../shared/board'
import type { DayString } from '../../shared/time'
import { standingAlertsByHorse, type Alert } from '../horses/alerts'
import { currentFeedSchedulesByHorse, type CurrentFeedSchedule } from '../horses/feed-schedules'
import { readingFor, type Reading } from '../weather/readings'

/** A horse as one row of the grid carries it. */
export interface BoardHorse {
  readonly id: string
  readonly name: string
  readonly halterColour: string | null
  readonly stall: BoardSpaceRef | null
  readonly barn: BoardSpaceRef | null
  readonly pasture: BoardSpaceRef | null
  /** The current feeding per Shift Type, only for the ones this horse has (#36). */
  readonly feedings: readonly CurrentFeedSchedule[]
  /**
   * Standing Alerts, in full — the Board's own column writes the words the way
   * the paper board does, because *2 alerts* read across a barn tells nobody
   * the horse bites (ADR 0024). They ride on this read rather than a second
   * one the tablet polls alongside it: a horse looking alert-free whenever the
   * other call is slow is the wrong direction to fail (#36).
   */
  readonly alerts: readonly Alert[]
}

export interface BoardGrid {
  readonly today: DayString
  readonly sections: readonly BoardSection<BoardHorse>[]
  /** Null where nothing has fixed today's weather yet — a question, not a calm day. */
  readonly weather: Reading | null
  /** Unexpired only — what has left the wall is not here (#46, ADR 0018). */
  readonly announcements: readonly Announcement[]
}

interface AssignmentRow {
  readonly horseId: string
  readonly kind: string
  readonly spaceId: string
  readonly spaceName: string
}

/** The grid, in stall order, sections and all. */
export async function boardGrid(db: OrgScopedDatabase, today: DayString): Promise<BoardGrid> {
  const [horseRows, assignmentRows, stallRows, feedings, weather, announcements, alertsBy] =
    await Promise.all([
      db
        .select({
          id: horses.id,
          name: horses.name,
          halterColour: horses.halterColour,
          departedOn: horses.departedOn,
        })
        .from(horses)
        .orderBy(horses.name),
      db
        .select({
          horseId: horseSpaceAssignments.horseId,
          kind: horseSpaceAssignments.kind,
          spaceId: horseSpaceAssignments.spaceId,
          spaceName: spaces.name,
        })
        .from(horseSpaceAssignments)
        .innerJoin(spaces, eq(spaces.id, horseSpaceAssignments.spaceId)),
      // Every Stall, not only the occupied ones: the row for the stall that
      // stands OPEN is information, and it is the row this read exists to keep
      // (ADR 0002). A Retired one is excluded, the same as a Departed horse.
      db
        .select({ id: spaces.id, kind: spaces.kind, name: spaces.name })
        .from(spaces)
        .where(isNull(spaces.retiredOn)),
      currentFeedSchedulesByHorse(db, today),
      readingFor(db, today),
      currentAnnouncements(db, today),
      standingAlertsByHorse(db),
    ])

  const assignmentsBy = new Map<string, AssignmentRow[]>()
  for (const row of assignmentRows) {
    const held = assignmentsBy.get(row.horseId)
    if (held === undefined) assignmentsBy.set(row.horseId, [row])
    else held.push(row)
  }

  const placed = (rows: readonly AssignmentRow[], kind: string): BoardSpaceRef | null => {
    const row = rows.find((entry) => entry.kind === kind)
    return row === undefined ? null : { id: row.spaceId, name: row.spaceName }
  }

  const here: BoardHorse[] = horseRows
    .filter((row) => row.departedOn === null)
    .map((row) => {
      const assignments = assignmentsBy.get(row.id) ?? []
      return {
        id: row.id,
        name: row.name,
        halterColour: row.halterColour,
        stall: placed(assignments, 'stall'),
        barn: placed(assignments, 'barn'),
        pasture: placed(assignments, 'pasture'),
        feedings: feedings.get(row.id) ?? [],
        alerts: alertsBy.get(row.id) ?? [],
      }
    })

  const stalls: BoardSpaceRef[] = stallRows
    .filter((row) => row.kind === 'stall')
    .map((row) => ({ id: row.id, name: row.name }))

  return { today, sections: arrangeBoard(here, stalls), weather, announcements }
}
