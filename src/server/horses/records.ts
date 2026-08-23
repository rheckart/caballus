/**
 * The horse_care holder's acts on Horses and Spaces: creating and editing
 * each, assigning a horse to a Space per kind, and marking a horse Departed.
 *
 * Everything here takes the scoped transaction `mutation` opened rather than
 * opening one, so the effect and its audit entry commit together (ADR 0020) —
 * the same discipline `src/server/roster/records.ts` follows and the reason it
 * gives for it.
 *
 * **Every refusal is a named outcome rather than a thrown error** — a Space
 * that does not exist, a horse that does not exist — so a form gets *that
 * Space is gone* rather than a 500.
 */
import { and, eq, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { horseSpaceAssignments, horses, spaces } from '../../db/schema'
import type { SpaceKind } from '../../shared/spaces'
import type { DayString } from '../../shared/time'
import { audit, type AuditEntry } from '../roster/audit'
import { recorded, refused, type Recorded } from './outcome'

/** Re-exported so a handler has one import for a write and its outcome. */
export { type Recorded, type Refusal } from './outcome'

export interface NewSpace {
  readonly kind: SpaceKind
  readonly name: string
  /**
   * Why, on the audit entry. Nothing on a form asks for it — a creation has no
   * before to explain — but a Whiteboard Read carries one, because *read from
   * the whiteboard photograph* is the whole of what a later reader needs to
   * know about a record nobody typed (ADR 0023).
   */
  readonly reason?: string | null
}

/** Creates a Space. An empty Space — nothing assigned to it yet — is exactly as representable as any other (ADR 0002). */
export async function createSpace(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  details: NewSpace,
): Promise<Recorded<{ id: string; kind: SpaceKind; name: string }>> {
  const id = uuidv7()
  const name = details.name.trim()
  await db.insert(spaces).values({ id, orgId, kind: details.kind, name })

  await audit(db, orgId, actorVolunteerId, [
    { entity: 'space', entityId: id, after: name, reason: details.reason ?? null },
  ])

  return recorded({ id, kind: details.kind, name })
}

/**
 * Creates several Spaces at once: the whole of *ten stalls in the Big Barn*.
 *
 * **A name this kind already carries is skipped, never refused.** The batch
 * exists because somebody is describing a barn they already have, and
 * describing it twice — a Coordinator who added Stall 1 by hand last week and
 * now says *ten stalls* — is the ordinary case rather than a mistake. Refusing
 * the run would leave them to work out which nine to ask for; refusing nothing
 * and inserting a second Stall 1 would leave two rows the Board cannot tell
 * apart. So the run lands, and the answer says what it left alone.
 *
 * One transaction, because `mutation` opened it: ten Spaces and their ten
 * audit entries commit together or not at all (ADR 0020). There is no partial
 * barn.
 */
export async function createSpaces(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  details: {
    readonly kind: SpaceKind
    readonly names: readonly string[]
    readonly reason?: string | null
  },
): Promise<Recorded<{ created: { id: string; name: string }[]; skipped: string[] }>> {
  const wanted = details.names.map((name) => name.trim()).filter((name) => name !== '')

  // Read inside the caller's transaction, so *what exists* and *what is
  // inserted* cannot be answered from two different moments.
  const existing = await db
    .select({ name: spaces.name })
    .from(spaces)
    .where(eq(spaces.kind, details.kind))
  const held = new Set(existing.map((row) => row.name))

  const created: { id: string; name: string }[] = []
  const skipped: string[] = []
  for (const name of wanted) {
    // `held` grows as it goes, so a run that names the same stall twice
    // creates it once rather than twice.
    if (held.has(name)) {
      skipped.push(name)
      continue
    }
    held.add(name)
    created.push({ id: uuidv7(), name })
  }

  if (created.length > 0) {
    await db
      .insert(spaces)
      .values(created.map((space) => ({ ...space, orgId, kind: details.kind })))
    await audit(
      db,
      orgId,
      actorVolunteerId,
      created.map((space) => ({
        entity: 'space',
        entityId: space.id,
        after: space.name,
        reason: details.reason ?? null,
      })),
    )
  }

  return recorded({ created, skipped })
}

/**
 * Edits a Space's kind and name — the whole of how splitting or merging a
 * joined Space happens: `2 & 3` becomes `2` and `3` again, or `C` and `D`
 * become `All of C + D`, by an edit of the row rather than a new one (ADR
 * 0002).
 */
export async function editSpace(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    readonly spaceId: string
    readonly kind: SpaceKind
    readonly name: string
    readonly reason?: string | null
  },
): Promise<Recorded> {
  const [existing] = await db
    .select({ kind: spaces.kind, name: spaces.name })
    .from(spaces)
    .where(eq(spaces.id, about.spaceId))
    .limit(1)
  if (existing === undefined) return refused('space_not_found')

  // A horse's assignment row carries its own copy of the kind (the primary
  // key needs it independent of the Space), so re-purposing an occupied Space
  // to a different kind would leave that copy stale — a Stall a horse still
  // holds would silently start reading as a Field. Refused rather than
  // cascaded: nothing in ADR 0002's brief re-purposes an occupied Space, only
  // renames and splits one, and clearing it first keeps the assignment's copy
  // of the kind always true.
  if (existing.kind !== about.kind) {
    const [occupant] = await db
      .select({ horseId: horseSpaceAssignments.horseId })
      .from(horseSpaceAssignments)
      .where(eq(horseSpaceAssignments.spaceId, about.spaceId))
      .limit(1)
    if (occupant !== undefined) return refused('space_occupied')
  }

  const name = about.name.trim()
  await db.update(spaces).set({ kind: about.kind, name }).where(eq(spaces.id, about.spaceId))

  const entries: AuditEntry[] = []
  if (existing.name !== name) {
    entries.push({
      entity: 'space',
      entityId: about.spaceId,
      field: 'name',
      before: existing.name,
      after: name,
      reason: about.reason ?? null,
    })
  }
  if (existing.kind !== about.kind) {
    entries.push({
      entity: 'space',
      entityId: about.spaceId,
      field: 'kind',
      before: existing.kind,
      after: about.kind,
      reason: about.reason ?? null,
    })
  }
  await audit(db, orgId, actorVolunteerId, entries)

  return recorded(null)
}

/**
 * Marks a Space Retired, or corrects a mistaken one — a date, never a delete
 * (ADR 0002), the same call `recordHorseDeparture` makes for a horse. The row
 * and its history are untouched; hiding it from a work surface is the
 * reader's concern.
 *
 * Refused while occupied, the same as `editSpace`'s kind change: a Space a
 * horse still holds going quietly off the assignment screens is the stale
 * state that refusal already exists to prevent, not a fresh rule.
 */
export async function recordSpaceRetirement(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    readonly spaceId: string
    readonly retiredOn: DayString | null
    readonly reason?: string | null
  },
): Promise<Recorded> {
  const [existing] = await db
    .select({ retiredOn: spaces.retiredOn })
    .from(spaces)
    .where(eq(spaces.id, about.spaceId))
    .limit(1)
  if (existing === undefined) return refused('space_not_found')

  if (about.retiredOn !== null) {
    const [occupant] = await db
      .select({ horseId: horseSpaceAssignments.horseId })
      .from(horseSpaceAssignments)
      .where(eq(horseSpaceAssignments.spaceId, about.spaceId))
      .limit(1)
    if (occupant !== undefined) return refused('space_occupied')
  }

  await db.update(spaces).set({ retiredOn: about.retiredOn }).where(eq(spaces.id, about.spaceId))

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'space',
      entityId: about.spaceId,
      field: 'retired_on',
      before: existing.retiredOn,
      after: about.retiredOn,
      reason: about.reason ?? null,
    },
  ])

  return recorded(null)
}

export interface NewHorse {
  readonly name: string
  readonly halterColour?: string | null
  readonly blanketSize?: string | null
  readonly height?: string | null
  readonly photoUrl?: string | null
  /** Why, on the audit entry — a Whiteboard Read's *read from the whiteboard photograph* (ADR 0023). */
  readonly reason?: string | null
}

/** Creates a Horse. Space assignment and Departure are their own acts, below. */
export async function createHorse(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  details: NewHorse,
): Promise<Recorded<{ id: string; name: string }>> {
  const id = uuidv7()
  const name = details.name.trim()
  await db.insert(horses).values({
    id,
    orgId,
    name,
    halterColour: normalised(details.halterColour),
    blanketSize: normalised(details.blanketSize),
    height: normalised(details.height),
    photoUrl: normalised(details.photoUrl),
  })

  await audit(db, orgId, actorVolunteerId, [
    { entity: 'horse', entityId: id, after: name, reason: details.reason ?? null },
  ])

  return recorded({ id, name })
}

function normalised(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

interface HorseAttributeEdit {
  readonly horseId: string
  /** `undefined` leaves the field unchanged; `null` clears it (name excepted, which is never blank). */
  readonly name?: string
  readonly halterColour?: string | null
  readonly blanketSize?: string | null
  readonly height?: string | null
  readonly photoUrl?: string | null
  readonly reason?: string | null
}

const EDITABLE_FIELDS = ['name', 'halterColour', 'blanketSize', 'height', 'photoUrl'] as const

/** The audit log's field name for each — snake_case, matching the column and every other audit entry in this application. */
const AUDIT_FIELD_NAME: Record<(typeof EDITABLE_FIELDS)[number], string> = {
  name: 'name',
  halterColour: 'halter_colour',
  blanketSize: 'blanket_size',
  height: 'height',
  photoUrl: 'photo_url',
}

/**
 * Edits a Horse's descriptive attributes in place, auditing only the fields
 * that were actually sent and actually changed (ADR 0003) — the same
 * before/after discipline `recordDateOfBirth` follows.
 */
export async function editHorseAttributes(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: HorseAttributeEdit,
): Promise<Recorded> {
  const [existing] = await db
    .select({
      name: horses.name,
      halterColour: horses.halterColour,
      blanketSize: horses.blanketSize,
      height: horses.height,
      photoUrl: horses.photoUrl,
    })
    .from(horses)
    .where(eq(horses.id, about.horseId))
    .limit(1)
  if (existing === undefined) return refused('horse_not_found')

  const next: Record<string, string | null> = {}
  const entries: AuditEntry[] = []
  for (const field of EDITABLE_FIELDS) {
    if (!(field in about)) continue
    const after = field === 'name' ? (about.name ?? existing.name).trim() : normalised(about[field])
    const before = existing[field]
    if (after === before) continue
    next[field] = after
    entries.push({
      entity: 'horse',
      entityId: about.horseId,
      field: AUDIT_FIELD_NAME[field],
      before,
      after,
      reason: about.reason ?? null,
    })
  }

  if (Object.keys(next).length > 0) {
    await db.update(horses).set(next).where(eq(horses.id, about.horseId))
  }
  await audit(db, orgId, actorVolunteerId, entries)

  return recorded(null)
}

/**
 * Assigns — or, with `spaceId: null`, clears — a Horse's Space for one kind.
 *
 * A horse holds at most one row per kind (the table's primary key), so
 * reassigning is an upsert and clearing is a delete rather than a null value:
 * there is no row to represent, which is the state "not yet placed" already
 * is.
 */
export async function assignHorseSpace(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    readonly horseId: string
    readonly kind: SpaceKind
    readonly spaceId: string | null
    readonly reason?: string | null
  },
): Promise<Recorded> {
  const [horse] = await db
    .select({ id: horses.id })
    .from(horses)
    .where(eq(horses.id, about.horseId))
    .limit(1)
  if (horse === undefined) return refused('horse_not_found')

  const [current] = await db
    .select({ spaceId: horseSpaceAssignments.spaceId, name: spaces.name })
    .from(horseSpaceAssignments)
    .innerJoin(spaces, eq(spaces.id, horseSpaceAssignments.spaceId))
    .where(
      and(
        eq(horseSpaceAssignments.horseId, about.horseId),
        eq(horseSpaceAssignments.kind, about.kind),
      ),
    )
    .limit(1)

  if (about.spaceId === null) {
    if (current === undefined) return recorded(null)
    await db
      .delete(horseSpaceAssignments)
      .where(
        and(
          eq(horseSpaceAssignments.horseId, about.horseId),
          eq(horseSpaceAssignments.kind, about.kind),
        ),
      )
    await audit(db, orgId, actorVolunteerId, [
      {
        entity: 'horse_space_assignment',
        entityId: about.horseId,
        field: about.kind,
        before: current.name,
        after: null,
      },
    ])
    return recorded(null)
  }

  const [space] = await db
    .select({ id: spaces.id, kind: spaces.kind, name: spaces.name })
    .from(spaces)
    .where(eq(spaces.id, about.spaceId))
    .limit(1)
  if (space === undefined) return refused('space_not_found')
  if (space.kind !== about.kind) return refused('space_kind_mismatch')
  if (current?.spaceId === space.id) return recorded(null)

  await db
    .insert(horseSpaceAssignments)
    .values({
      orgId,
      horseId: about.horseId,
      kind: about.kind,
      spaceId: space.id,
      assignedBy: actorVolunteerId,
    })
    .onConflictDoUpdate({
      target: [
        horseSpaceAssignments.orgId,
        horseSpaceAssignments.horseId,
        horseSpaceAssignments.kind,
      ],
      set: { spaceId: space.id, assignedBy: actorVolunteerId, assignedAt: sql`now()` },
    })

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'horse_space_assignment',
      entityId: about.horseId,
      field: about.kind,
      before: current?.name ?? null,
      after: space.name,
      reason: about.reason ?? null,
    },
  ])

  return recorded(null)
}

/**
 * Marks a horse Departed, or corrects a mistaken one — a date, never a delete
 * (ADR 0002, #32). The row and its history are untouched; hiding it from a
 * work surface is the reader's concern, in `src/server/horses/list.ts`.
 */
export async function recordHorseDeparture(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    readonly horseId: string
    readonly departedOn: DayString | null
    readonly reason?: string | null
  },
): Promise<Recorded> {
  const [existing] = await db
    .select({ departedOn: horses.departedOn })
    .from(horses)
    .where(eq(horses.id, about.horseId))
    .limit(1)
  if (existing === undefined) return refused('horse_not_found')

  await db.update(horses).set({ departedOn: about.departedOn }).where(eq(horses.id, about.horseId))

  await audit(db, orgId, actorVolunteerId, [
    {
      entity: 'horse',
      entityId: about.horseId,
      field: 'departed_on',
      before: existing.departedOn,
      after: about.departedOn,
      reason: about.reason ?? null,
    },
  ])

  return recorded(null)
}
