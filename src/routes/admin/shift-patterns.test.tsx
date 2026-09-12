/**
 * The Shifts desk at the UI seam, and specifically the run: *set up the week*
 * (#69).
 *
 * What is claimed here is the promise the composer makes — **the days ticked
 * are the days sent, in one request**. Twenty-one Patterns spelled as three
 * submits is only an improvement if a submit is genuinely one act, so the
 * request count is the assertion and not an incidental detail.
 *
 * The other half is what comes back: a weekday already holding a live Pattern
 * of that Shift Type is **named**, not counted. *2 skipped* leaves a
 * Coordinator counting ticks to work out which two, and the whole reason to
 * skip rather than refuse is that they already have those days.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { answeredNothing, stubApi } from '../../test/api-stub'
import { renderRoute } from '../../test/route-harness'
import { Route } from './shift-patterns'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

/** The three reads the screen opens with, all empty unless a test says otherwise. */
function emptyDesk() {
  return {
    '/shift-patterns': { today: '2026-08-25', patterns: [] },
    '/shifts': { today: '2026-08-25', shifts: [] },
    '/volunteers': { today: '2026-08-25', people: [], unstaffedScopes: [] },
  }
}

function renderPatterns() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoute('/admin/shift-patterns', component)
}

describe('adding a week of Patterns', () => {
  it('sends every day ticked, in one request', async () => {
    const posted: unknown[] = []
    stubApi({
      ...emptyDesk(),
      '/shift-patterns/batch': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)) as unknown)
        return { shiftPatternIds: ['a', 'b', 'c'], skipped: [] }
      },
    })
    renderPatterns()

    fireEvent.click(await screen.findByLabelText('Monday'))
    fireEvent.click(screen.getByLabelText('Wednesday'))
    fireEvent.click(screen.getByLabelText('Friday'))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(posted.length).toBe(1)
    })
    // In WEEKDAYS order rather than tick order: the request and anything
    // reading it back run Monday first regardless of which box was hit first.
    expect(posted[0]).toMatchObject({
      shiftType: 'feed_am',
      weekdays: ['monday', 'wednesday', 'friday'],
      startTime: '06:30',
      targetHeadcount: 3,
    })
  })

  it('carries the generic start time and headcount of the Shift Type picked', async () => {
    const posted: unknown[] = []
    stubApi({
      ...emptyDesk(),
      '/shift-patterns/batch': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)) as unknown)
        return { shiftPatternIds: ['a'], skipped: [] }
      },
    })
    renderPatterns()

    fireEvent.click(await screen.findByLabelText('Tuesday'))
    fireEvent.click(screen.getByRole('radio', { name: 'Lunch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(posted.length).toBe(1)
    })
    // Presentation and never a rule — but a screen that made somebody retype
    // 12:00 and 1 on every pass is the twenty-one-form problem with three
    // forms instead, so this is the thing that makes the composer worth having.
    expect(posted[0]).toMatchObject({ shiftType: 'lunch', startTime: '12:00', targetHeadcount: 1 })
  })

  it('takes a time typed over the generic one', async () => {
    const posted: unknown[] = []
    stubApi({
      ...emptyDesk(),
      '/shift-patterns/batch': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)) as unknown)
        return { shiftPatternIds: ['a'], skipped: [] }
      },
    })
    renderPatterns()

    fireEvent.click(await screen.findByLabelText('Saturday'))
    // The Pop-up composer above has a *Starts* of its own, so this names the
    // one under test rather than trusting there to be only one on the screen.
    fireEvent.change(screen.getByLabelText('Starts', { selector: '#add-start' }), {
      target: { value: '08:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(posted.length).toBe(1)
    })
    expect(posted[0]).toMatchObject({ weekdays: ['saturday'], startTime: '08:00' })
  })

  it('names the days it left alone rather than counting them', async () => {
    stubApi({
      ...emptyDesk(),
      '/shift-patterns/batch': { shiftPatternIds: ['a'], skipped: ['monday', 'tuesday'] },
    })
    renderPatterns()

    fireEvent.click(await screen.findByLabelText('Monday'))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    const said = await screen.findByRole('status')
    expect(said.textContent).toContain('Added 1 Pattern.')
    expect(said.textContent).toContain('Monday and Tuesday already have a Feed AM Pattern.')
  })

  it('will not send with no day ticked', async () => {
    stubApi(emptyDesk())
    renderPatterns()

    // Disabled rather than refused: an empty `weekdays` is turned away by the
    // contract, which is a refusal nobody standing at the desk can read.
    const add = await screen.findByRole('button', { name: 'Add' })
    expect(add.hasAttribute('disabled')).toBe(true)
  })
})

describe('changing just Thursday from the fortnight (#70)', () => {
  /** One generated Shift, with nothing on it and nothing missing said. */
  function thursday() {
    return {
      id: 'thursday',
      patternId: 'thursday-am',
      day: '2026-08-27',
      shiftType: 'feed_am',
      startTime: '06:30',
      targetHeadcount: 3,
      staffingMode: 'standing_roster',
      purpose: null,
      state: 'scheduled',
      roster: [],
      staffing: { gaps: [], suggestedActingLead: null },
      short: null,
      attendance: [],
    }
  }

  it('sends that one Shift, not its Pattern, in one request', async () => {
    const posted: unknown[] = []
    stubApi({
      ...emptyDesk(),
      '/shifts': { today: '2026-08-25', shifts: [thursday()] },
      '/shifts/edit': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)) as unknown)
        return answeredNothing()
      },
    })
    renderPatterns()

    fireEvent.change(await screen.findByLabelText('Starts, Feed AM on 2026-08-27'), {
      target: { value: '07:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Change this Shift' }))

    await waitFor(() => {
      expect(posted.length).toBe(1)
    })
    expect(posted[0]).toMatchObject({ shiftId: 'thursday', startTime: '07:00', targetHeadcount: 3 })
  })
})
