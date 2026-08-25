/**
 * shadcn's Sidebar (#66, ADR 0025, ADR 0026), source this repo owns — and
 * trimmed to what this application actually draws. shadcn's own file carries a
 * rail, an inset variant, menu badges, menu actions and two levels of
 * sub-menu; none of them has a caller here, and a component nothing renders is
 * a component that goes stale unwitnessed.
 *
 * Three things are deliberately not shadcn's defaults.
 *
 * **The breakpoint is 900px, not `md`.** The app bar and the bottom tab bar
 * already split there (#61–#63), and moving the line to shadcn's 768px would
 * reflow every screen in the application to no end.
 *
 * **The drawer is chosen in JavaScript and hidden in CSS as well.** Below
 * 900px the navigation is a `Sheet`; above it, a fixed column. Rendering both
 * and letting CSS pick would put two copies of every Destination in the
 * document, and choosing in JavaScript alone would paint the desktop column
 * for one frame on a phone — so the column carries `hidden min-[900px]:flex`
 * *and* the switch, and a volunteer sees neither.
 *
 * **Collapsed means icons, and an icon collapsed still says its word** — in a
 * tooltip, which is a pointer's affordance and therefore a desk's. Nothing on
 * a phone ever reaches this state: below 900px the sidebar is the drawer, and
 * the drawer is never collapsed.
 */
import { Slot } from '@radix-ui/react-slot'
import { PanelLeft } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from 'react'

import { Button } from './button'
import { Separator } from './separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'
import { cn } from '../../shared/cn'

/** The one line the whole shell splits on, spelled once (ADR 0026). */
export const SIDEBAR_BREAKPOINT = 900

interface SidebarState {
  /** Below `SIDEBAR_BREAKPOINT`, where the navigation is a drawer. */
  readonly isMobile: boolean
  /** Whether the desktop column is collapsed to its icons. */
  readonly collapsed: boolean
  /** Whether the drawer is open. Always `false` above the breakpoint. */
  readonly openMobile: boolean
  readonly setOpenMobile: (open: boolean) => void
  /** Folds the column or opens the drawer, whichever this width means. */
  readonly toggle: () => void
}

const SidebarContext = createContext<SidebarState | null>(null)

/**
 * The sidebar's state, or a throw.
 *
 * A throw rather than a default, because every part of the sidebar needs to
 * know which of the two shapes it is in, and a silent default would render the
 * desk's column inside the phone's drawer with nothing to say so.
 */
export function useSidebar(): SidebarState {
  const state = useContext(SidebarContext)
  if (state === null) throw new Error('useSidebar was called outside a SidebarProvider')
  return state
}

/**
 * Whether the viewport is below the breakpoint.
 *
 * Starts `false` on the server and on the first client render — the server
 * cannot know, and the two have to agree or React re-renders the document —
 * and syncs in an effect, the same shape `ThemeMenu` takes for the same
 * reason. The CSS carries the phone's answer in the meantime.
 */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${SIDEBAR_BREAKPOINT - 1}px)`)
    const answer = () => setIsMobile(query.matches)
    answer()
    query.addEventListener('change', answer)
    return () => query.removeEventListener('change', answer)
  }, [])

  return isMobile
}

function SidebarProvider({ className, children, ...props }: ComponentProps<'div'>) {
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState(false)
  const [openMobile, setOpenMobile] = useState(false)

  const toggle = useCallback(() => {
    if (isMobile) setOpenMobile((open) => !open)
    else setCollapsed((folded) => !folded)
  }, [isMobile])

  const state = useMemo<SidebarState>(
    () => ({
      isMobile,
      collapsed: isMobile ? false : collapsed,
      openMobile,
      setOpenMobile,
      toggle,
    }),
    [isMobile, collapsed, openMobile, toggle],
  )

  return (
    <SidebarContext.Provider value={state}>
      <TooltipProvider>
        <div
          data-slot="sidebar-wrapper"
          className={cn('flex min-h-dvh w-full', className)}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

/**
 * The navigation itself: a drawer below the breakpoint, a fixed column above.
 *
 * `title` and `description` are required and go to the drawer's own heading —
 * Radix warns without a title, and a panel that covers the screen with nothing
 * announced leaves a screen reader nowhere. Above the breakpoint they are the
 * column's accessible name.
 */
function Sidebar({
  title,
  description,
  className,
  children,
  ...props
}: ComponentProps<'div'> & { title: string; description: string }) {
  const { isMobile, collapsed, openMobile, setOpenMobile } = useSidebar()

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent side="left" data-slot="sidebar" className="p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <nav aria-label={title} className="flex h-full w-full flex-col overflow-y-auto">
            {children}
          </nav>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      data-slot="sidebar"
      data-collapsed={collapsed}
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 border-r border-border bg-card transition-[width] duration-200 min-[900px]:flex',
        collapsed ? 'w-16' : 'w-64',
        className,
      )}
      {...props}
    >
      <nav aria-label={title} className="flex h-full w-full flex-col overflow-y-auto">
        {children}
      </nav>
    </div>
  )
}

/**
 * Folds the column, or opens the drawer. One control, because at any one width
 * there is only one thing it could mean.
 */
function SidebarTrigger({ className, ...props }: ComponentProps<typeof Button>) {
  const { isMobile, openMobile, toggle } = useSidebar()

  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      aria-expanded={isMobile ? openMobile : undefined}
      aria-label={isMobile ? 'Open navigation' : 'Fold navigation'}
      onClick={toggle}
      className={cn('text-muted-foreground', className)}
      {...props}
    >
      <PanelLeft aria-hidden="true" />
    </Button>
  )
}

function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn('flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2', className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn(
        'flex flex-col gap-1 p-2 pb-[calc(--spacing(2)+env(safe-area-inset-bottom,0px))]',
        className,
      )}
      {...props}
    />
  )
}

function SidebarSeparator({ className, ...props }: ComponentProps<typeof Separator>) {
  return (
    <Separator data-slot="sidebar-separator" className={cn('mx-2 w-auto', className)} {...props} />
  )
}

function SidebarGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="sidebar-group" className={cn('flex flex-col gap-0.5', className)} {...props} />
  )
}

/**
 * A group's heading. Hidden when the column is folded to icons, because a word
 * does not fit in sixteen units and a truncated one is worse than the rule
 * above the icons it labels.
 */
function SidebarGroupLabel({ className, ...props }: ComponentProps<'div'>) {
  const { collapsed } = useSidebar()

  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        'px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
        collapsed && 'sr-only',
        className,
      )}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul data-slot="sidebar-menu" className={cn('flex flex-col gap-0.5', className)} {...props} />
  )
}

function SidebarMenuItem({ className, ...props }: ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('list-none', className)} {...props} />
}

/**
 * One entry. `asChild` is how a `<Link>` gets these styles without a button
 * wrapping an anchor.
 *
 * `tooltip` is the word an icon says when the column is folded. It is spelled
 * separately from the child's own text because the child's text is what the
 * tooltip would be *hiding* — passing it twice is what lets the label be
 * `sr-only` in the trigger and legible in the tooltip.
 */
function SidebarMenuButton({
  className,
  asChild = false,
  isActive = false,
  tooltip,
  children,
  ...props
}: ComponentProps<'button'> & {
  asChild?: boolean
  isActive?: boolean
  tooltip?: string
}) {
  const { collapsed } = useSidebar()
  const Comp = asChild ? Slot : 'button'

  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={isActive}
      className={cn(
        'flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors',
        'hover:bg-secondary hover:text-foreground hover:no-underline',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'data-[active=true]:bg-secondary data-[active=true]:text-foreground',
        '[&_svg]:size-5 [&_svg]:shrink-0 [&>span]:truncate',
        collapsed && 'justify-center px-0 [&>span]:sr-only',
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  )

  if (!collapsed || tooltip === undefined) return button

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

/** Everything that is not the sidebar: the screen, and the bars above it. */
function SidebarInset({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-inset"
      className={cn('flex min-w-0 flex-1 flex-col', className)}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
}
