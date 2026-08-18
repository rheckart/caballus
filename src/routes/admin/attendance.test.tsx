/**
 * The hours report at the UI seam (#32's testing decisions, #43): the real
 * route component, the real typed client, only `fetch` stubbed.
 *
 * What is claimed: the same ledger renders as Calvert's one-row-per-visit and
 * as Anne Arundel's totals, and an open Attendance never reaches either — a
 * letter reporting hours nobody closed is exactly the fabrication ADR 0012
 * writes itself against.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../../test/api-stub'
import { renderRoutes } from '../../test/route-harness'
import { Route } from './attendance'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderReport() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoutes([{ path: '/admin/attendance', component }], '/admin/attendance')
}

function entry(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    volunteerId: extra.volunteerId ?? 'beth',
    volunteerName: extra.volunteerName ?? 'Beth Ann',
    shiftId: null,
    day: extra.day ?? '2026-08-18',
    category: extra.category ?? 'maintenance',
    description: extra.description ?? 'Mowed the north field',
    arrivedAt: 1_700_000_000_000,
    arrivedBy: 'beth',
    arrivedByName: 'Beth Ann',
    departedAt: extra.departedAt === undefined ? 1_700_003_600_000 : extra.departedAt,
    departedBy: extra.departedAt === null ? null : 'beth',
    departedByName: extra.departedAt === null ? null : 'Beth Ann',
    supervisingAdultId: null,
    supervisingAdultName: null,
    supervisingAdultPhone: null,
  }
}

describe('the hours report', () => {
  it('shows Calvert’s one row per visit by default', async () => {
    stubApi({ '/attendance': { entries: [entry('a')] } })
    renderReport()

    expect(await screen.findByText('Mowed the north field')).toBeTruthy()
    expect(screen.getByText('One row per visit, for a signature each')).toBeTruthy()
  })

  it('leaves an open Attendance off the report — nothing to sign for yet', async () => {
    stubApi({ '/attendance': { entries: [entry('a', { departedAt: null })] } })
    renderReport()

    await waitFor(() => {
      expect(screen.queryByText('Mowed the north field')).toBeNull()
    })
  })

  it('switches to Anne Arundel’s totals, with no line items', async () => {
    stubApi({
      '/attendance': {
        entries: [entry('a', { day: '2026-08-18' }), entry('b', { day: '2026-08-19' })],
      },
    })
    renderReport()

    await screen.findByText('One row per visit, for a signature each')
    fireEvent.change(screen.getByLabelText('County'), { target: { value: 'anne_arundel' } })

    expect(await screen.findByText('Dates and a total, no line items')).toBeTruthy()
    expect(screen.getByText('Beth Ann')).toBeTruthy()
    expect(screen.getByText('2026-08-18, 2026-08-19')).toBeTruthy()
    expect(screen.getAllByText('2')).toHaveLength(2)
    expect(screen.queryByText('Mowed the north field')).toBeNull()
  })
})
