/**
 * The one dark-mode rule, tabled (#61): System follows the OS, an explicit
 * choice beats it, and `/board` is pinned light in every combination —
 * ADR 0022's wall must not go dark at dusk because a tablet's OS decided.
 */
import { describe, expect, it } from 'vitest'

import { isThemeChoice, resolveDark } from './theme'

describe('resolveDark', () => {
  const cases = [
    { choice: 'system', systemDark: false, path: '/', dark: false },
    { choice: 'system', systemDark: true, path: '/', dark: true },
    { choice: 'light', systemDark: true, path: '/', dark: false },
    { choice: 'dark', systemDark: false, path: '/', dark: true },
    { choice: 'dark', systemDark: false, path: '/horses/abc', dark: true },
    // The Board, pinned light in every combination.
    { choice: 'system', systemDark: true, path: '/board', dark: false },
    { choice: 'dark', systemDark: true, path: '/board', dark: false },
    { choice: 'dark', systemDark: false, path: '/board/', dark: false },
    { choice: 'light', systemDark: false, path: '/board', dark: false },
    // A path that merely begins with the word is not the Board.
    { choice: 'dark', systemDark: false, path: '/boardroom', dark: true },
  ] as const

  for (const { choice, systemDark, path, dark } of cases) {
    it(`${choice}, system ${systemDark ? 'dark' : 'light'}, at ${path} -> ${dark ? 'dark' : 'light'}`, () => {
      expect(resolveDark(choice, systemDark, path)).toBe(dark)
    })
  }
})

describe('isThemeChoice', () => {
  it('accepts the three and refuses the rest', () => {
    expect(isThemeChoice('system')).toBe(true)
    expect(isThemeChoice('light')).toBe(true)
    expect(isThemeChoice('dark')).toBe(true)
    expect(isThemeChoice('auto')).toBe(false)
    expect(isThemeChoice(null)).toBe(false)
  })
})
