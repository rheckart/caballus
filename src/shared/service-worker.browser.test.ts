import { afterEach, expect, it, vi } from 'vitest'

import { registerServiceWorker } from './service-worker.browser'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('registers the shell worker at the scope root when the browser has one', () => {
  const register = vi.fn()
  vi.stubGlobal('navigator', { serviceWorker: { register } })

  registerServiceWorker()

  expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js')
})

it('does nothing where navigator.serviceWorker does not exist, rather than throwing', () => {
  vi.stubGlobal('navigator', {})

  expect(() => registerServiceWorker()).not.toThrow()
})

it('does nothing where there is no navigator at all — a server render, or a test that stubs none in', () => {
  vi.stubGlobal('navigator', undefined)

  expect(() => registerServiceWorker()).not.toThrow()
})
