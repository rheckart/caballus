/**
 * The Feed Schedule vocabulary and its two derivations (`CONTEXT.md`'s Feed
 * Schedule, Shift Type and Route; ADR 0003, ADR 0013).
 *
 * The derivations are pure — they touch no I/O — for the reason
 * `src/shared/rostering.ts` gives for its own: a handler resolves the current
 * version of a schedule from the database, and everything past that point is
 * arithmetic a table of inputs can exercise directly.
 */
import { daysBetween, type DayString } from './time'

/**
 * What kind of work a Shift is (`CONTEXT.md`'s Shift Type). Only Feed AM, Feed
 * PM and Lunch carry a Feed Schedule; a Pop-up is created ad hoc and never has
 * one.
 */
export const SHIFT_TYPES = ['feed_am', 'feed_pm', 'lunch'] as const

export type ShiftType = (typeof SHIFT_TYPES)[number]

export function isShiftType(stored: string): stored is ShiftType {
  return (SHIFT_TYPES as readonly string[]).includes(stored)
}

/** How a Product reaches the horse (`CONTEXT.md`'s Route) — medication is not always given in feed. */
export const ROUTES = ['in_feed', 'oral_syringe', 'topical', 'other'] as const

export type Route = (typeof ROUTES)[number]

export function isRoute(stored: string): stored is Route {
  return (ROUTES as readonly string[]).includes(stored)
}

/**
 * The window a Feed Schedule version is shown as New (ADR 0003's "changed in
 * the last 14 days" marker; ADR 0013 extends the marker to the versioned
 * tier). Ageing out on its own is the whole point — the whiteboard's blue
 * underline never did.
 */
export const NEW_WINDOW_DAYS = 14

/**
 * Whether a version published on `validFrom` still carries the New marker on
 * `today`. Derived from the date rather than a flag the write set, so the
 * marker ages out by itself (`CONTEXT.md`'s New).
 */
export function isNewVersion(validFrom: DayString, today: DayString): boolean {
  const age = daysBetween(validFrom, today)
  return age >= 0 && age <= NEW_WINDOW_DAYS
}

/** One Feed Schedule line, as far as the derivation below needs to see it. */
export interface FeedLineProductKind {
  readonly productKind: string
}

/**
 * Whether a Shift Type's current feeding includes medication — staffing needs
 * this to ask whether a Shift needs somebody holding Medication Authority, and
 * materialization needs it to decide whether a medication Item belongs on the
 * checklist.
 *
 * Takes the current lines across every horse's schedule for one Shift Type,
 * already resolved by the caller: this module touches no I/O, and "current"
 * is a question about version history that belongs to the database read.
 */
export function shiftTypeIncludesMedication(lines: readonly FeedLineProductKind[]): boolean {
  return lines.some((line) => line.productKind === 'medication')
}
