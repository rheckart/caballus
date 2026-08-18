/**
 * Unmounts whatever the previous component test rendered, so one test's DOM
 * is never still on the page when the next queries for it. Testing Library
 * does this automatically under Jest; under Vitest it has to be wired by
 * hand, once, here — every `.test.tsx` file gets it through this project's
 * `setupFiles` rather than importing it for itself.
 */
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
