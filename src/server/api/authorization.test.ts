import { describe, expect, it } from 'vitest'

import type { Actor } from '../request-context'
import {
  DOMAIN_SCOPES,
  ROLES,
  anyDomainScope,
  anyScopeHolder,
  authorize,
  board,
  domainScope,
  floor,
  isRole,
  readEverything,
  scopesOf,
  shiftAuthority,
  type Principal,
} from './authorization'

/** Somebody signed in, holding exactly the scopes named. */
function person(...domainScopes: readonly string[]): Principal {
  return {
    actor: {
      volunteerId: '00000000-0000-0000-0000-00000000000a',
      domainScopes: domainScopes as Actor['domainScopes'],
    },
    kiosk: false,
  }
}

/** Nobody at all: no session, and not the barn's tablet either (ADR 0022). */
const NOBODY: Principal = { actor: null, kiosk: false }

/** The tablet on the feed room wall, which is not a person (ADR 0022). */
const TABLET: Principal = { actor: null, kiosk: true }

describe('a role confers Domain Scopes, and the mapping is a constant', () => {
  it('gives the President and Board Member all seven, enumerated', () => {
    // ADR 0010 rejects a wildcard that short-circuits every check: it is a
    // second code path through authorization and reliably the one nobody
    // tests. Enumeration is also what makes adding `medical` a decision.
    expect(scopesOf(['president'])).toEqual([...DOMAIN_SCOPES])
    expect(scopesOf(['board_member'])).toEqual([...DOMAIN_SCOPES])
  })

  it('gives each head exactly its own domain', () => {
    expect(scopesOf(['head_of_horse_welfare'])).toEqual(['horse_care'])
    expect(scopesOf(['head_of_maintenance'])).toEqual(['maintenance'])
    expect(scopesOf(['volunteer_coordinator'])).toEqual(['roster'])
    expect(scopesOf(['treasurer'])).toEqual(['financial'])
    expect(scopesOf(['event_coordinator'])).toEqual(['events'])
  })

  it('gives nothing at all to a Volunteer holding no role', () => {
    // The floor is reading everything and the two writes ADR 0010 names. A
    // role granting the floor would be a role that means nothing, which is why
    // Feed Shift Volunteer is not one.
    expect(scopesOf([])).toEqual([])
  })

  it('unions the scopes of somebody holding two roles, without repeating one', () => {
    expect(scopesOf(['head_of_horse_welfare', 'head_of_maintenance'])).toEqual([
      'horse_care',
      'maintenance',
    ])
    expect(scopesOf(['president', 'head_of_horse_welfare'])).toEqual([...DOMAIN_SCOPES])
  })

  it('ignores a stored role this build does not know', () => {
    // The table is text and a deploy can be older than a row. An unknown role
    // conferring nothing is the direction that fails closed.
    expect(scopesOf(['feed_shift_lead'])).toEqual([])
    expect(isRole('feed_shift_lead')).toBe(false)
    expect(isRole('president')).toBe(true)
  })

  it('leaves no scope without a role that can reach it, except supplies', () => {
    // ADR 0010: `supplies` has no dedicated role and is the President's until
    // the rescue names the position. Every other scope has a holder, and this
    // is the assertion that says so out loud rather than by inspection.
    const reachable = new Set(ROLES.flatMap((role) => scopesOf([role])))
    expect([...DOMAIN_SCOPES].filter((scope) => !reachable.has(scope))).toEqual([])
  })
})

describe('a read is for a Volunteer, not for anybody who asks', () => {
  it('lets a signed-in Volunteer read everything', () => {
    expect(authorize(readEverything(), person())).toEqual({ outcome: 'allowed' })
  })

  it('refuses a signed-out request explicitly rather than with an empty answer', () => {
    // ADR 0010: a silent empty response is indistinguishable from success to a
    // retry queue, and the floor is *every Volunteer*, which is a person the
    // organisation knows — not the internet.
    expect(authorize(readEverything(), NOBODY)).toEqual({
      outcome: 'refused',
      status: 401,
      wanted: 'read',
    })
  })
})

describe('a scope', () => {
  it('allows the holder', () => {
    expect(authorize(domainScope('roster'), person('roster'))).toEqual({ outcome: 'allowed' })
  })

  it('refuses a signed-in Volunteer who does not hold it, and names it', () => {
    expect(authorize(domainScope('roster'), person('horse_care'))).toEqual({
      outcome: 'refused',
      status: 403,
      wanted: 'roster',
    })
  })

  it('refuses nobody with a 401, because there is nobody to have the scope', () => {
    expect(authorize(domainScope('roster'), NOBODY)).toEqual({
      outcome: 'refused',
      status: 401,
      wanted: 'roster',
    })
  })
})

describe('any-scope, for a record two Scopes may edit', () => {
  it('allows a holder of either named scope', () => {
    expect(authorize(anyDomainScope(['horse_care', 'supplies']), person('supplies'))).toEqual({
      outcome: 'allowed',
    })
    expect(authorize(anyDomainScope(['horse_care', 'supplies']), person('horse_care'))).toEqual({
      outcome: 'allowed',
    })
  })

  it('refuses a Volunteer holding neither, naming both', () => {
    expect(authorize(anyDomainScope(['horse_care', 'supplies']), person('roster'))).toEqual({
      outcome: 'refused',
      status: 403,
      wanted: 'horse_care or supplies',
    })
  })

  it('refuses nobody with a 401', () => {
    expect(authorize(anyDomainScope(['horse_care', 'supplies']), NOBODY)).toEqual({
      outcome: 'refused',
      status: 401,
      wanted: 'horse_care or supplies',
    })
  })
})

describe('holds-any-scope, for posting an Announcement (ADR 0018)', () => {
  it('allows a holder of any single scope, unnamed', () => {
    expect(authorize(anyScopeHolder(), person('financial'))).toEqual({ outcome: 'allowed' })
    expect(authorize(anyScopeHolder(), person('roster'))).toEqual({ outcome: 'allowed' })
  })

  it('refuses a signed-in Volunteer holding none, distinct from `read-everything`', () => {
    expect(authorize(anyScopeHolder(), person())).toEqual({
      outcome: 'refused',
      status: 403,
      wanted: 'any domain scope',
    })
  })

  it('refuses nobody with a 401', () => {
    expect(authorize(anyScopeHolder(), NOBODY)).toEqual({
      outcome: 'refused',
      status: 401,
      wanted: 'any domain scope',
    })
  })
})

describe('the Board, which is a tablet and not a person (ADR 0022)', () => {
  it('lets the barn tablet read it, crediting nobody', () => {
    expect(authorize(board(), TABLET)).toEqual({ outcome: 'allowed' })
    // The tablet resolved to no actor, and that is the point: there is nobody
    // for anything downstream to credit.
    expect(TABLET.actor).toBe(null)
  })

  it('lets a signed-in Volunteer read it too, on their own phone', () => {
    expect(authorize(board(), person())).toEqual({ outcome: 'allowed' })
  })

  it('refuses somebody who is neither, rather than making the grid a public URL', () => {
    expect(authorize(board(), NOBODY)).toEqual({ outcome: 'refused', status: 401, wanted: 'read' })
  })

  it('does not let the tablet past anything else', () => {
    // The token authorizes one read. Everything the Board's rows link to is
    // behind the ordinary floor, so a kiosk cannot drill down (ADR 0022).
    expect(authorize(readEverything(), TABLET)).toMatchObject({ outcome: 'refused', status: 401 })
    expect(authorize(domainScope('horse_care'), TABLET)).toMatchObject({
      outcome: 'refused',
      status: 401,
    })
    expect(authorize(floor('record-a-measurement'), TABLET)).toMatchObject({
      outcome: 'refused',
      status: 401,
    })
  })
})

describe('the floor and shift authority', () => {
  it('needs an actor, because an unattributed tick is the paper system’s lie', () => {
    expect(authorize(floor('record-an-observation'), NOBODY)).toMatchObject({
      outcome: 'refused',
      status: 401,
    })
    expect(authorize(floor('record-an-observation'), person())).toEqual({ outcome: 'allowed' })
  })

  it('refuses a signed-out request outright, and leaves the rest to the Shift', () => {
    expect(authorize(shiftAuthority(), NOBODY)).toMatchObject({
      outcome: 'refused',
      status: 401,
      wanted: 'shift authority',
    })
  })

  it('names no Domain Scope by default, so no later write inherits a Coordinator', () => {
    // ADR 0010 gives the authority set to the *position*, and names officers as
    // a fallback only for a Shift with no Lead. A `roster` door built into the
    // check itself would hand a Volunteer Coordinator every Shift-Authority
    // write there will ever be — closing the Shift included.
    expect(authorize(shiftAuthority(), person('roster'))).toMatchObject({
      outcome: 'over-the-shift-it-names',
    })
  })

  it('lets a scope the endpoint named through without touching the roster', () => {
    // ADR 0011's own list for the Short declaration: "whoever holds Shift
    // Authority, `roster`, or an officer's scopes" — officers need no mention,
    // because they hold every scope through the enumeration.
    expect(authorize(shiftAuthority(['roster']), person('roster'))).toEqual({
      outcome: 'allowed',
    })
    expect(authorize(shiftAuthority(['roster']), person('horse_care'))).toMatchObject({
      outcome: 'over-the-shift-it-names',
    })
  })

  it('names both doors in the denial, because a refusal says what it wanted', () => {
    expect(authorize(shiftAuthority(['roster']), NOBODY)).toMatchObject({
      outcome: 'refused',
      status: 401,
      wanted: 'shift authority or roster',
    })
  })

  it('settles only being signed in; the position is a join `mutation` runs', () => {
    // ADR 0010: "the Shift axis is a join, not a session variable". Holding
    // `horse_care` — or any scope — decides nothing here, which is why the
    // answer is neither true nor false. `ReadAuthorization` is what stops a
    // read reaching a handler on this alone.
    expect(authorize(shiftAuthority(), person('horse_care'))).toMatchObject({
      outcome: 'over-the-shift-it-names',
    })
  })
})
