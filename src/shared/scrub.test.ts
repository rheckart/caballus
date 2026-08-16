import { describe, expect, it } from 'vitest'

import { REDACTED, scrub } from './scrub'

describe('scrub', () => {
  it('removes a volunteer name, wherever it was put', () => {
    const scrubbed = scrub({
      user: { id: 'v_01J8', username: 'Cathy Hollandsworth', email: 'cathy@example.org' },
      extra: { volunteerName: 'Cathy Hollandsworth', supervisingAdultName: 'Dana Reyes' },
      tags: { shiftId: 'sh_2026_08_15_am' },
    })

    expect(JSON.stringify(scrubbed)).not.toContain('Cathy')
    expect(JSON.stringify(scrubbed)).not.toContain('Dana')
    expect(scrubbed.user).toEqual({ id: 'v_01J8' })
    expect(scrubbed.extra).toEqual({ volunteerName: REDACTED, supervisingAdultName: REDACTED })
    expect(scrubbed.tags).toEqual({ shiftId: 'sh_2026_08_15_am' })
  })

  it.each([
    '(410) 555-0134',
    '410-555-0134',
    '410.555.0134',
    '+1 410 555 0134',
    '4105550134',
  ])('removes a mobile number written as %s', (mobile) => {
    const scrubbed = scrub({
      message: `could not text ${mobile} about the 6am shift`,
      extra: { mobile },
    })

    expect(scrubbed.message).toBe(`could not text ${REDACTED} about the 6am shift`)
    expect(scrubbed.extra).toEqual({ mobile: REDACTED })
  })

  it('removes an email address in free text', () => {
    const scrubbed = scrub({ message: 'code to cathy@example.org bounced' })
    expect(scrubbed.message).toBe(`code to ${REDACTED} bounced`)
  })

  it('leaves the things an on-call maintainer actually needs', () => {
    const scrubbed = scrub({
      message: 'idempotency key 019267c0-6f7e-7a3d-9c2f-2f9a1c7e5b10 replayed',
      extra: { route: 'POST /api/v1/shifts/:id/items', orgId: 'org_fhhr', status: 409 },
    })

    expect(scrubbed.message).toContain('019267c0-6f7e-7a3d-9c2f-2f9a1c7e5b10')
    expect(scrubbed.extra).toEqual({
      route: 'POST /api/v1/shifts/:id/items',
      orgId: 'org_fhhr',
      status: 409,
    })
  })

  it('drops credentials off a request', () => {
    const scrubbed = scrub({
      request: {
        url: 'https://caballus.example.org/api/v1/shifts',
        headers: { cookie: 'session=abc', authorization: 'Bearer abc', 'user-agent': 'iPhone' },
      },
    })

    expect(scrubbed.request).toEqual({
      url: 'https://caballus.example.org/api/v1/shifts',
      headers: { cookie: REDACTED, authorization: REDACTED, 'user-agent': 'iPhone' },
    })
  })

  it('survives a cycle rather than throwing inside the error path', () => {
    const event: Record<string, unknown> = { message: 'boom' }
    event.self = event

    expect(() => scrub(event)).not.toThrow()
  })
})
