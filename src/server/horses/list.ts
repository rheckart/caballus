/**
 * The reads: the horse list and one horse's profile for the phone, and the
 * Space list for desktop admin.
 *
 * Every Volunteer reads all of it (ADR 0010's floor) — there is no carve-out
 * here the way `roster` is one for volunteer contact details, because nothing
 * on a horse or a Space is personal. A Departed horse is included: hiding it
 * from a work surface is the *reader's* concern (a phone screen filtering on
 * `departedOn`), never this module's, because the history has to stay
 * reachable (#32).
 */
import { eq } from 'drizzle-orm'

import type { OrgScopedDatabase } from '../../db/for-org'
import { horseSpaceAssignments, horses, spaces } from '../../db/schema'
import { isSpaceKind, type SpaceKind } from '../../shared/spaces'
import { dayString, type DayString } from '../../shared/time'
import { currentFeedSchedulesFor, type CurrentFeedSchedule } from './feed-schedules'
import { measurementsFor, type HorseMeasurements } from './measurements'

export interface SpaceRef {
  readonly id: string
  readonly name: string
}

export interface HorseSpaces {
  readonly stall: SpaceRef | null
  readonly pasture: SpaceRef | null
  readonly paddock: SpaceRef | null
  readonly barn: SpaceRef | null
}

export interface Horse {
  readonly id: string
  readonly name: string
  readonly halterColour: string | null
  readonly blanketSize: string | null
  readonly height: string | null
  readonly photoUrl: string | null
  readonly departedOn: DayString | null
  readonly spaces: HorseSpaces
}

interface AssignmentRow {
  readonly horseId: string
  readonly kind: string
  readonly spaceId: string
  readonly spaceName: string
}

function spacesOf(assignments: readonly AssignmentRow[]): HorseSpaces {
  const by = new Map(
    assignments.filter((row) => isSpaceKind(row.kind)).map((row) => [row.kind, row]),
  )
  const refOf = (kind: SpaceKind): SpaceRef | null => {
    const row = by.get(kind)
    return row === undefined ? null : { id: row.spaceId, name: row.spaceName }
  }
  return {
    stall: refOf('stall'),
    pasture: refOf('pasture'),
    paddock: refOf('paddock'),
    barn: refOf('barn'),
  }
}

async function assignmentsFor(db: OrgScopedDatabase): Promise<readonly AssignmentRow[]> {
  return db
    .select({
      horseId: horseSpaceAssignments.horseId,
      kind: horseSpaceAssignments.kind,
      spaceId: horseSpaceAssignments.spaceId,
      spaceName: spaces.name,
    })
    .from(horseSpaceAssignments)
    .innerJoin(spaces, eq(spaces.id, horseSpaceAssignments.spaceId))
}

/** Every horse, current or Departed, name order. */
export async function horseList(db: OrgScopedDatabase): Promise<readonly Horse[]> {
  const [rows, assignmentRows] = await Promise.all([
    db
      .select({
        id: horses.id,
        name: horses.name,
        halterColour: horses.halterColour,
        blanketSize: horses.blanketSize,
        height: horses.height,
        photoUrl: horses.photoUrl,
        departedOn: horses.departedOn,
      })
      .from(horses)
      .orderBy(horses.name),
    assignmentsFor(db),
  ])

  const assignmentsBy = groupBy(assignmentRows, (row) => row.horseId)

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    halterColour: row.halterColour,
    blanketSize: row.blanketSize,
    height: row.height,
    photoUrl: row.photoUrl,
    departedOn: row.departedOn === null ? null : dayString(row.departedOn),
    spaces: spacesOf(assignmentsBy.get(row.id) ?? []),
  }))
}

export interface HorseProfile extends Horse {
  readonly feedSchedules: readonly CurrentFeedSchedule[]
  readonly measurements: HorseMeasurements
}

/**
 * One horse, or `null` — the profile the phone reads by id (ADR 0021's
 * parameterised path). Carries the current Feed Schedule per Shift Type and
 * both measurement series, so the phone gets the whole profile in one read
 * rather than three round trips on a connection that mostly works (#36).
 */
export async function horseById(
  db: OrgScopedDatabase,
  horseId: string,
  today: DayString,
): Promise<HorseProfile | null> {
  const [row] = await db
    .select({
      id: horses.id,
      name: horses.name,
      halterColour: horses.halterColour,
      blanketSize: horses.blanketSize,
      height: horses.height,
      photoUrl: horses.photoUrl,
      departedOn: horses.departedOn,
    })
    .from(horses)
    .where(eq(horses.id, horseId))
    .limit(1)
  if (row === undefined) return null

  const [assignmentRows, feedSchedules, measurements] = await Promise.all([
    assignmentsFor(db).then((rows) => rows.filter((entry) => entry.horseId === horseId)),
    currentFeedSchedulesFor(db, horseId, today),
    measurementsFor(db, horseId),
  ])

  return {
    id: row.id,
    name: row.name,
    halterColour: row.halterColour,
    blanketSize: row.blanketSize,
    height: row.height,
    photoUrl: row.photoUrl,
    departedOn: row.departedOn === null ? null : dayString(row.departedOn),
    spaces: spacesOf(assignmentRows),
    feedSchedules,
    measurements,
  }
}

export interface SpaceOccupant {
  readonly id: string
  readonly name: string
}

export interface Space {
  readonly id: string
  readonly kind: SpaceKind
  readonly name: string
  readonly occupants: readonly SpaceOccupant[]
  readonly retiredOn: DayString | null
}

/** Every Space, current or Retired — hiding a Retired one is the reader's concern, not this read's (ADR 0002). */
export async function spaceList(db: OrgScopedDatabase): Promise<readonly Space[]> {
  const [rows, occupantRows] = await Promise.all([
    db
      .select({ id: spaces.id, kind: spaces.kind, name: spaces.name, retiredOn: spaces.retiredOn })
      .from(spaces)
      .orderBy(spaces.name),
    db
      .select({
        spaceId: horseSpaceAssignments.spaceId,
        horseId: horses.id,
        horseName: horses.name,
      })
      .from(horseSpaceAssignments)
      .innerJoin(horses, eq(horses.id, horseSpaceAssignments.horseId)),
  ])

  const occupantsBy = groupBy(occupantRows, (row) => row.spaceId)

  return rows
    .filter((row) => isSpaceKind(row.kind))
    .map((row) => ({
      id: row.id,
      // Filtered above, so this build's own vocabulary is what is left.
      kind: row.kind as SpaceKind,
      name: row.name,
      occupants: (occupantsBy.get(row.id) ?? []).map((entry) => ({
        id: entry.horseId,
        name: entry.horseName,
      })),
      retiredOn: row.retiredOn === null ? null : dayString(row.retiredOn),
    }))
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>()
  for (const row of rows) {
    const at = key(row)
    const held = grouped.get(at)
    if (held === undefined) grouped.set(at, [row])
    else held.push(row)
  }
  return grouped
}
