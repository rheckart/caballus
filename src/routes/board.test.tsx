/**
 * The Board at the UI seam: the real route component, the real typed client,
 * and only `fetch` stubbed (#32's testing decisions, #37).
 *
 * What is being claimed: the grid is faithful — stall order, the OPEN row, the
 * Small Barn's own section — that a blank renders as a blank, that nothing on
 * the screen acts, and that a failed poll leaves the last grid on the wall with
 * its age against it rather than blanking it.
 */
import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../test/api-stub'
import { renderRoutes } from '../test/route-harness'
import { BOARD_TOKEN_HEADER } from '../shared/board'
import { Board } from './board'
import { HorseProfile } from './horses/$horseId'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

function renderBoard() {
  return renderRoutes([{ path: '/board', component: Board }], '/board')
}

function horse(
  name: string,
  extra: Partial<{
    halterColour: string | null
    field: { id: string; name: string } | null
    feedings: unknown[]
  }> = {},
) {
  return {
    id: `${name.toLowerCase()}-1`,
    name,
    halterColour: 'halterColour' in extra ? extra.halterColour : 'green',
    field: extra.field ?? null,
    feedings: extra.feedings ?? [],
  }
}

/** A Reading, as the wire carries one — hours read, and what they resolved to. */
function reading(
  extra: Partial<{
    provider: string
    fellBackFrom: string | null
    stale: boolean
    hours: unknown[]
    conditions: unknown[]
  }> = {},
) {
  return {
    id: 'reading-1',
    day: '2026-08-18',
    provider: extra.provider ?? 'open_meteo',
    fellBackFrom: extra.fellBackFrom ?? null,
    fellBackBecause: extra.fellBackFrom === undefined ? null : 'the network said no',
    stale: extra.stale ?? false,
    fetchedAt: 1_768_366_800_000,
    hours: extra.hours ?? [
      {
        at: 1_768_366_800_000,
        day: '2026-08-18',
        hour: 6,
        airTempF: 38,
        apparentTempF: 33,
        precipitation: false,
      },
    ],
    conditions: extra.conditions ?? [],
  }
}

function resolution(
  condition: string,
  extra: Partial<{
    horseId: string | null
    holds: boolean | null
    unresolved: string | null
    thresholdValue: number | null
    readingValue: number | null
  }> = {},
) {
  return {
    condition,
    horseId: extra.horseId ?? null,
    horseName: null,
    scope: condition === 'staying_in' ? 'day' : 'shift',
    holds: 'holds' in extra ? extra.holds : true,
    unresolved: extra.unresolved ?? null,
    metric: condition === 'staying_in' ? 'apparent_temp' : 'air_temp',
    thresholdValue: 'thresholdValue' in extra ? extra.thresholdValue : 50,
    thresholdSource: 'override',
    readingValue: 'readingValue' in extra ? extra.readingValue : 38,
    atHour: 6,
  }
}

const GRID = {
  today: '2026-08-18',
  weather: null,
  announcements: [],
  sections: [
    {
      heading: 'Main barn',
      rows: [
        { stall: { id: 's1', name: '1' }, horse: horse('Dawson') },
        { stall: { id: 's7', name: '7' }, horse: null },
        { stall: { id: 's10', name: '10' }, horse: horse('Apollo') },
      ],
    },
    {
      heading: 'Small Barn',
      rows: [{ stall: null, horse: horse('Mystery') }],
    },
  ],
}

describe('the Board', () => {
  it('renders the grid in the order the server sent it, section by section', async () => {
    stubApi({ '/board': GRID })
    renderBoard()

    expect(await screen.findByText('Main barn')).toBeTruthy()
    expect(screen.getByText('Small Barn')).toBeTruthy()

    const rows = screen.getAllByRole('row')
    // Two header rows and four horse-or-stall rows; the order on screen is the
    // order on the wire, because the ordering is the server's decision.
    const stalls = rows.map((row) => row.textContent ?? '')
    expect(stalls.filter((text) => text.includes('Dawson')).length).toBe(1)
    expect(stalls.findIndex((text) => text.includes('Dawson'))).toBeLessThan(
      stalls.findIndex((text) => text.includes('Apollo')),
    )
  })

  it('keeps the row for the stall that stands OPEN', async () => {
    stubApi({ '/board': GRID })
    renderBoard()

    expect(await screen.findByText('OPEN')).toBeTruthy()
    // And the stall itself is still on its row: an empty stall is information.
    expect(screen.getByRole('rowheader', { name: '7' })).toBeTruthy()
  })

  it('renders a blank as a blank, in words', async () => {
    stubApi({
      '/board': {
        today: '2026-08-18',
        weather: null,
        announcements: [],
        sections: [
          {
            heading: 'Main barn',
            rows: [
              {
                stall: { id: 's1', name: '1' },
                horse: horse('Blue', { halterColour: null }),
              },
            ],
          },
        ],
      },
    })
    renderBoard()

    // A horse with no Lunch feeding says so; an empty cell would read as an
    // unanswered question.
    expect(await screen.findByText('no lunch feeding')).toBeTruthy()
    expect(screen.getByText('no feed am feeding')).toBeTruthy()
    expect(screen.getByText('no halter colour')).toBeTruthy()
    expect(screen.getByText('no field')).toBeTruthy()
    // Alerts is a column with nothing under it yet (#35).
    expect(screen.getByText('no alerts')).toBeTruthy()
  })

  it('paints a line from its Product kind and says when it is not in feed', async () => {
    stubApi({
      '/board': {
        today: '2026-08-18',
        weather: null,
        announcements: [],
        sections: [
          {
            heading: 'Main barn',
            rows: [
              {
                stall: { id: 's1', name: '1' },
                horse: horse('Dawson', {
                  feedings: [
                    {
                      shiftType: 'feed_am',
                      validFrom: '2026-08-10',
                      isNew: true,
                      lines: [
                        {
                          productId: 'senior',
                          productName: 'Senior',
                          productKind: 'feed',
                          amount: '1 scoop',
                          route: 'in_feed',
                        },
                        {
                          productId: 'prascend',
                          productName: 'Prascend',
                          productKind: 'medication',
                          amount: '1 tab',
                          route: 'oral_syringe',
                        },
                      ],
                    },
                  ],
                }),
              },
            ],
          },
        ],
      },
    })
    renderBoard()

    const medication = await screen.findByText(/Prascend/)
    // Semantic by construction: the cell carries the kind, and the colour is
    // the stylesheet's business rather than a pen somebody picked up.
    expect(medication.getAttribute('data-kind')).toBe('medication')
    expect(screen.getByText(/Senior/).getAttribute('data-kind')).toBe('feed')
    expect(medication.textContent).toContain('oral syringe')
    // The New marker, derived and ageing out on its own (`CONTEXT.md`'s New).
    expect(screen.getByText('New')).toBeTruthy()
  })

  it('has no action anywhere on it', async () => {
    stubApi({ '/board': GRID })
    renderBoard()

    await screen.findByText('Main barn')
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.queryAllByRole('textbox')).toEqual([])
  })

  it('shows unexpired Announcements, the whiteboard’s missing panel (#46)', async () => {
    stubApi({
      '/board': {
        ...GRID,
        announcements: [
          {
            id: 'a1',
            text: 'The hay comes Thursday.',
            expiresOn: '2026-08-25',
            authoredBy: 'v1',
            authoredByName: 'Lori',
            authoredAt: 1_768_366_800_000,
            lastEditedBy: null,
            lastEditedByName: null,
            lastEditedAt: null,
          },
        ],
      },
    })
    renderBoard()

    expect(await screen.findByText('The hay comes Thursday.')).toBeTruthy()
    // Read-only, like the rest of the Board (ADR 0022).
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('shows no Announcements section when there is nothing posted', async () => {
    stubApi({ '/board': GRID })
    renderBoard()

    await screen.findByText('Main barn')
    expect(screen.queryByLabelText('Announcements')).toBeNull()
  })

  it('drills down to a horse profile from a row, on a phone', async () => {
    stubApi({
      '/board': GRID,
      '/horses/dawson-1': {
        id: 'dawson-1',
        name: 'Dawson',
        halterColour: 'green',
        blanketSize: null,
        height: null,
        photoUrl: null,
        departedOn: null,
        spaces: { stall: null, field: null, barn: null },
        feedSchedules: [],
        measurements: { weights: [], bodyConditions: [] },
      },
    })
    renderRoutes(
      [
        { path: '/board', component: Board },
        { path: '/horses/$horseId', component: HorseProfile },
      ],
      '/board',
    )

    const link = await screen.findByRole('link', { name: 'Dawson' })
    link.click()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Dawson' })).toBeTruthy()
    })
  })

  it('sends the kiosk token it was enrolled with, and offers no drill-down on the tablet', async () => {
    // The tablet is enrolled once, by hand, at `/board?token=…` (ADR 0022).
    window.history.replaceState(null, '', '/board?token=the-tablet-token')
    stubApi({ '/board': GRID })
    renderBoard()

    await screen.findByText('Main barn')
    // The tablet's token authorizes this read and nothing else, so a link
    // would lead to a refusal (ADR 0022).
    expect(screen.queryByRole('link', { name: 'Dawson' })).toBeNull()
    expect(screen.getByText('Dawson')).toBeTruthy()

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? []
    const headers = (init as RequestInit | undefined)?.headers as Record<string, string> | undefined
    expect(headers?.[BOARD_TOKEN_HEADER]).toBe('the-tablet-token')
  })

  it('puts what the weather resolved to on the wall, in words', async () => {
    stubApi({
      '/board': {
        ...GRID,
        weather: reading({
          conditions: [
            resolution('staying_in'),
            resolution('sheet_weather', { horseId: 'dawson-1' }),
          ],
        }),
      },
    })
    renderBoard()

    // The sentence the panel exists for: *staying in* changes the hay plan and
    // the turnout, and it is read across a barn (ADR 0015).
    expect(await screen.findByText('Staying in')).toBeTruthy()
    // And the provider is named, because the rescue has no single
    // authoritative source today.
    expect(screen.getByText(/Open-Meteo read it/)).toBeTruthy()
    // The horse's garment cites the number that decided it, so a tag on the
    // wall explains itself.
    expect(screen.getByText(/38°, under 50°/)).toBeTruthy()
  })

  it('says a Condition could not be answered rather than showing it as a no', async () => {
    stubApi({
      '/board': {
        ...GRID,
        weather: reading({
          provider: 'nws',
          fellBackFrom: 'open_meteo',
          conditions: [
            resolution('staying_in', {
              holds: null,
              unresolved: 'no_metric',
              readingValue: null,
              thresholdValue: 85,
            }),
          ],
        }),
      },
    })
    renderBoard()

    expect(await screen.findByText(/could not be answered/)).toBeTruthy()
    expect(screen.getByText(/Open-Meteo did not answer/)).toBeTruthy()
  })

  it('says nothing has read the weather yet rather than showing a calm day', async () => {
    stubApi({ '/board': GRID })
    renderBoard()

    expect(await screen.findByText('no weather read for today yet')).toBeTruthy()
  })

  it('reads today’s hours only, though a Reading carries tomorrow’s as well', async () => {
    stubApi({
      '/board': {
        ...GRID,
        weather: reading({
          hours: [
            {
              at: 1_768_366_800_000,
              day: '2026-08-18',
              hour: 6,
              airTempF: 58,
              apparentTempF: 56,
              precipitation: false,
            },
            {
              // Tomorrow's, stored because a night window runs past midnight.
              at: 1_768_453_200_000,
              day: '2026-08-19',
              hour: 6,
              airTempF: 99,
              apparentTempF: 104,
              precipitation: false,
            },
          ],
        }),
      },
    })
    renderBoard()

    expect(await screen.findByText(/58–58 °F/)).toBeTruthy()
    // Tomorrow's 99 is on the Reading and must not be on a panel headed today.
    expect(screen.queryByText(/99/)).toBeNull()
  })

  it('says a horse’s garment is not known rather than showing an empty row', async () => {
    stubApi({
      '/board': {
        ...GRID,
        weather: reading({
          conditions: [
            resolution('sheet_weather', {
              horseId: 'dawson-1',
              holds: null,
              unresolved: 'no_threshold',
              readingValue: null,
              thresholdValue: null,
            }),
          ],
        }),
      },
    })
    renderBoard()

    // The row says the question is open…
    expect(await screen.findByText('sheet or blanket not known')).toBeTruthy()
    // …and the panel says why, once, however many horses it covers.
    expect(screen.getByText(/Sheet could not be answered for 1 horse:/)).toBeTruthy()
  })

  it('says how fresh it is', async () => {
    stubApi({ '/board': GRID })
    renderBoard()

    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Updated just now.')
  })

  it('shows a refusal rather than a blank screen when the first read fails', async () => {
    stubApi({})
    renderBoard()

    // `stubApi` answers an unstubbed path with `404 not_found`, which is what
    // the Board would see if the endpoint went away under it.
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('keeps the last grid on the wall when a poll fails, and says it is stale', async () => {
    vi.useFakeTimers()
    let answers = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        answers += 1
        if (answers > 1) return Promise.reject(new Error('the network went away'))
        return Promise.resolve(
          new Response(JSON.stringify(GRID), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }),
    )

    renderBoard()
    await vi.waitFor(() => {
      expect(screen.getByText('Main barn')).toBeTruthy()
    })

    await vi.advanceTimersByTimeAsync(46_000)

    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Not updating')
    })
    // The grid is still there — a screen that empties itself because one
    // request failed is worse than one that is a minute old and says so.
    expect(screen.getByText('Main barn')).toBeTruthy()
  })
})
