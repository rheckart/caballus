/**
 * The navigation: the sidebar's Destinations, and the account under them
 * (#66, ADR 0026).
 *
 * Its own module rather than a function inside `src/routes/__root.tsx`,
 * because it is the part of the shell with a decision in it — *what is this
 * person offered* — and a decision is worth rendering in a test. The root
 * route keeps the document, the bars and the two paths the shell stays off.
 *
 * **Nothing here is an authorization check.** `navigationFor` decides what to
 * draw; the server decides what may happen, and would refuse a request made by
 * typing the path whether or not this component ever ran.
 */
import { Link } from '@tanstack/react-router'
import {
  Camera,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ClipboardList,
  Clock,
  FileText,
  Home as HomeIcon,
  LogOut,
  Megaphone,
  Monitor,
  Moon,
  Package,
  PawPrint,
  Phone,
  PhoneCall,
  Repeat,
  Search,
  ShoppingBasket,
  Sun,
  SunMoon,
  Thermometer,
  UserPen,
  Users,
} from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from './ui/sidebar'
import { signOutHere } from '../server/auth/login'
import {
  ACCOUNT_DESTINATION,
  navigationFor,
  type DestinationPath,
  type ListedDestination,
} from '../shared/navigation'
import {
  getThemeChoice,
  isThemeChoice,
  setThemeChoice,
  watchSystemTheme,
  type ThemeChoice,
} from '../shared/theme'
import type { Answers, contract } from '../shared/api-contract'

/**
 * What the navigation needs of `/me`, and no more: your name for the footer,
 * and the Scopes that decide what is offered. Narrowed rather than the whole
 * answer, so that widening `/me` — as #68 does, with your email and mobile —
 * does not silently hand the sidebar a credential it has no use for.
 */
type Me = Pick<Answers<typeof contract, '/me'>, 'name' | 'domainScopes'>

/**
 * A glyph for every Destination, keyed by its path.
 *
 * A **total** `Record`, so a Destination added to `src/shared/navigation.ts`
 * without an icon fails to compile rather than drawing a gap — the same
 * discipline `ITEM_FOR_PRODUCT_KIND` keeps around a Product's kind (#57). It
 * lives here rather than in `navigation.ts` because a lucide component is a
 * fact about how this shell draws, and that module is plain data that nothing
 * on the server imports.
 */
const ICONS: Record<DestinationPath, ComponentType<{ className?: string }>> = {
  '/': HomeIcon,
  '/shifts': CalendarDays,
  '/horses': PawPrint,
  '/board': ClipboardList,
  '/supplies': Package,
  '/contacts': Phone,
  '/attendance': Clock,
  '/escalations': Megaphone,
  '/admin/volunteers': Users,
  '/admin/horses': PawPrint,
  '/admin/spaces': HomeIcon,
  '/admin/products': ShoppingBasket,
  '/admin/shift-patterns': Repeat,
  '/admin/tasks': CheckSquare,
  '/admin/thresholds': Thermometer,
  '/admin/attendance': Clock,
  '/admin/release-versions': FileText,
  '/admin/contacts': PhoneCall,
  '/admin/whiteboard-read': Camera,
  '/admin/audit': Search,
}

/** The three choices, spelled with an icon beside the word and never alone. */
const themeOptions = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
] as const

/**
 * System / Light / Dark, now in the sidebar's footer beside the account. The
 * state initialises to System and syncs from storage in an effect, so the
 * server render and the first client render agree.
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
        <SidebarMenuButton tooltip="Theme">
          <SunMoon aria-hidden="true" />
          <span>Theme</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
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

/** The wordmark, which is also the way home, on every screen. */
function Wordmark() {
  const { collapsed } = useSidebar()

  return (
    <Link
      to="/"
      className="flex min-h-11 items-center gap-2 rounded-md px-2 text-base font-semibold tracking-[-0.2px] text-foreground hover:text-primary hover:no-underline"
      aria-label="Caballus home"
    >
      <span
        className="grid size-7 flex-none place-items-center rounded-md bg-brand-navy text-[15px] font-semibold text-on-dark"
        aria-hidden="true"
      >
        C
      </span>
      {!collapsed && 'Caballus'}
    </Link>
  )
}

/** One group's Destinations, as menu entries. */
function Entries({
  destinations,
  path,
  onNavigate,
}: {
  destinations: readonly ListedDestination[]
  path: string
  onNavigate: () => void
}) {
  return (
    <SidebarMenu>
      {destinations.map((destination) => {
        const Icon = ICONS[destination.to]
        return (
          <SidebarMenuItem key={destination.to}>
            <SidebarMenuButton
              asChild
              isActive={path === destination.to}
              tooltip={destination.label}
            >
              <Link to={destination.to} onClick={onNavigate}>
                <Icon aria-hidden="true" />
                <span>{destination.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

/**
 * The navigation, and the account under it.
 *
 * `me` is `null` until `/me` answers and stays `null` for a visitor who is not
 * signed in. Both draw the General group — its Destinations need no Scope, and
 * the server refuses a signed-out request to any of them exactly as it always
 * has — and neither draws an account footer, because there is no account to
 * name yet.
 */
export function Navigation({ me, path }: { me: Me | null; path: string }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const groups = navigationFor(me?.domainScopes ?? [])
  const general = groups.find((group) => group.group === 'general')
  const admin = groups.find((group) => group.group === 'admin')
  const close = () => {
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar
      title="Caballus"
      description="Every screen you can act on, in two groups."
      className="print:hidden"
    >
      <SidebarHeader>
        <Wordmark />
      </SidebarHeader>

      <SidebarContent>
        {general !== undefined && (
          <SidebarGroup>
            <SidebarGroupLabel>{general.name}</SidebarGroupLabel>
            <Entries destinations={general.destinations} path={path} onNavigate={close} />
          </SidebarGroup>
        )}

        {/* Folded rather than absent, for the officer holding two Scopes who
            is offered eleven desk screens under one heading. A plain
            Volunteer never sees the heading at all — `navigationFor` returns
            no group rather than an empty one (ADR 0026). */}
        {admin !== undefined && (
          <Collapsible defaultOpen className="group/admin">
            <SidebarGroup>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-secondary hover:text-foreground">
                {admin.name}
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 transition-transform group-data-[state=closed]/admin:-rotate-90"
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Entries destinations={admin.destinations} path={path} onNavigate={close} />
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        )}
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter>
        <SidebarMenu>
          {me !== null && (
            <SidebarMenuItem>
              <p className="m-0 px-2 py-1 text-sm font-medium text-foreground">{me.name}</p>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <ThemeMenu />
          </SidebarMenuItem>
          {me !== null && (
            <SidebarMenuItem>
              {/* Your own name, mobile and sign-in address (#68, ADR 0027) —
                  in the footer rather than in a group, because it is a fact
                  about you rather than a place in the barn. */}
              <SidebarMenuButton asChild tooltip={ACCOUNT_DESTINATION.label}>
                <Link to={ACCOUNT_DESTINATION.to} onClick={close}>
                  <UserPen aria-hidden="true" />
                  <span>{ACCOUNT_DESTINATION.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {me !== null && (
            <SidebarMenuItem>
              {/* This session only. Revoking every session an Account holds is
                  an officer's act, and the barn has a shared tablet on it. */}
              <SidebarMenuButton
                tooltip="Sign out"
                onClick={() => {
                  void signOutHere().then(() => {
                    window.location.assign('/login')
                  })
                }}
              >
                <LogOut aria-hidden="true" />
                <span>Sign out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
