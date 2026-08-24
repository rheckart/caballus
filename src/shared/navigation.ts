/**
 * The Destinations, and the Domain Scopes each one needs — the constant ADR
 * 0026 insists is hand-declared rather than derived.
 *
 * **A Destination is gated on the write it exists to perform, not its read.**
 * ADR 0010's floor answers *may you look*, and it answers *yes* for almost
 * everything: eleven of the twelve desk screens read through `readEverything`,
 * so hiding by the read would hide two of them and leave the other ten dead in
 * front of a plain Volunteer. Navigation is asking a different question — *is
 * there anything here for you to do* — and it has to be gated on a different
 * fact. `/admin/spaces` exists to run `mutation('/spaces', domainScope(
 * 'horse_care'))`; without `horse_care` there is nothing there but a read you
 * already have at `/horses`.
 *
 * **Two Destinations have no write of their own** — `/admin/audit` and
 * `/admin/attendance` — and keep their read (`roster`) as the gate, which is
 * the same answer either way for them.
 *
 * **This is cosmetic and never a security boundary.** Nothing in `src/server/`
 * imports this module. Every screen below is still reachable by typing its
 * path, and the server refuses exactly as it does today. A future reader must
 * not mistake a Destination that is not offered for an authorization check.
 *
 * It lives beside `src/shared/roles.ts` and is shaped like it for the same
 * reason: the mapping is small, it is a decision rather than a derivation, and
 * a wrong entry should be visible in a diff. `src/shared/api-contract.ts`
 * records no authorization at all (ADR 0021), `src/server/api/app.ts` does, and
 * which of a screen's several writes is the *defining* one is a judgement
 * nothing can pick out mechanically — `/admin/products` calls four.
 */
import type { DomainScope } from './domain-scopes'

/**
 * The two groups, and neither is the word that first suggested itself.
 *
 * *General* rather than **Barn**, because Barn is already a `SPACE_KINDS`
 * value and already a glossary term under Places — *Small Barn* is a room
 * somebody mucks out, and a heading that also means it is the collision
 * CONTEXT.md's rule against inventing vocabulary exists to prevent.
 *
 * *Admin* rather than **Desk**, because *General / Desk* is a mismatched pair
 * and *Admin* is the word the URLs these screens already live under use.
 */
export const NAVIGATION_GROUPS = ['general', 'admin'] as const

export type NavigationGroup = (typeof NAVIGATION_GROUPS)[number]

export const GROUP_NAMES: Readonly<Record<NavigationGroup, string>> = {
  general: 'General',
  admin: 'Admin',
}

export interface Destination {
  /** Where it goes, exactly as the router spells it. */
  readonly to: string
  /** What the sidebar calls it. */
  readonly label: string
  readonly group: NavigationGroup
  /**
   * The Domain Scopes that make this Destination worth offering, **any one of
   * which is enough**. Empty means the floor — offered to everybody.
   *
   * Any-of rather than all-of because that is what the server does at the two
   * places a desk screen needs more than one: `/products` and `/whiteboard-read`
   * both declare `anyDomainScope`, and a screen offered only to somebody
   * holding both would be offered to nobody.
   */
  readonly scopes: readonly DomainScope[]
}

/**
 * Every Destination the shell can render, in the order the sidebar lists them.
 *
 * `/login` is not here and never will be: it is the one screen you reach by
 * not being signed in, and the shell stays off it. Neither is `/board` a
 * candidate for hiding — the tablet authenticates as the barn and has no
 * `Actor` to hide anything from (ADR 0022) — but it is listed, because a
 * person at a desk still opens it from the sidebar.
 */
export const DESTINATIONS = [
  { to: '/', label: 'Home', group: 'general', scopes: [] },
  { to: '/shifts', label: 'Shifts', group: 'general', scopes: [] },
  { to: '/horses', label: 'Horses', group: 'general', scopes: [] },
  { to: '/board', label: 'Feed board', group: 'general', scopes: [] },
  { to: '/supplies', label: 'Supplies', group: 'general', scopes: [] },
  { to: '/contacts', label: 'Contacts', group: 'general', scopes: [] },
  /**
   * The barn's one gated Destination, and the exception ADR 0026 names. #43
   * put the whole Attendance ledger behind `roster` for the desktop hours
   * report, against ADR 0012's own argument for the read-everything floor —
   * so here, uniquely in this group, the read *is* the gate.
   *
   * It is not in the bottom tab bar, which is what keeps that bar's shape
   * fixed: a volunteer finds Shifts in the same place every time.
   */
  { to: '/attendance', label: 'Attendance', group: 'general', scopes: ['roster'] },
  { to: '/escalations', label: 'Escalations', group: 'general', scopes: [] },

  { to: '/admin/volunteers', label: 'Volunteers', group: 'admin', scopes: ['roster'] },
  { to: '/admin/horses', label: 'Horses', group: 'admin', scopes: ['horse_care'] },
  { to: '/admin/spaces', label: 'Spaces', group: 'admin', scopes: ['horse_care'] },
  {
    to: '/admin/products',
    label: 'Products',
    group: 'admin',
    scopes: ['horse_care', 'supplies'],
  },
  { to: '/admin/shift-patterns', label: 'Shift patterns', group: 'admin', scopes: ['roster'] },
  { to: '/admin/tasks', label: 'Tasks', group: 'admin', scopes: ['horse_care'] },
  { to: '/admin/thresholds', label: 'Thresholds', group: 'admin', scopes: ['horse_care'] },
  { to: '/admin/attendance', label: 'Hours', group: 'admin', scopes: ['roster'] },
  { to: '/admin/release-versions', label: 'Release versions', group: 'admin', scopes: ['roster'] },
  { to: '/admin/contacts', label: 'Contacts', group: 'admin', scopes: ['roster'] },
  {
    to: '/admin/whiteboard-read',
    label: 'Read the whiteboard',
    group: 'admin',
    scopes: ['horse_care', 'roster'],
  },
  { to: '/admin/audit', label: 'Audit log', group: 'admin', scopes: ['roster'] },
] as const satisfies readonly Destination[]

/**
 * Every Destination's path, as a union of the literals above.
 *
 * `as const satisfies` rather than an annotation, so that this type is the
 * paths themselves rather than `string` — which is what lets the shell key a
 * **total** `Record` of icons on it and fail to compile when a Destination is
 * added without one, the discipline `ITEM_FOR_PRODUCT_KIND` keeps around a
 * Product's kind (#57).
 */
export type DestinationPath = (typeof DESTINATIONS)[number]['to']

/**
 * One of the Destinations above, with its path still the literal it was
 * written as — which `Destination` alone would widen back to `string`.
 */
export type ListedDestination = (typeof DESTINATIONS)[number]

/**
 * A group and the Destinations in it that this person is offered, or nothing.
 *
 * A group with no Destinations left is **absent from the answer entirely**
 * rather than present and empty: a plain Volunteer is offered General and no
 * Admin heading at all, because a heading with nothing under it is the
 * empty-tab failure ADR 0011 already names.
 */
export interface OfferedGroup {
  readonly group: NavigationGroup
  readonly name: string
  readonly destinations: readonly ListedDestination[]
}

/**
 * What to offer somebody holding `held`.
 *
 * Nothing here decides anything about authorization — it decides what to draw.
 * The server refuses on its own, and would refuse a request made by typing the
 * path whether or not this function ever ran.
 */
export function navigationFor(held: readonly DomainScope[]): readonly OfferedGroup[] {
  const holds = new Set(held)
  return NAVIGATION_GROUPS.flatMap((group) => {
    const destinations = DESTINATIONS.filter(
      (destination) =>
        destination.group === group &&
        (destination.scopes.length === 0 || destination.scopes.some((scope) => holds.has(scope))),
    )
    return destinations.length === 0 ? [] : [{ group, name: GROUP_NAMES[group], destinations }]
  })
}
