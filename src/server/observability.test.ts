import { afterEach, describe, expect, it, vi } from 'vitest'

import { REDACTED } from '../shared/scrub'
import { beforeSend, log } from './observability'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('beforeSend', () => {
  it('takes a volunteer name and a mobile number out of an error event', () => {
    const event = {
      message: 'texting the shift lead on (410) 555-0134 failed',
      user: { id: 'v_01J8', username: 'Cathy Hollandsworth', ip_address: '10.0.0.4' },
      extra: { volunteerName: 'Cathy Hollandsworth', mobile: '(410) 555-0134', shiftId: 'sh_01J8' },
    }

    const sent = beforeSend(event)
    const wire = JSON.stringify(sent)

    expect(wire).not.toContain('Cathy')
    expect(wire).not.toContain('555-0134')
    expect(wire).not.toContain('10.0.0.4')
    expect(sent.user).toEqual({ id: 'v_01J8' })
    expect(sent.extra).toEqual({ volunteerName: REDACTED, mobile: REDACTED, shiftId: 'sh_01J8' })
    expect(sent.message).toBe(`texting the shift lead on ${REDACTED} failed`)
  })

  it('leaves a stack trace readable, because a redacted frame protects nobody', () => {
    const sent = beforeSend({
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'cannot read properties of undefined',
            stacktrace: {
              frames: [
                {
                  filename: 'app:///src/server/api/route.ts',
                  abs_path: '/app/src/server/api/route.ts',
                  function: 'mutation',
                  module: 'server.api.route',
                  lineno: 128,
                },
              ],
            },
          },
        ],
      },
    })

    // `filename` matches the same substring as `volunteerName`, and blanking
    // it would lose the frame while `abs_path` beside it kept the string.
    expect(sent.exception.values[0]?.stacktrace.frames[0]).toEqual({
      filename: 'app:///src/server/api/route.ts',
      abs_path: '/app/src/server/api/route.ts',
      function: 'mutation',
      module: 'server.api.route',
      lineno: 128,
    })
  })

  // The limit, recorded rather than assumed. ADR 0016 is explicit that the
  // lint rule guarantees only that reports pass through here, and this is the
  // half the wrapper cannot guarantee either: a number has a shape and a name
  // does not. What follows from it is a rule for callers — a report never
  // interpolates a volunteer into its message — and the day that stops being
  // enough, this test is where the decision to do something stronger lands.
  it('cannot find a name written into free text, which is why reports must not put one there', () => {
    const sent = beforeSend({ message: 'Cathy Hollandsworth could not sign in' })
    expect(sent.message).toContain('Cathy')
  })
})

describe('log', () => {
  it('writes one scrubbed JSON line to stdout', () => {
    const written: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))
      return true
    })

    log('info', 'mutation', {
      route: 'POST /shifts/:id/items',
      idempotencyKey: '019267c0-6f7e-7a3d-9c2f-2f9a1c7e5b10',
      actorName: 'Cathy Hollandsworth',
    })

    expect(written).toHaveLength(1)
    expect(written[0]?.endsWith('\n')).toBe(true)
    expect(JSON.parse(written[0] ?? '')).toEqual({
      level: 'info',
      event: 'mutation',
      route: 'POST /shifts/:id/items',
      idempotencyKey: '019267c0-6f7e-7a3d-9c2f-2f9a1c7e5b10',
      actorName: REDACTED,
    })
  })
})
