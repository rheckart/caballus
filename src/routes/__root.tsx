/**
 * The document, and the shell every screen is drawn inside.
 *
 * Two things live here that used to live nowhere. The **app bar** carries the
 * wordmark as a link to `/`, on every screen, which is the way back that this
 * application did not have: a volunteer four screens into the desk had only the
 * browser's own chrome, and a standalone install (#48) does not have that. The
 * **tab bar** is the phone's navigation — five destinations at thumb height,
 * fixed to the bottom, replaced by a row in the app bar once the screen is wide
 * enough to hold one.
 *
 * Both are hidden on exactly two paths. `/login` has nowhere to navigate to,
 * and `/board` is a wall a barn reads across a room, authenticated as the barn
 * and with no `Actor` to navigate as (ADR 0022) — chrome on it is chrome
 * somebody has to walk over and look past.
 *
 * `src/styles/tailwind.css` is the whole styling system (ADR 0025, #61–#63):
 * Tailwind's theme carrying DESIGN.md's tokens, the shadcn semantic tokens
 * with their dark twins, and the base element typography. The inline script
 * in `head` is dark mode's before-first-paint half — the app is
 * server-rendered and the server does not know the choice, so without it
 * every load flashes the wrong theme.
 */
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from '@tanstack/react-router'
import {
  CalendarDays,
  House,
  Monitor,
  Moon,
  Package,
  PawPrint,
  Phone,
  Sun,
  SunMoon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { Button } from '../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import {
  THEME_HEAD_SCRIPT,
  applyTheme,
  getThemeChoice,
  isThemeChoice,
  setThemeChoice,
  watchSystemTheme,
  type ThemeChoice,
} from '../shared/theme'
import appCss from '../styles/tailwind.css?url'

/** Where the phone's tab bar goes, in the order a thumb meets them. */
const tabs = [
  { to: '/', Icon: House, label: 'Home' },
  { to: '/shifts', Icon: CalendarDays, label: 'Shifts' },
  { to: '/horses', Icon: PawPrint, label: 'Horses' },
  { to: '/supplies', Icon: Package, label: 'Supplies' },
  { to: '/contacts', Icon: Phone, label: 'Contacts' },
] as const

/** The same destinations plus the Board, for a screen with a top bar's room. */
const barLinks = [
  { to: '/shifts', label: 'Shifts' },
  { to: '/horses', label: 'Horses' },
  { to: '/board', label: 'Board' },
  { to: '/supplies', label: 'Supplies' },
  { to: '/contacts', label: 'Contacts' },
] as const

/** The two paths the shell stays off: nowhere to go, and nobody to go as. */
const bare = ['/login', '/board']

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      // Built for gloves and sunlight (ADR 0007): the work surface is a phone
      // in a barn, so the viewport is never scaled away from the device.
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Caballus' },
      // The installable half of ADR 0004 (#48): a theme colour for the
      // browser chrome and the status bar of a standalone install alike.
      { name: 'theme-color', content: '#0f5d55' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      // The manifest and the icons it names are what turn "Add to Home
      // Screen" into a real icon opening standalone; installing stays
      // optional; nothing here changes what a plain browser tab does.
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/icons/icon-192.png' },
      { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
    ],
    // Dark mode before first paint (#61): the five-line restatement of
    // `resolveDark`, because the class has to be on <html> before the
    // stylesheet paints anything.
    scripts: [{ children: THEME_HEAD_SCRIPT }],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Shell />
    </RootDocument>
  )
}

/** The three choices, spelled with an icon beside the word and never alone. */
const themeOptions = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
] as const

/**
 * System / Light / Dark, in the app bar beside the wordmark. The state
 * initialises to System and syncs from storage in an effect, so the server
 * render and the first client render agree.
 */
function ThemeMenu() {
  const [choice, setChoice] = useState<ThemeChoice>('system')

  useEffect(() => {
    setChoice(getThemeChoice())
    return watchSystemTheme()
  }, [])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <SunMoon aria-hidden="true" />
          Theme
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={choice}
          onValueChange={(value) => {
            if (!isThemeChoice(value)) return
            setChoice(value)
            setThemeChoice(value)
          }}
        >
          {themeOptions.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The shell, or nothing. `useRouterState` rather than a prop, because the
 * decision is about the path and the path is the router's fact.
 */
function Shell() {
  const path = useRouterState({ select: (state) => state.location.pathname })

  // Client-side navigation onto or off `/board` re-answers the theme, because
  // the head script only runs on a full load and the Board is pinned light.
  useEffect(() => {
    applyTheme()
  }, [path])

  if (bare.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return <Outlet />
  }

  return (
    <>
      <header className="sticky top-0 z-20 flex h-(--shell-top) items-center gap-2 border-b border-border bg-background px-4">
        {/* The way home, on every screen, from the mark itself. */}
        <Link
          to="/"
          className="flex min-h-11 items-center gap-2 pr-2 text-base font-semibold tracking-[-0.2px] text-foreground hover:text-primary hover:no-underline"
          aria-label="Caballus home"
        >
          <span
            className="grid size-7 flex-none place-items-center rounded-md bg-brand-navy text-[15px] font-semibold text-on-dark"
            aria-hidden="true"
          >
            C
          </span>
          Caballus
        </Link>
        <ThemeMenu />
        <span className="flex-1" />
        <nav className="hidden items-center gap-1 min-[900px]:flex" aria-label="Sections">
          {barLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-sm px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground hover:no-underline data-[current=true]:bg-secondary data-[current=true]:text-foreground"
              data-current={path === link.to}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>

      <Outlet />

      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid auto-cols-fr grid-flow-col border-t border-border bg-background pb-[env(safe-area-inset-bottom,0px)] min-[900px]:hidden"
        aria-label="Main"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className="flex min-h-[60px] flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-center text-[11px] font-medium leading-tight text-muted-foreground hover:no-underline data-[current=true]:text-primary"
            data-current={path === tab.to}
          >
            <tab.Icon aria-hidden="true" className="size-5" />
            {tab.label}
          </Link>
        ))}
      </nav>
    </>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
