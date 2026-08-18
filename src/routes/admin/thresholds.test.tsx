/**
 * The Thresholds screen at the UI seam: the real route component, the real
 * typed client, and only `fetch` stubbed (#32's testing decisions, #38).
 *
 * One claim, and it is the ticket's: **the three-valued state is visible, and
 * "not yet decided" reads as an unanswered question** rather than as agreement
 * with the rescue's number (ADR 0015).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../../test/api-stub'
import { renderRoutes } from '../../test/route-harness'
import { Route } from './thresholds'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderThresholds() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoutes([{ path: '/admin/thresholds', component }], '/admin/thresholds')
}

function record(kind: string, extra: Record<string, unknown> = {}) {
  return {
    kind,
    stance: 'overridden',
    value: 40,
    metric: kind === 'staying_in' || kind === 'fly_sheet_max' ? 'apparent_temp' : 'air_temp',
    provider: 'open_meteo',
    validFrom: '2026-08-01',
    isNew: false,
    ...extra,
  }
}

const PANEL = {
  today: '2026-08-18',
  defaults: [record('sheet', { value: 40 }), record('blanket', { value: 30 })],
  horses: [
    {
      horseId: 'dawson',
      horseName: 'Dawson',
      records: [record('sheet', { value: 50 })],
      undecided: ['blanket'],
    },
    {
      horseId: 'blue',
      horseName: 'Blue',
      records: [record('sheet', { stance: 'follows_default', value: null })],
      undecided: ['blanket'],
    },
    { horseId: 'mystery', horseName: 'Mystery', records: [], undecided: ['sheet', 'blanket'] },
  ],
}

/**
 * Stubs the endpoint and keeps what was posted to it. One path answers both
 * directions, which is what the real one does.
 */
function watchPosts(): unknown[] {
  const posted: unknown[] = []
  stubApi({
    '/thresholds': (init: RequestInit) => {
      if (init.method !== 'POST') return PANEL
      posted.push(JSON.parse(String(init.body)) as unknown)
      return { thresholdVersionId: 'published' }
    },
  })
  return posted
}

describe('the Thresholds screen', () => {
  it('tells the three states apart, in words', async () => {
    stubApi({ '/thresholds': PANEL })
    renderThresholds()

    expect(await screen.findByText('Dawson')).toBeTruthy()
    // Its own number, the rescue's on purpose, and nobody's decision — three
    // states, three sentences.
    expect(screen.getByText('50°F')).toBeTruthy()
    expect(screen.getAllByText(/the rescue’s number, deliberately/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('not yet decided').length).toBeGreaterThan(0)
  })

  it('says who owes a decision, and that the rescue’s number is being used meanwhile', async () => {
    stubApi({ '/thresholds': PANEL })
    renderThresholds()

    const owed = await screen.findByText(/Mystery —/)
    expect(owed.textContent).toContain('not yet decided')
    expect(owed.textContent).toContain('the rescue’s number is being used meanwhile')
  })

  it('publishes a horse’s own number as a version', async () => {
    const posted = watchPosts()
    renderThresholds()

    await screen.findByText('Dawson')
    const value = screen.getByLabelText('Degrees Fahrenheit', {
      selector: '#value-dawson',
    })
    fireEvent.change(value, { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish for Dawson' }))

    await waitFor(() => {
      expect(posted.length).toBe(1)
    })
    expect(posted[0]).toMatchObject({
      horseId: 'dawson',
      kind: 'sheet',
      stance: 'overridden',
      value: 50,
      validFrom: '2026-08-18',
    })
  })

  it('publishes a horse onto the rescue’s number with no number of its own', async () => {
    const posted = watchPosts()
    renderThresholds()

    await screen.findByText('Blue')
    fireEvent.click(
      screen.getByLabelText('The rescue’s number, deliberately', {
        selector: '#stance-default-blue',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Publish for Blue' }))

    await waitFor(() => {
      expect(posted.length).toBe(1)
    })
    // No number travels with it: one copied here would stop moving when the
    // default did (ADR 0015).
    expect(posted[0]).toMatchObject({ stance: 'follows_default', value: null })
  })

  it('reads today’s weather from here, since nothing else does yet', async () => {
    const posted: unknown[] = []
    stubApi({
      '/thresholds': PANEL,
      '/weather/readings': (init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)) as unknown)
        return { readingId: 'reading-1', provider: 'open_meteo', stale: false }
      },
    })
    renderThresholds()

    await screen.findByText('Dawson')
    fireEvent.click(screen.getByRole('button', { name: 'Read today’s weather' }))

    await waitFor(() => {
      expect(posted.length).toBe(1)
    })
    // The key ADR 0005 puts on every write, minted by the client.
    expect(posted[0]).toMatchObject({ idempotencyKey: expect.any(String) as unknown as string })
  })

  it('keeps what was typed when a publish is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string | URL | Request, init: RequestInit = {}) => {
        if (init.method === 'POST') {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'threshold_value_required' }), {
              status: 409,
              headers: { 'content-type': 'application/json' },
            }),
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify(PANEL), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }),
    )
    renderThresholds()

    await screen.findByText('Dawson')
    const value = screen.getByLabelText('Degrees Fahrenheit', { selector: '#value-dawson' })
    fireEvent.change(value, { target: { value: '52' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish for Dawson' }))

    // The refusal says what to do about it, in a sentence rather than a token…
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Give the number, or put the horse on the rescue’s number instead.',
    )
    // …and the number somebody just typed is still in the box to retry with.
    expect((value as HTMLInputElement).value).toBe('52')
  })

  it('says a number nobody has set is not set, rather than showing a zero', async () => {
    stubApi({ '/thresholds': { ...PANEL, defaults: [] } })
    renderThresholds()

    expect(
      (await screen.findAllByText(/not set — the rules that use it cannot be answered/)).length,
    ).toBe(5)
  })
})
