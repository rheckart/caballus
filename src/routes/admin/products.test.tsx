/**
 * The Products desk at the UI seam, and specifically the Retirement panel
 * (#64).
 *
 * What is claimed here is that the sheet reads the Product back out of the
 * list it just reloaded rather than out of a row captured when the Edit button
 * was pressed. The Retirement panel is the one form on this screen that stays
 * open across its own write — every other form closes the sheet on save — so
 * it is the one place where a captured row would go on offering *Retire the
 * Product* against a Product the catalogue behind it has already marked
 * Retired, and a coordinator who mistyped the date would have no correction
 * without closing and re-opening.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubApi } from '../../test/api-stub'
import { renderRoute } from '../../test/route-harness'
import { Route } from './products'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderProducts() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoute('/admin/products', component)
}

/**
 * Nothing here is optional on the wire: the client parses every answer against
 * the contract, so a fixture missing `retiredOn` or `onFeedSchedules` fails to
 * parse and the screen sees no Products at all.
 */
function product(over: { retiredOn?: string | null; onFeedSchedules?: number } = {}) {
  return {
    id: 'senior',
    name: 'Senior',
    kind: 'feed',
    supplierId: null,
    supplierName: null,
    prescription: false,
    reorderPointDays: null,
    orderingNote: null,
    retiredOn: over.retiredOn ?? null,
    onFeedSchedules: over.onFeedSchedules ?? 0,
  }
}

describe('the Retirement panel', () => {
  it('flips to the correction once its own write has landed', async () => {
    let retired: string | null = null
    const posted: unknown[] = []
    stubApi({
      '/suppliers': { suppliers: [] },
      '/products': () => ({ products: [product({ retiredOn: retired })] }),
      '/products/retirement': (init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { retiredOn: string | null }
        posted.push(body)
        retired = body.retiredOn
        return undefined
      },
    })
    renderProducts()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-03-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Retire the Product' }))

    await waitFor(() => {
      expect(posted.length).toBe(1)
    })
    expect(posted[0]).toMatchObject({ productId: 'senior', retiredOn: '2026-03-01' })

    // The sheet is still open, and it now says what the record says. Scoped
    // to the dialog, because the row behind it wears the same date as a badge.
    const sheet = within(screen.getByRole('dialog'))
    await waitFor(() => {
      expect(sheet.getByRole('heading', { name: 'Retired 2026-03-01' })).toBeTruthy()
    })
    expect(sheet.getByRole('button', { name: 'Correct: not Retired' })).toBeTruthy()
    expect(sheet.queryByRole('button', { name: 'Retire the Product' })).toBe(null)
  })

  it('flips back the other way when the Retirement is corrected', async () => {
    let retired: string | null = '2026-03-01'
    stubApi({
      '/suppliers': { suppliers: [] },
      '/products': () => ({ products: [product({ retiredOn: retired })] }),
      '/products/retirement': (init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { retiredOn: string | null }
        retired = body.retiredOn
        return undefined
      },
    })
    renderProducts()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const sheet = within(screen.getByRole('dialog'))
    expect(sheet.getByRole('heading', { name: 'Retired 2026-03-01' })).toBeTruthy()

    fireEvent.click(sheet.getByRole('button', { name: 'Correct: not Retired' }))

    await waitFor(() => {
      expect(sheet.getByRole('button', { name: 'Retire the Product' })).toBeTruthy()
    })
    expect(sheet.queryByRole('heading', { name: 'Retired 2026-03-01' })).toBe(null)
  })

  it('offers no Retirement while a horse still eats it, and says how many', async () => {
    stubApi({
      '/suppliers': { suppliers: [] },
      '/products': { products: [product({ onFeedSchedules: 9 })] },
    })
    renderProducts()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(screen.getByText(/on 9 horses' current Feed Schedules/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retire the Product' })).toBe(null)
  })
})
