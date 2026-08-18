/**
 * The two doors the #34 gates stand at, and the one gate a Cover passes
 * (ADR 0011, ADR 0017).
 *
 * **Assignment is gated on full rosterability** — an Orientation, a current
 * Release, and for a minor a Consent — at both doors ADR 0011 names: adding
 * somebody to a Shift Pattern's Standing Roster, and adding them to a single
 * dated Shift. It gates the Volunteer Coordinator exactly as it gates a
 * self-Cover, and there is no override.
 *
 * **A Cover is gated on an Orientation and an Account, and on nothing else.**
 * That asymmetry is deliberate and it is ADR 0011's: the app *never* refuses a
 * Cover for what the volunteer lacks — a Shift needing medication still takes
 * somebody who cannot give it — because turning away somebody who is offering
 * to come is the worst thing this surface could do. The gaps a Cover carries in
 * with them are shown on the Shift, which is the flag ADR 0017 asks for rather
 * than the removal it forbids.
 *
 * **Gating happens at assignment, never at generation.** An assignment that
 * silently evaporated a fortnight later would be precisely the quiet wrongness
 * ADR 0001 wrote its apply-to-upcoming prompt against, so generation copies the
 * Standing Roster whole and a volunteer who has since gone stale arrives on the
 * Shift flagged rather than absent.
 */
import type { OrgScopedDatabase } from '../../db/for-org'
import type { DayString } from '../../shared/time'
import { peopleList, type Person } from '../roster/people'

/** Everybody still at the rescue, with their gates derived against `on`. */
export async function gatesOf(
  db: OrgScopedDatabase,
  on: DayString,
): Promise<ReadonlyMap<string, Person>> {
  // `peopleList` rather than a one-volunteer query of this module's own: it is
  // the module that decides what rosterable means against seven joins, and a
  // second implementation for the single-person case is a second answer to the
  // question `src/shared/rostering.ts` exists to have one answer to. Sixty rows
  // is not a cost worth a divergence.
  const people = await peopleList(db, on, false)
  return new Map(people.map((person) => [person.id, person]))
}

/** Whether this Volunteer may be assigned on `on`, and who they are. */
export function assignable(
  people: ReadonlyMap<string, Person>,
  volunteerId: string,
):
  | { readonly ok: true; readonly person: Person }
  | { readonly ok: false; readonly because: 'volunteer_not_found' | 'not_rosterable' } {
  const person = people.get(volunteerId)
  if (person === undefined) return { ok: false, because: 'volunteer_not_found' }
  if (!person.rosterable) return { ok: false, because: 'not_rosterable' }
  return { ok: true, person }
}

/**
 * Whether this Volunteer may Cover: an Orientation and an Account, and nothing
 * else (ADR 0011).
 */
export function mayCover(
  people: ReadonlyMap<string, Person>,
  volunteerId: string,
):
  | { readonly ok: true; readonly person: Person }
  | { readonly ok: false; readonly because: 'volunteer_not_found' | 'no_orientation' } {
  const person = people.get(volunteerId)
  if (person === undefined) return { ok: false, because: 'volunteer_not_found' }
  // `state` is `volunteer` from the Orientation onwards and `candidate` before
  // it, which is the same fact the gap list carries and the word the barn uses.
  if (person.gaps.includes('no_orientation')) return { ok: false, because: 'no_orientation' }
  return { ok: true, person }
}
