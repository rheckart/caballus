/**
 * Dark mode (#61, ADR 0025): three named choices — System, Light, Dark —
 * defaulting to System and remembered in localStorage. Deliberately not a
 * two-state toggle: a switch reading *Light* cannot say whether you chose it
 * or the system did, and offers no way back to letting it decide.
 *
 * `/board` is pinned light regardless of both the stored choice and the
 * system: a wall display read across a barn must not go dark at dusk because
 * a tablet's OS decided (ADR 0022).
 *
 * `resolveDark` is the one rule, pure and table-tested; the inline script in
 * `src/routes/__root.tsx`'s head restates it in five lines because it must
 * run before this module loads — change one and change both.
 */

export const THEME_CHOICES = ['system', 'light', 'dark'] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]

export const THEME_STORAGE_KEY = 'caballus-theme'

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.includes(value as ThemeChoice)
}

/** Whether the page should carry the `dark` class, from the three facts. */
export function resolveDark(choice: ThemeChoice, systemDark: boolean, pathname: string): boolean {
  if (pathname === '/board' || pathname.startsWith('/board/')) return false
  if (choice === 'dark') return true
  if (choice === 'light') return false
  return systemDark
}

/** The stored choice, defaulting to System wherever storage is absent or odd. */
export function getThemeChoice(): ThemeChoice {
  if (typeof localStorage === 'undefined') return 'system'
  const stored: unknown = localStorage.getItem(THEME_STORAGE_KEY)
  return isThemeChoice(stored) ? stored : 'system'
}

/** Applies the choice to `<html>`; a no-op outside a browser. */
export function applyTheme(choice: ThemeChoice = getThemeChoice()) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const systemDark =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  document.documentElement.classList.toggle(
    'dark',
    resolveDark(choice, systemDark, window.location.pathname),
  )
}

/** Stores the choice and applies it in the same act. */
export function setThemeChoice(choice: ThemeChoice) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_STORAGE_KEY, choice)
  applyTheme(choice)
}

/**
 * Re-applies the theme when the system's own preference changes, so System
 * follows the OS while the app is open. Returns the unsubscribe.
 */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    applyTheme()
  }
  media.addEventListener('change', onChange)
  return () => {
    media.removeEventListener('change', onChange)
  }
}

/**
 * The before-first-paint restatement of `resolveDark`, inlined into the head
 * because the app is server-rendered and the server does not know the choice —
 * without it every load flashes the wrong theme.
 */
export const THEME_HEAD_SCRIPT = `(function () {
  try {
    var choice = localStorage.getItem('${THEME_STORAGE_KEY}')
    var dark =
      choice === 'dark' ||
      (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
    var path = location.pathname
    if (path === '/board' || path.indexOf('/board/') === 0) dark = false
    if (dark) document.documentElement.classList.add('dark')
  } catch (_error) {
    /* No storage, no matchMedia: the light default stands. */
  }
})()`
