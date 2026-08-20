/**
 * The Whiteboard Read itself: a photograph of one panel becomes records
 * (ADR 0023, #59).
 *
 * It writes through the same `createSpaces`, `createHorse`, `createProduct`,
 * `publishFeedSchedule`, `createContact` and `createStandingRule` the desk
 * screens call, in the transaction `mutation` opened — so every record it
 * creates carries the audit entry those already write, authored by whoever
 * pressed the button, with the reason *read from the whiteboard photograph*.
 * That is the durable trail, and it is why there is no import log: a fifth
 * hand-rolled table to remember an import that already left one is what ADR
 * 0019 warned about.
 *
 * **Three rules make it safe, and they are all here rather than in prose.**
 *
 * *Additive only.* A name already held is skipped and named back, exactly as
 * `/spaces/batch` does. A horse already held is skipped **whole** — its Feed
 * Schedule is not republished — so a second run cannot overwrite a correction
 * somebody made after the first.
 *
 * *Partial writes are the point.* Nine horses read out of ten writes nine, in
 * one transaction, and reports the tenth. All-or-nothing means one smudged
 * cell costs the whole board.
 *
 * *The fence is the panel.* Anything outside `PANEL_RECORDS` is reported as
 * could-not-place rather than written, which is what stands between a
 * hallucinated horse on a photograph of the phone numbers and a horse record
 * created by somebody holding only `roster`.
 */
import { inArray } from 'drizzle-orm'
import type { z } from 'zod'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { contacts, horses, products, spaces, standingRules } from '../../db/schema'
import type { DomainScope } from '../../shared/domain-scopes'
import type { ShiftType } from '../../shared/feed-schedule'
import type { ProductKind } from '../../shared/products'
import type { SpaceKind } from '../../shared/spaces'
import type { DayString } from '../../shared/time'
import {
  PANEL_RECORDS,
  RECORD_LABEL,
  readContact,
  readHorse,
  readSpace,
  readStandingRule,
  scopesForPanel,
  type WhiteboardPanel,
  type WhiteboardRecord,
} from '../../shared/whiteboard'
import { createContact, createStandingRule } from '../contacts/records'
import { publishFeedSchedule } from '../horses/feed-schedules'
import { assignHorseSpace, createHorse, createSpaces } from '../horses/records'
import { createProduct } from '../products/records'
import { ReadingFailed, whiteboardReader, type Photograph, type WhiteboardReading } from './model'

/**
 * What the report calls a Shift Type. Its own three rather than a screen's,
 * because a Feed Schedule only ever has these — `pop_up` authors its own list
 * and never carries one (ADR 0013).
 */
const SHIFT_TYPE_LABEL: Record<ShiftType, string> = {
  feed_am: 'Feed AM',
  feed_pm: 'Feed PM',
  lunch: 'Lunch',
}

/** What a Whiteboard Read refuses with. Its own union, the way weather's is its own. */
export type Refusal =
  /** Nobody has given this deployment a model key; it fails closed rather than obscurely. */
  | 'whiteboard_reader_not_set'
  /** The model did not answer, or declined. Nothing is written. */
  | 'whiteboard_unreadable'
  /** The caller does not hold every Domain Scope this panel writes into. */
  | 'not_authorized_for_panel'

export type Recorded<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly because: Refusal }

export interface WhiteboardReport {
  readonly created: readonly { record: WhiteboardRecord; name: string; id: string }[]
  readonly skipped: readonly { record: WhiteboardRecord; name: string }[]
  readonly blank: readonly string[]
  readonly couldNotPlace: readonly string[]
  readonly check: readonly string[]
}

/** Who is asking, as `RequestContext`'s own `Actor` already carries them. */
export interface Reader {
  readonly volunteerId: string
  readonly domainScopes: readonly DomainScope[]
}

/** What every audit entry this act writes says, and the whole of the trail it leaves. */
const REASON = 'read from the whiteboard photograph'

export async function recordWhiteboardRead(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actor: Reader,
  input: Photograph,
  today: DayString,
): Promise<Recorded<WhiteboardReport>> {
  // The Scopes the panel writes into, all of them — no new Scope and no new
  // axis (ADR 0010, ADR 0023). Resolved here rather than declared on the route
  // because which Scopes are needed depends on the payload's own `panel`, the
  // same data-dependent check `escalateObservation` and `recordSuppliesReading`
  // already resolve inside themselves.
  const needed = scopesForPanel(input.panel)
  if (!needed.every((scope) => actor.domainScopes.includes(scope))) {
    return { ok: false, because: 'not_authorized_for_panel' }
  }

  const reader = whiteboardReader()
  if (reader === null) return { ok: false, because: 'whiteboard_reader_not_set' }

  let reading: WhiteboardReading
  try {
    reading = await reader(input)
  } catch (error: unknown) {
    if (!(error instanceof ReadingFailed)) throw error
    return { ok: false, because: 'whiteboard_unreadable' }
  }

  return {
    ok: true,
    value: await write(db, orgId, actor.volunteerId, input.panel, reading, today),
  }
}

/** The report as it is built up, before it is frozen into the answer. */
interface Sheet {
  readonly created: { record: WhiteboardRecord; name: string; id: string }[]
  readonly skipped: { record: WhiteboardRecord; name: string }[]
  readonly blank: string[]
  readonly couldNotPlace: string[]
  readonly check: string[]
}

async function write(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  panel: WhiteboardPanel,
  reading: WhiteboardReading,
  today: DayString,
): Promise<WhiteboardReport> {
  const sheet: Sheet = {
    created: [],
    skipped: [],
    blank: [...reading.blank],
    couldNotPlace: [...reading.couldNotPlace],
    check: [],
  }
  const writes = PANEL_RECORDS[panel]
  const mayWrite = (record: WhiteboardRecord): boolean => writes.includes(record)

  // Every horse this panel could read, parsed once. A horse that does not
  // parse is one horse lost rather than the panel.
  const parsedHorses = mayWrite('horse') ? parseEach(reading.horses, readHorse, 'horse', sheet) : []

  // The stall column *is* the stall list, so a Space named on a horse's row
  // counts as much as one in the Spaces array — a grid panel that listed
  // neither would place nobody.
  const spaceIds = mayWrite('space')
    ? await writeSpaces(
        db,
        orgId,
        actorVolunteerId,
        [
          ...parseEach(reading.spaces, readSpace, 'space', sheet),
          ...parsedHorses.flatMap((horse) => horse.spaces),
        ],
        sheet,
      )
    : new Map<string, string>()

  const productIds = mayWrite('product')
    ? await writeProducts(db, orgId, actorVolunteerId, parsedHorses, sheet)
    : new Map<string, string>()

  if (mayWrite('horse')) {
    await writeHorses(db, orgId, actorVolunteerId, {
      parsedHorses,
      spaceIds,
      productIds,
      panel,
      today,
      sheet,
    })
  }

  if (mayWrite('contact')) {
    await writeContacts(
      db,
      orgId,
      actorVolunteerId,
      parseEach(reading.contacts, readContact, 'contact', sheet),
      sheet,
    )
  }

  if (mayWrite('standing_rule')) {
    await writeStandingRules(
      db,
      orgId,
      actorVolunteerId,
      parseEach(reading.standingRules, readStandingRule, 'standing_rule', sheet),
      sheet,
    )
  }

  // Whatever the model returned that this panel does not write. Named rather
  // than dropped: a grid read that answered with phone numbers is a fact the
  // person who pressed the button should hear about.
  for (const record of ['space', 'horse', 'contact', 'standing_rule'] as const) {
    if (mayWrite(record)) continue
    const count = countOf(reading, record)
    if (count > 0) {
      sheet.couldNotPlace.push(
        `${String(count)} ${RECORD_LABEL[record]} reading(s) came back, which this panel does not write.`,
      )
    }
  }

  return sheet
}

function countOf(reading: WhiteboardReading, record: WhiteboardRecord): number {
  if (record === 'space') return reading.spaces.length
  if (record === 'horse') return reading.horses.length
  if (record === 'contact') return reading.contacts.length
  return reading.standingRules.length
}

/**
 * Parses each element on its own, moving what does not parse to
 * could-not-place rather than coercing it (ADR 0023).
 */
function parseEach<T>(
  rows: readonly unknown[],
  schema: z.ZodType<T>,
  record: WhiteboardRecord,
  sheet: Sheet,
): T[] {
  const kept: T[] = []
  for (const row of rows) {
    const parsed = schema.safeParse(row)
    if (parsed.success) kept.push(parsed.data)
    else sheet.couldNotPlace.push(`A ${RECORD_LABEL[record]} reading did not parse: ${brief(row)}`)
  }
  return kept
}

/** Enough of an unparseable reading to go and look at the board with, and no more. */
function brief(row: unknown): string {
  const text = JSON.stringify(row) ?? 'nothing'
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}

/** `kind name` — a Space's identity is its name *under its kind*, as `/spaces/batch` has it. */
function spaceKey(kind: SpaceKind, name: string): string {
  return `${kind} ${name.trim()}`
}

async function writeSpaces(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  wanted: readonly { kind: SpaceKind; name: string }[],
  sheet: Sheet,
): Promise<Map<string, string>> {
  const byKind = new Map<SpaceKind, string[]>()
  for (const space of wanted) {
    const held = byKind.get(space.kind) ?? []
    if (!held.includes(space.name.trim())) held.push(space.name.trim())
    byKind.set(space.kind, held)
  }

  for (const [kind, names] of byKind) {
    const outcome = await createSpaces(db, orgId, actorVolunteerId, { kind, names, reason: REASON })
    if (!outcome.ok) continue
    for (const space of outcome.value.created) {
      sheet.created.push({
        record: 'space',
        name: `${RECORD_LABEL.space} ${space.name}`,
        id: space.id,
      })
    }
    for (const name of outcome.value.skipped) {
      sheet.skipped.push({ record: 'space', name: `${RECORD_LABEL.space} ${name}` })
    }
  }

  // Read back after creating, so the map carries the Spaces that already
  // existed as well as the ones this run made — a horse whose stall was
  // already on file still gets placed in it.
  const kinds = [...byKind.keys()]
  if (kinds.length === 0) return new Map()
  const rows = await db
    .select({ id: spaces.id, kind: spaces.kind, name: spaces.name })
    .from(spaces)
    .where(inArray(spaces.kind, kinds))
  return new Map(rows.map((row) => [`${row.kind} ${row.name}`, row.id]))
}

type ParsedHorse = ReturnType<typeof readHorse.parse>
type ParsedLine = ParsedHorse['feedings'][number]['lines'][number]

async function writeProducts(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  parsedHorses: readonly ParsedHorse[],
  sheet: Sheet,
): Promise<Map<string, string>> {
  const wanted = new Map<string, { kind: ProductKind; prescription: boolean }>()
  for (const horse of parsedHorses) {
    for (const feeding of horse.feedings) {
      for (const line of feeding.lines) {
        const name = line.productName.trim()
        if (!wanted.has(name)) {
          wanted.set(name, { kind: line.productKind, prescription: line.prescription })
        }
      }
    }
  }
  if (wanted.size === 0) return new Map()

  const existing = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(inArray(products.name, [...wanted.keys()]))
  const ids = new Map(existing.map((row) => [row.name, row.id]))

  for (const [name, about] of wanted) {
    if (ids.has(name)) {
      sheet.skipped.push({ record: 'product', name })
      continue
    }
    // A Topical is never a prescription, whatever the model proposed (#58).
    const prescription = about.kind === 'topical' ? false : about.prescription
    const outcome = await createProduct(db, orgId, actorVolunteerId, {
      name,
      kind: about.kind,
      prescription,
      reason: REASON,
    })
    if (!outcome.ok) {
      sheet.couldNotPlace.push(`The Product ${name} could not be created.`)
      continue
    }
    ids.set(name, outcome.value.id)
    sheet.created.push({ record: 'product', name, id: outcome.value.id })
    // `prescription` is required on `/products` and no board says it, so every
    // created medication is named for a `horse_care` holder to check.
    if (about.kind === 'medication') {
      sheet.check.push(
        `${name} was read as a medication and recorded as ${prescription ? 'needing' : 'not needing'} a prescription. Check it.`,
      )
    }
  }

  return ids
}

async function writeHorses(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    parsedHorses: readonly ParsedHorse[]
    spaceIds: Map<string, string>
    productIds: Map<string, string>
    panel: WhiteboardPanel
    today: DayString
    sheet: Sheet
  },
): Promise<void> {
  const { parsedHorses, spaceIds, productIds, panel, today, sheet } = about
  const names = parsedHorses.map((horse) => horse.name.trim())
  const existing =
    names.length === 0
      ? []
      : await db.select({ name: horses.name }).from(horses).where(inArray(horses.name, names))
  const held = new Set(existing.map((row) => row.name))

  for (const horse of parsedHorses) {
    const name = horse.name.trim()
    // Skipped **whole**, feed lines and all: this act never edits an existing
    // record, so a second run cannot overwrite a correction (ADR 0023).
    if (held.has(name)) {
      sheet.skipped.push({ record: 'horse', name })
      continue
    }
    held.add(name)

    const created = await createHorse(db, orgId, actorVolunteerId, {
      name,
      halterColour: horse.halterColour,
      blanketSize: horse.blanketSize,
      height: horse.height,
      reason: REASON,
    })
    if (!created.ok) {
      sheet.couldNotPlace.push(`The horse ${name} could not be created.`)
      continue
    }
    const horseId = created.value.id
    sheet.created.push({ record: 'horse', name, id: horseId })

    for (const place of horse.spaces) {
      const spaceId = spaceIds.get(spaceKey(place.kind, place.name))
      if (spaceId === undefined) {
        sheet.couldNotPlace.push(`${name}'s ${place.kind} “${place.name}” is not a Space here.`)
        continue
      }
      await assignHorseSpace(db, orgId, actorVolunteerId, {
        horseId,
        kind: place.kind,
        spaceId,
        reason: REASON,
      })
    }

    if (!PANEL_RECORDS[panel].includes('feed_schedule')) continue
    await writeFeedSchedules(db, orgId, actorVolunteerId, {
      horseId,
      horseName: name,
      horse,
      productIds,
      today,
      sheet,
    })
  }
}

async function writeFeedSchedules(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: {
    horseId: string
    horseName: string
    horse: ParsedHorse
    productIds: Map<string, string>
    today: DayString
    sheet: Sheet
  },
): Promise<void> {
  const { horseId, horseName, horse, productIds, today, sheet } = about

  for (const feeding of horse.feedings) {
    const lines: { productId: string; amount: string; route: ParsedLine['route'] }[] = []
    for (const line of feeding.lines) {
      const productId = productIds.get(line.productName.trim())
      if (productId === undefined) {
        sheet.couldNotPlace.push(
          `${horseName}'s ${SHIFT_TYPE_LABEL[feeding.shiftType]} line “${line.productName}” has no Product.`,
        )
        continue
      }
      // `amount` is free text, so `2 cups Senior` and the board's own
      // `2 wells` land as written and nothing here divides a sack (ADR 0019).
      lines.push({ productId, amount: line.amount, route: line.route })
    }
    if (lines.length === 0) continue

    const published = await publishFeedSchedule(db, orgId, actorVolunteerId, {
      horseId,
      shiftType: feeding.shiftType,
      validFrom: today,
      lines,
    })
    if (!published.ok) {
      sheet.couldNotPlace.push(
        `${horseName}'s ${SHIFT_TYPE_LABEL[feeding.shiftType]} feed schedule could not be published.`,
      )
      continue
    }
    sheet.created.push({
      record: 'feed_schedule',
      name: `${horseName} — ${SHIFT_TYPE_LABEL[feeding.shiftType]}`,
      id: published.value.id,
    })
  }
}

async function writeContacts(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  parsed: readonly ReturnType<typeof readContact.parse>[],
  sheet: Sheet,
): Promise<void> {
  const names = parsed.map((contact) => contact.name.trim())
  const existing =
    names.length === 0
      ? []
      : await db.select({ name: contacts.name }).from(contacts).where(inArray(contacts.name, names))
  const held = new Set(existing.map((row) => row.name))

  for (const contact of parsed) {
    const name = contact.name.trim()
    if (held.has(name)) {
      sheet.skipped.push({ record: 'contact', name })
      continue
    }
    held.add(name)
    const created = await createContact(db, orgId, actorVolunteerId, {
      ...contact,
      name,
      reason: REASON,
    })
    if (!created.ok) {
      sheet.couldNotPlace.push(`The contact ${name} could not be created.`)
      continue
    }
    sheet.created.push({ record: 'contact', name, id: created.value.id })
  }
}

async function writeStandingRules(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  parsed: readonly { text: string }[],
  sheet: Sheet,
): Promise<void> {
  // A standing rule has no name, so its own text is its identity: the residue
  // bucket lands verbatim, with no interpretation, and a second run of the
  // same panel recognises the same sentence.
  const existing = await db.select({ text: standingRules.text }).from(standingRules)
  const held = new Set(existing.map((row) => row.text))

  for (const rule of parsed) {
    const text = rule.text.trim()
    if (held.has(text)) {
      sheet.skipped.push({ record: 'standing_rule', name: text })
      continue
    }
    held.add(text)
    const created = await createStandingRule(db, orgId, actorVolunteerId, { text, reason: REASON })
    if (!created.ok) {
      sheet.couldNotPlace.push(`The standing rule “${text}” could not be created.`)
      continue
    }
    sheet.created.push({ record: 'standing_rule', name: text, id: created.value.id })
  }
}
