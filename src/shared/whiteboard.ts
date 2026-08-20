/**
 * The Whiteboard Read vocabulary (ADR 0023): one photograph of one panel of a
 * rescue's paper board, turned into records at setup.
 *
 * **Whiteboard Read, never Board Read.** The **Board** is the tablet on the
 * barn wall and it reads nothing; this reads the paper one, once, at the desk.
 *
 * Lives here rather than beside the checks, for the reason `DOMAIN_SCOPES` and
 * `SPACE_KINDS` do: the panel a person picked crosses the wire on every call
 * and the report comes back over it (ADR 0021), so a second copy of either in
 * the contract is exactly the drift the contract exists to remove.
 */
import { z } from 'zod'

import type { DomainScope } from './domain-scopes'
import { ROUTES, SHIFT_TYPES } from './feed-schedule'
import { PRODUCT_KINDS } from './products'
import { SPACE_KINDS } from './spaces'

/**
 * The panels a barn's board is made of, and the whole of what may be shot.
 *
 * **The human says which one it is**, from a dropdown, before shooting. Barns
 * structure their boards differently, a misclassified panel writes to the
 * wrong tables, and it is one tap by somebody already holding the phone. A new
 * panel kind later is a value here, not a new path.
 */
export const WHITEBOARD_PANELS = ['grid', 'hay', 'contacts', 'rules'] as const

export type WhiteboardPanel = (typeof WHITEBOARD_PANELS)[number]

export function isWhiteboardPanel(stored: string): stored is WhiteboardPanel {
  return (WHITEBOARD_PANELS as readonly string[]).includes(stored)
}

/** What the dropdown says, and what the report calls the panel back. */
export const PANEL_LABEL: Record<WhiteboardPanel, string> = {
  grid: 'The horse grid',
  hay: 'Hay amounts',
  contacts: 'Phone numbers',
  rules: 'Feed, water and standing rules',
}

/** What a panel is, in the words somebody standing at the board would use. */
export const PANEL_HINT: Record<WhiteboardPanel, string> = {
  grid: 'One row per horse: stall, turnout, halter colour, height, and the AM/PM feed and medical cells.',
  hay: 'Hay amounts counted per Paddock, and whatever else the panel says.',
  contacts: 'Posted numbers — the vet, the farrier, the property owner.',
  rules: 'FEED/GRAIN, WATER, Baths — the panels that are instructions rather than a grid.',
}

/**
 * The kinds of record a Whiteboard Read can create.
 *
 * Products come out of the feed cells rather than a product list panel:
 * `Senior`, `Elevate` and `Previcox` are read out of AM/PM GRAIN and MEDICAL,
 * so the Feed Schedule lines come free — the same text is being read anyway,
 * and dropping them would only discard which horse it belonged to.
 */
export const WHITEBOARD_RECORDS = [
  'space',
  'horse',
  'product',
  'feed_schedule',
  'contact',
  'standing_rule',
] as const

export type WhiteboardRecord = (typeof WHITEBOARD_RECORDS)[number]

/** What the report calls each kind of record back. */
export const RECORD_LABEL: Record<WhiteboardRecord, string> = {
  space: 'Space',
  horse: 'Horse',
  product: 'Product',
  feed_schedule: 'Feed schedule',
  contact: 'Contact',
  standing_rule: 'Standing rule',
}

/**
 * The Domain Scope each kind of record is written under, everywhere else in
 * the application (ADR 0010).
 *
 * A total `Record` rather than a check in the handler, because this is the
 * whole of the authorization argument: a Whiteboard Read needs exactly the
 * Scopes it writes into, and no new Scope and no new axis (ADR 0023).
 */
export const RECORD_SCOPE: Record<WhiteboardRecord, DomainScope> = {
  space: 'horse_care',
  horse: 'horse_care',
  product: 'horse_care',
  feed_schedule: 'horse_care',
  contact: 'roster',
  standing_rule: 'roster',
}

/**
 * Which records a panel may write, and the fence the writer holds to.
 *
 * Anything the model returns outside its panel's list is reported as
 * could-not-place rather than written: it is the one thing standing between a
 * hallucinated horse on a photograph of the phone numbers and a horse record
 * created by somebody who holds only `roster`.
 */
export const PANEL_RECORDS: Record<WhiteboardPanel, readonly WhiteboardRecord[]> = {
  grid: ['space', 'horse', 'product', 'feed_schedule'],
  // The hay panel counts per Paddock, which is a Space, and the rest of what
  // it says is an instruction with no model behind it (ADR 0002's amendment).
  hay: ['space', 'standing_rule'],
  contacts: ['contact'],
  rules: ['standing_rule'],
}

/**
 * Every Domain Scope a panel writes into — all of which the caller must hold.
 *
 * Derived rather than listed, so a panel that gains a record kind gains the
 * Scope that kind is written under and nobody has to remember to widen a list.
 */
export function scopesForPanel(panel: WhiteboardPanel): readonly DomainScope[] {
  return [...new Set(PANEL_RECORDS[panel].map((record) => RECORD_SCOPE[record]))]
}

/** The image formats a phone camera actually produces, and nothing else. */
export const WHITEBOARD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type WhiteboardImageType = (typeof WHITEBOARD_IMAGE_TYPES)[number]

/**
 * The largest photograph one call may carry, counted in base64 characters
 * rather than bytes because that is what the payload actually holds.
 *
 * Roughly five megabytes decoded, which is what the model will take. A photo
 * over it is refused **in words** on the screen rather than failing somewhere
 * downstream: a volunteer holding a phone needs to be told to shoot the panel
 * again, not handed a 500.
 */
export const MOST_IMAGE_BASE64_CHARS = 6_990_000

/** Whether a base64 payload is small enough to send, checked on both sides. */
export function imageFits(base64: string): boolean {
  return base64.length > 0 && base64.length <= MOST_IMAGE_BASE64_CHARS
}

/**
 * What a read element has to be to become a record.
 *
 * Built from `SPACE_KINDS`, `PRODUCT_KINDS`, `SHIFT_TYPES` and `ROUTES` — the
 * same four constants `src/shared/api-contract.ts` builds its own `spaceKind`,
 * `productKind`, `shiftType` and `route` from, and the same lengths its writes
 * accept. One vocabulary with two readers is ADR 0021's whole shape; a second
 * copy of the kinds here would be the drift it exists to remove.
 *
 * They are applied **per element** rather than to the reading as a whole:
 * nine horses read out of ten writes nine and reports the tenth, because
 * all-or-nothing means one smudged cell costs the whole board (ADR 0023).
 */
export const readLine = z.object({
  productName: z.string().min(1).max(200),
  productKind: z.enum(PRODUCT_KINDS),
  prescription: z.boolean(),
  amount: z.string().min(1).max(200),
  route: z.enum(ROUTES),
})

export const readSpace = z.object({
  kind: z.enum(SPACE_KINDS),
  name: z.string().min(1).max(200),
})

export const readHorse = z.object({
  name: z.string().min(1).max(200),
  halterColour: z.string().max(100).nullable(),
  blanketSize: z.string().max(100).nullable(),
  height: z.string().max(50).nullable(),
  spaces: z.array(readSpace),
  feedings: z.array(z.object({ shiftType: z.enum(SHIFT_TYPES), lines: z.array(readLine) })),
})

export const readContact = z.object({
  name: z.string().min(1).max(200),
  number: z.string().min(1).max(50),
  hours: z.string().max(200).nullable(),
  purpose: z.string().min(1).max(500),
})

export const readStandingRule = z.object({ text: z.string().min(1).max(500) })
