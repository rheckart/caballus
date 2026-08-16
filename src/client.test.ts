import { expect, it, vi } from 'vitest'

/**
 * The entry is four lines and one of them is an ordering: reporting starts
 * before the router hydrates, because an exception thrown during hydration is
 * the one nobody can reproduce. An ordering is exactly the thing a later edit
 * moves by accident, so it is asserted rather than commented.
 */
const entry = vi.hoisted(() => {
  const calls: string[] = []
  return {
    calls,
    startObservability: vi.fn(() => {
      calls.push('startObservability')
    }),
    hydrateRoot: vi.fn(() => {
      calls.push('hydrateRoot')
      return { unmount: () => undefined }
    }),
  }
})

vi.mock('./shared/observability.browser', () => ({
  startObservability: entry.startObservability,
  report: vi.fn(),
}))
vi.mock('react-dom/client', () => ({ hydrateRoot: entry.hydrateRoot }))
vi.mock('@tanstack/react-start/client', () => ({ StartClient: () => null }))

it('starts reporting before it hydrates', async () => {
  vi.stubGlobal('document', {})

  await import('./client')

  expect(entry.calls).toEqual(['startObservability', 'hydrateRoot'])
  vi.unstubAllGlobals()
})
