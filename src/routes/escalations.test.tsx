/**
 * Escalations, at the UI seam: the real route component, the real typed
 * client, and only `fetch` stubbed (#32's testing decisions, #44).
 *
 * What is claimed: a holder's own open Escalations sit in their own section,
 * closing needs a note and belongs to a holder of the addressed Scope, and
 * the thread accepts a comment from anyone (ADR 0014).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../test/api-stub'
import { renderRoutes } from '../test/route-harness'
import { Route } from './escalations'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderEscalations() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoutes([{ path: '/escalations', component }], '/escalations')
}

const OPEN_ESCALATION = {
  id: 'esc-1',
  observationId: 'obs-1',
  observationText: 'Third time this week, and she left half the bucket',
  observationSubjectLabel: 'Storm',
  scope: 'horse_care',
  framing: 'Third time this week, and she left half the bucket.',
  escalatedBy: 'kate',
  escalatedByName: 'Kate',
  escalatedAt: 0,
  closedAt: null,
  closedBy: null,
  closedByName: null,
  closingNote: null,
  comments: [],
}

describe('the Escalations screen', () => {
  it('shows an open Escalation addressed to a Scope the reader holds, in its own section', async () => {
    stubApi({
      '/me': {
        volunteerId: 'welfare',
        name: 'Head Welfare',
        email: 'someone@barn.test',
        mobile: null,
        domainScopes: ['horse_care'],
      },
      '/escalations': { escalations: [OPEN_ESCALATION] },
    })
    renderEscalations()

    expect(await screen.findByText('Open, addressed to a Scope you hold')).toBeTruthy()
    expect(screen.getAllByText(/Third time this week/).length).toBeGreaterThan(0)
  })

  it('does not offer a close form to a reader who does not hold the addressed Scope', async () => {
    stubApi({
      '/me': {
        volunteerId: 'beth',
        name: 'Beth Ann',
        email: 'someone@barn.test',
        mobile: null,
        domainScopes: [],
      },
      '/escalations': { escalations: [OPEN_ESCALATION] },
    })
    renderEscalations()

    await screen.findAllByText(/Third time this week/)
    expect(screen.queryByLabelText('Close with a note')).toBeNull()
    // The thread stays writable regardless — the fourth scope-free write.
    expect(screen.getByLabelText('Add to the thread')).toBeTruthy()
  })

  it('closes with a note, for a holder of the addressed Scope', async () => {
    let closed: unknown = null
    stubApi({
      '/me': {
        volunteerId: 'welfare',
        name: 'Head Welfare',
        email: 'someone@barn.test',
        mobile: null,
        domainScopes: ['horse_care'],
      },
      '/escalations': { escalations: [OPEN_ESCALATION] },
      '/escalations/close': (init: RequestInit) => {
        closed = JSON.parse(String(init.body))
        return {}
      },
    })
    renderEscalations()

    fireEvent.change(await screen.findByLabelText('Close with a note'), {
      target: { value: 'Farrier booked for Tuesday.' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0] as HTMLElement)

    await waitFor(() => {
      expect(closed).toMatchObject({ escalationId: 'esc-1', note: 'Farrier booked for Tuesday.' })
    })
  })

  it('appends a thread comment for anyone, whether or not they hold the Scope', async () => {
    let commented: unknown = null
    stubApi({
      '/me': {
        volunteerId: 'beth',
        name: 'Beth Ann',
        email: 'someone@barn.test',
        mobile: null,
        domainScopes: [],
      },
      '/escalations': {
        escalations: [
          {
            ...OPEN_ESCALATION,
            closedAt: 1000,
            closedBy: 'welfare',
            closedByName: 'Head Welfare',
            closingNote: 'Farrier booked.',
          },
        ],
      },
      '/escalations/comments': (init: RequestInit) => {
        commented = JSON.parse(String(init.body))
        return {}
      },
    })
    renderEscalations()

    fireEvent.change(await screen.findByLabelText('Add to the thread'), {
      target: { value: 'Still worse this morning.' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Comment' })[0] as HTMLElement)

    await waitFor(() => {
      expect(commented).toMatchObject({ escalationId: 'esc-1', text: 'Still worse this morning.' })
    })
  })
})
