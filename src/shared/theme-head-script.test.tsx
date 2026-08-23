/**
 * Binds `THEME_HEAD_SCRIPT` to `resolveDark` (#61, ADR 0016): the script is a
 * restatement of the rule that has to run before the module loads, and a
 * restatement two files apart is exactly the kind of invariant that drifts
 * unless a test evaluates both against one table. A `.tsx` file so it runs in
 * the jsdom project, where the script's own globals — localStorage, location,
 * document — are real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { THEME_HEAD_SCRIPT, THEME_STORAGE_KEY, getThemeChoice, resolveDark } from './theme'

// This jsdom project does not expose `localStorage` as a bare global the way
// a browser does, and both the script and `getThemeChoice` reach for the bare
// name — so the window's own storage is stubbed onto the global once.
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => {
    storage.clear()
  },
})

afterEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  window.history.replaceState(null, '', '/')
})

function runHeadScript(stored: string | null, systemDark: boolean, path: string) {
  localStorage.clear()
  if (stored !== null) localStorage.setItem(THEME_STORAGE_KEY, stored)
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: systemDark, media: query }))
  window.history.replaceState(null, '', path)
  document.documentElement.classList.remove('dark')
  // The script is a plain IIFE string; running it the way the browser does.
  new Function(THEME_HEAD_SCRIPT)()
  return document.documentElement.classList.contains('dark')
}

describe('the head script agrees with resolveDark', () => {
  const stored = [null, 'system', 'light', 'dark', 'garbage'] as const
  const paths = ['/', '/horses/abc', '/board', '/board/', '/boardroom'] as const

  for (const value of stored) {
    for (const systemDark of [false, true]) {
      for (const path of paths) {
        it(`stored ${String(value)}, system ${systemDark ? 'dark' : 'light'}, at ${path}`, () => {
          localStorage.clear()
          if (value !== null) localStorage.setItem(THEME_STORAGE_KEY, value)
          // The module's own reading of the same storage: an unknown value
          // falls back to System, and the script must land where it lands.
          const expected = resolveDark(getThemeChoice(), systemDark, path)
          expect(runHeadScript(value, systemDark, path)).toBe(expected)
        })
      }
    }
  }
})
