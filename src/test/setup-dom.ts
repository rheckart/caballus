/**
 * The component-test DOM, patched once for every `.test.tsx` file.
 *
 * The cleanup: unmounts whatever the previous component test rendered, so one
 * test's DOM is never still on the page when the next queries for it. Testing
 * Library does this automatically under Jest; under Vitest it is wired by
 * hand, here, through the project's `setupFiles`.
 *
 * The stubs are ADR 0025's test cost, paid in the first styling ticket (#61):
 * Radix's primitives probe four browser facts jsdom does not implement —
 * pointer capture, `scrollIntoView`, `ResizeObserver` — and dark mode reads
 * `matchMedia` besides. Each stub is the least that stops the throw; none
 * asserts anything.
 */
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = () => false
}
if (typeof Element.prototype.setPointerCapture !== 'function') {
  Element.prototype.setPointerCapture = () => {}
}
if (typeof Element.prototype.releasePointerCapture !== 'function') {
  Element.prototype.releasePointerCapture = () => {}
}

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}

if (typeof globalThis.ResizeObserver !== 'function') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
