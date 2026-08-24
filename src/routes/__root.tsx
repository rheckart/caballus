/**
 * The document, and the shell every screen is drawn inside.
 *
 * **Navigation is a Sidebar, and it offers what you may act on** (#66, ADR
 * 0026). Above 900px it is the whole of the navigation and there is no desktop
 * top bar at all; below it, it is a drawer behind a trigger in a thin bar
 * carrying the wordmark. What it offers is decided by `src/shared/navigation.ts`
 * against the Domain Scopes `/me` answers with: a plain Volunteer is offered
 * **General** and no **Admin** heading, rather than an Admin heading with two
 * dead entries under it. That is a change of rule for Destinations and not for
 * controls — ADR 0011's disabled-and-explained action still governs a button on
 * a screen you are already on — and it is **cosmetic**: every screen is still
 * reachable by typing its path, and the server still refuses.
 *
 * **The bottom tab bar stays on the phone.** It is not replaced by the drawer.
 * A drawer is two taps and hides everything; the tabs are one tap, always
 * visible, at thumb height, and this application is built for gloves and
 * sunlight (ADR 0007). All five are on the floor, so the bar never changes
 * shape — a volunteer finds Shifts in the same place every time.
 *
 * **The footer carries the account**: who you are, the Theme menu (moved out of
 * the app bar) and Sign out. Sign out lived on Home, and Home is becoming the
 * barn's dashboard (#67), so it had to move somewhere that is on every screen.
 *
 * Both bars stay off exactly two paths. `/login` has nowhere to navigate to,
 * and `/board` is a wall a barn reads across a room, authenticated as the barn
 * and with no `Actor` to navigate as (ADR 0022).
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
import { CalendarDays, House, Package, PawPrint, Phone } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { Navigation } from '../components/navigation'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '../components/ui/sidebar'
import { ApiError, client } from '../shared/api-client'
import { THEME_HEAD_SCRIPT, applyTheme } from '../shared/theme'
import appCss from '../styles/tailwind.css?url'
import type { Answers, contract } from '../shared/api-contract'

type Me = Answers<typeof contract, '/me'>

/** Where the phone's tab bar goes, in the order a thumb meets them. */
const tabs = [
  { to: '/', Icon: House, label: 'Home' },
  { to: '/shifts', Icon: CalendarDays, label: 'Shifts' },
  { to: '/horses', Icon: PawPrint, label: 'Horses' },
  { to: '/supplies', Icon: Package, label: 'Supplies' },
  { to: '/contacts', Icon: Phone, label: 'Contacts' },
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

/**
 * The shell, or nothing. `useRouterState` rather than a prop, because the
 * decision is about the path and the path is the router's fact.
 */
function Shell() {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const [me, setMe] = useState<Me | null>(null)

  // Client-side navigation onto or off `/board` re-answers the theme, because
  // the head script only runs on a full load and the Board is pinned light.
  useEffect(() => {
    applyTheme()
  }, [path])

  // Who is reading, which is what decides what the sidebar offers. A 401 is
  // the signed-out answer and not a failure — it is the explicit refusal ADR
  // 0010 makes a status rather than an empty body — and anything else leaves
  // the navigation at its floor, which is the direction that fails safe: the
  // barn is offered and the desk is not.
  useEffect(() => {
    let current = true
    client
      .get('/me')
      .then((answered) => {
        if (current) setMe(answered)
      })
      .catch((error: unknown) => {
        if (!current) return
        if (!(error instanceof ApiError)) return
        setMe(null)
      })
    return () => {
      current = false
    }
  }, [])

  if (bare.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return <Outlet />
  }

  return (
    <SidebarProvider>
      <Navigation me={me} path={path} />

      <SidebarInset>
        {/* The thin bar the drawer opens from. Gone above 900px, where the
            sidebar is the navigation and a second copy of the wordmark over
            it is chrome for nothing. */}
        <header className="sticky top-0 z-20 flex h-(--shell-top) items-center gap-1 border-b border-border bg-background px-2 min-[900px]:hidden">
          <SidebarTrigger />
          <Link
            to="/"
            className="flex min-h-11 items-center gap-2 px-1 text-base font-semibold tracking-[-0.2px] text-foreground hover:text-primary hover:no-underline"
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
      </SidebarInset>
    </SidebarProvider>
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
