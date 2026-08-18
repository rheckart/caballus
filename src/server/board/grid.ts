/**
 * The Board's one read: the faithful grid, assembled (`CONTEXT.md`'s Board;
 * #37).
 *
 * It answers with the whole screen — every row of every section, in order —
 * because the tablet repaints the lot every minute and a grid stitched
 * together from four reads is four chances for one of them to be a minute
 * older than the others on a wall people are reading across a barn.
 *
 * **Departed horses are left out here**, which is the one place this read
 * departs from `horseList`'s rule that hiding a horse is the reader's concern.
 * The Board *is* that reader: it is the whiteboard, and a horse that left the
 * rescue is off the whiteboard. Its record stays reachable at its profile,
 * where the history lives (ADR 0002).
 *
 * It records nothing and credits nobody (ADR 0022). **Today's Reading rides
 * along** (#38): the barn reads *staying in* off the wall, and a grid stitched
 * from two reads is two chances for the weather panel and the rows to be
 * describing different minutes. **Unexpired Announcements ride along too**
 * (#46, ADR 0018) — the whiteboard's missing panel is on the same read as the
 * rows it sits beside, rather than a fifth request the tablet's poll has to
 * keep in step with the other four.
 */
import { eq } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import { horseSpaceAssignments, horses, spaces } from '../../db/schema'
import { currentAnnouncements, type Announcement } from '../announcements/list'
import { arrangeBoard, type BoardSection, type BoardSpaceRef } from '../../shared/board'
import type { DayString } from '../../shared/time'
import { currentFeedSchedulesByHorse, type CurrentFeedSchedule } from '../horses/feed-schedules'
import { readingFor, type Reading } from '../weather/readings'

/** A horse as one row of the grid carries it. */
export interface BoardHorse {
  readonly id: string
  readonly name: string
  readonly halterColour: string | null
  readonly stall: BoardSpaceRef | null
  readonly barn: BoardSpaceRef | null
  readonly field: BoardSpaceRef | null
  /** The current feeding per Shift Type, only for the ones this horse has (#36). */
  readonly feedings: readonly CurrentFeedSchedule[]
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
  const [horseRows, assignmentRows, stallRows, feedings, weather, announcements] =
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
      // (ADR 0002).
      db.select({ id: spaces.id, kind: spaces.kind, name: spaces.name }).from(spaces),
      currentFeedSchedulesByHorse(db, today),
      readingFor(db, today),
      currentAnnouncements(db, today),
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
        field: placed(assignments, 'field'),
        feedings: feedings.get(row.id) ?? [],
      }
    })

  const stalls: BoardSpaceRef[] = stallRows
    .filter((row) => row.kind === 'stall')
    .map((row) => ({ id: row.id, name: row.name }))

  return { today, sections: arrangeBoard(here, stalls), weather, announcements }
}
