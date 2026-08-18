/**
 * Generation: the recurring commitment becoming dated occurrences (ADR 0001).
 *
 * **It copies rather than resolves.** A generated Shift is written with the
 * Pattern's start time, target headcount and Standing Roster as they stand at
 * that moment, so *who was supposed to be there on the 14th* is a fact recorded
 * at the time. A Pattern edited afterwards does not reach it, unless somebody
 * answers ADR 0001's prompt saying it should.
 *
 * **It is deliberate, idempotent, and never at boot** (ADR 0007's rule that
 * migrations do not run at boot, applied to the other job that must not run
 * itself). Somebody asks for it; running it twice creates nothing twice, which
 * `shiftsToGenerate` decides and the unique index on `(org_id, pattern_id,
 * day)` holds under a race.
 *
 * **The roster is copied whole, gates or no gates.** Gating at generation was
 * rejected outright by ADR 0011: an assignment that silently evaporates a
 * fortnight later is the quiet wrongness ADR 0001's prompt exists to prevent.
 * A volunteer who has gone stale since being assigned arrives on the Shift
 * **flagged** — which is what ADR 0017 asks for — rather than absent.
 */
import { and, eq, gte, inArray } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { shiftPatternRoster, shiftPatterns, shiftRoster, shifts } from '../../db/schema'
import { shiftsToGenerate, type PatternToGenerate } from '../../shared/generation'
import { HORIZON_DAYS, isWeekday } from '../../shared/shifts'
import { dayString, type DayString } from '../../shared/time'
import { horizonFrom } from '../time'
import { recorded, type Recorded } from './outcome'

export interface Generated {
  /** How many Shifts this run created. Zero on a second run, which is the point. */
  readonly created: number
  /** The last day of the horizon it filled. */
  readonly through: DayString
}

/**
 * Fills the horizon from `today`, and answers what it did.
 *
 * Retired Patterns generate nothing: retiring one is how the rescue stops a
 * Tuesday morning without deleting the Shifts it already made.
 */
export async function generateHorizon(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: { readonly today: DayString; readonly timeZone: string },
): Promise<Recorded<Generated>> {
  const horizon = horizonFrom(about.today, HORIZON_DAYS, about.timeZone)
  const through = horizon[horizon.length - 1]?.day ?? about.today

  const patternRows = await db
    .select({
      id: shiftPatterns.id,
      weekday: shiftPatterns.weekday,
      shiftType: shiftPatterns.shiftType,
      startTime: shiftPatterns.startTime,
      targetHeadcount: shiftPatterns.targetHeadcount,
      retiredAt: shiftPatterns.retiredAt,
    })
    .from(shiftPatterns)

  const live = patternRows.filter((row) => row.retiredAt === null && isWeekday(row.weekday))
  if (live.length === 0) return recorded({ created: 0, through })

  const existing = await db
    .select({ patternId: shifts.patternId, day: shifts.day })
    .from(shifts)
    .where(gte(shifts.day, about.today))

  const patterns: PatternToGenerate[] = live.map((row) => ({
    id: row.id,
    // Narrowed by the filter above; the column is text and a deploy can be
    // older than a row, which is why it was checked at all.
    weekday: isWeekday(row.weekday) ? row.weekday : 'monday',
  }))

  const wanted = shiftsToGenerate(
    patterns,
    horizon,
    existing.map((row) => ({ patternId: row.patternId, day: dayString(row.day) })),
  )
  if (wanted.length === 0) return recorded({ created: 0, through })

  const byId = new Map(live.map((row) => [row.id, row]))
  const standing = await db
    .select({
      patternId: shiftPatternRoster.patternId,
      volunteerId: shiftPatternRoster.volunteerId,
      position: shiftPatternRoster.position,
    })
    .from(shiftPatternRoster)
    .where(inArray(shiftPatternRoster.patternId, [...byId.keys()]))

  const rosterBy = new Map<string, typeof standing>()
  for (const row of standing) {
    const held = rosterBy.get(row.patternId)
    if (held === undefined) rosterBy.set(row.patternId, [row])
    else held.push(row)
  }

  let created = 0
  for (const occurrence of wanted) {
    const pattern = byId.get(occurrence.patternId)
    if (pattern === undefined) continue

    const id = uuidv7()
    const inserted = await db
      .insert(shifts)
      .values({
        id,
        orgId,
        patternId: pattern.id,
        day: occurrence.day,
        shiftType: pattern.shiftType,
        // The copy. Everything below this line is a fact about the Shift from
        // now on, and no longer a reference to the Pattern (ADR 0001).
        startTime: pattern.startTime,
        targetHeadcount: pattern.targetHeadcount,
        staffingMode: 'standing_roster',
        createdBy: actorVolunteerId,
      })
      // Two runs at the same moment: the loser inserts nothing rather than
      // failing the whole generation, which is what makes this safe to repeat.
      .onConflictDoNothing({ target: [shifts.orgId, shifts.patternId, shifts.day] })
      .returning({ id: shifts.id })

    if (inserted.length === 0) continue
    created += 1

    const roster = rosterBy.get(pattern.id) ?? []
    if (roster.length === 0) continue
    await db.insert(shiftRoster).values(
      roster.map((row) => ({
        id: uuidv7(),
        orgId,
        shiftId: id,
        volunteerId: row.volunteerId,
        position: row.position,
        origin: 'standing_roster' as const,
        addedBy: actorVolunteerId,
      })),
    )
  }

  return recorded({ created, through })
}

/** Whether this Pattern has generated a Shift on this day already. For a test to ask. */
export async function hasOccurrence(
  db: OrgScopedDatabase,
  patternId: string,
  day: DayString,
): Promise<boolean> {
  const rows = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.patternId, patternId), eq(shifts.day, day)))
    .limit(1)
  return rows.length > 0
}
