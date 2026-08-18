/**
 * Shift Notes: curating one, and reading the recent ones a Shift's own
 * opening shows (`CONTEXT.md`'s Shift Notes; ADR 0013, #45).
 *
 * **Curated by Shift Authority while the Shift stands, by `horse_care`
 * after** — ADR 0010's amendment: "the President reading Thursday's notes on
 * Friday and adding *I called the vet* is a real act." `/shifts/notes`
 * declares `shiftAuthority(['horse_care'])`, which lets either reach this
 * module; what only this module can tell is whether the Shift has *already*
 * closed, which is the fact that decides whether Shift Authority alone is
 * still enough.
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { horses, shiftNotes, shifts, volunteers } from '../../db/schema'
import { now } from '../../shared/time'
import type { DayString } from '../../shared/time'
import { addDays, timestampOf } from '../time'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

export interface NewShiftNote {
  readonly shiftId: string
  readonly text: string
  readonly horseId?: string | null
}

export async function addShiftNote(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actor: { readonly volunteerId: string; readonly holdsHorseCare: boolean },
  about: NewShiftNote,
): Promise<Recorded<{ id: string }>> {
  const text = about.text.trim()
  if (text === '') return refused('text_required')

  const [shift] = await db
    .select({ id: shifts.id, day: shifts.day, closedAt: shifts.closedAt })
    .from(shifts)
    .where(eq(shifts.id, about.shiftId))
    .limit(1)
  if (shift === undefined) return refused('shift_not_found')

  const postClose = shift.closedAt !== null
  if (postClose && !actor.holdsHorseCare) return refused('shift_closed')

  const id = uuidv7()
  await db.insert(shiftNotes).values({
    id,
    orgId,
    shiftId: shift.id,
    day: shift.day,
    text,
    horseId: about.horseId ?? null,
    authoredBy: actor.volunteerId,
    authoredAt: timestampOf(now()),
    postClose,
  })

  return recorded({ id })
}

export interface ShiftNoteEntry {
  readonly id: string
  readonly day: DayString
  readonly text: string
  readonly horseId: string | null
  readonly horseName: string | null
  readonly authoredBy: string
  readonly authoredByName: string
  readonly authoredAt: number
  readonly postClose: boolean
}

/**
 * The recent Shift Notes a Shift's own opening shows: this Shift's own day
 * and the day before, newest first (ADR 0013's "recency sidesteps the
 * problem" — the AM Shift's successor is Lunch for some horses and PM for
 * others, and both read the morning's note without either being told it is
 * the other's successor).
 */
export async function shiftNotesFor(
  db: OrgScopedDatabase,
  day: DayString,
  timeZone: string,
): Promise<readonly ShiftNoteEntry[]> {
  const yesterday = addDays(day, -1, timeZone)

  const rows = await db
    .select({
      id: shiftNotes.id,
      day: shiftNotes.day,
      text: shiftNotes.text,
      horseId: shiftNotes.horseId,
      horseName: horses.name,
      authoredBy: shiftNotes.authoredBy,
      authoredByName: volunteers.name,
      authoredAt: shiftNotes.authoredAt,
      postClose: shiftNotes.postClose,
    })
    .from(shiftNotes)
    .innerJoin(volunteers, eq(volunteers.id, shiftNotes.authoredBy))
    .leftJoin(horses, eq(horses.id, shiftNotes.horseId))
    .where(and(gte(shiftNotes.day, yesterday), lte(shiftNotes.day, day)))
    .orderBy(desc(shiftNotes.authoredAt))

  return rows.map((row) => ({
    id: row.id,
    day: row.day as DayString,
    text: row.text,
    horseId: row.horseId,
    horseName: row.horseName,
    authoredBy: row.authoredBy,
    authoredByName: row.authoredByName,
    authoredAt: row.authoredAt.getTime(),
    postClose: row.postClose,
  }))
}
