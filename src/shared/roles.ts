/**
 * The Roles, and the Domain Scopes each one confers — the constant ADR 0010
 * insists is a constant.
 *
 * It lives here for the reason `DOMAIN_SCOPES` does: the desktop admin screen
 * grants Roles and shows what they carry, so the vocabulary crosses the wire
 * and a second copy of it in the contract is the drift the contract exists to
 * remove (ADR 0021). **The checks stay on the server** — `authorize` is in
 * `src/server/api/authorization.ts` and nothing here decides anything.
 *
 * **Never a table.** Nobody at this rescue will ever redefine what Head of
 * Maintenance means, and the price of letting them would be a permissions
 * screen, its own audit problem, and a system whose behaviour cannot be read
 * off the source. If a permissions screen is ever genuinely requested, this
 * shape is the wrong one and a `role_scope` table becomes right — that is ADR
 * 0010's own tripwire, recorded where somebody would look.
 */
import { DOMAIN_SCOPES, type DomainScope } from './domain-scopes'

/**
 * Three Roles the brief lists are deliberately absent. Feed Shift Lead and
 * Co-Lead dissolve into roster positions — being Lead of *this* Shift is not
 * something anyone holds between Shifts — and Feed Shift Volunteer *is* the
 * floor, so a Role granting it would mean nothing. Keeping any of the three
 * would be worse than absent: they would look like the thing that authorizes,
 * and something would eventually check them instead of checking the roster.
 */
export const ROLE_SCOPES = {
  // Enumerated rather than a wildcard. ADR 0010 rejects a short-circuit as a
  // second code path through authorization, reliably the one nobody tests —
  // and enumeration buys deliberateness: when `medical` arrives, somebody has
  // to decide whether the President reads diagnoses.
  president: DOMAIN_SCOPES,
  board_member: DOMAIN_SCOPES,
  head_of_horse_welfare: ['horse_care'],
  head_of_maintenance: ['maintenance'],
  volunteer_coordinator: ['roster'],
  treasurer: ['financial'],
  event_coordinator: ['events'],
} as const satisfies Readonly<Record<string, readonly DomainScope[]>>

export type Role = keyof typeof ROLE_SCOPES

/**
 * The names, as a non-empty tuple — which is what `z.enum` needs to make the
 * contract's role field one declaration rather than a second hand-written list
 * (ADR 0021).
 *
 * Written out rather than `Object.keys(...) as ...`, because a cast is a
 * promise nothing checks and that one would go on compiling after somebody
 * added a Role above and forgot it here. `satisfies` catches a name that is not
 * a Role; `everyRoleIsListed` below catches a Role that is not a name. Both
 * directions, at compile time, which is where ADR 0016 wants an invariant that
 * a type can carry.
 */
export const ROLES = [
  'president',
  'board_member',
  'head_of_horse_welfare',
  'head_of_maintenance',
  'volunteer_coordinator',
  'treasurer',
  'event_coordinator',
] as const satisfies readonly [Role, ...Role[]]

/**
 * Every Role is in `ROLES`. Nothing at runtime: adding a member to
 * `ROLE_SCOPES` without adding its name above makes this line fail to compile,
 * which is where the mistake is cheapest to find.
 */
const everyRoleIsListed: Role extends (typeof ROLES)[number] ? true : never = true
void everyRoleIsListed

/**
 * The barn's own words, which is the whole reason Roles are stored rows rather
 * than scopes with a label. *Head of Horse Welfare* is what people say, and it
 * has to be a stored fact for routing, for the people list, and for every
 * conversation about the app.
 *
 * `supplies` has **no Role here**. It is the President's today, held through
 * the enumeration above, and until the rescue names the position `CONTEXT.md`'s
 * rule that the barn's words win means we do not get to invent one.
 */
export const ROLE_NAMES: Readonly<Record<Role, string>> = {
  president: 'President',
  board_member: 'Board Member',
  head_of_horse_welfare: 'Head of Horse Welfare',
  head_of_maintenance: 'Head of Maintenance',
  volunteer_coordinator: 'Volunteer Coordinator',
  treasurer: 'Treasurer',
  event_coordinator: 'Event Coordinator',
}

/**
 * Whether a stored string is a Role this build knows.
 *
 * The column is text and a deploy can be older than a row, so the question is
 * real.
 */
export function isRole(stored: string): stored is Role {
  return Object.hasOwn(ROLE_SCOPES, stored)
}

/**
 * The Domain Scopes a set of Roles confers, in `DOMAIN_SCOPES` order and
 * without repeats.
 *
 * A Role this build does not know confers nothing, which is the direction that
 * fails closed — the alternative is a row nobody can read granting something
 * nobody decided.
 */
export function scopesOf(roles: readonly string[]): readonly DomainScope[] {
  const held = new Set<DomainScope>()
  for (const role of roles) {
    if (!isRole(role)) continue
    for (const scope of ROLE_SCOPES[role]) held.add(scope)
  }
  return DOMAIN_SCOPES.filter((scope) => held.has(scope))
}
