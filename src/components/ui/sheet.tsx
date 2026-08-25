/**
 * shadcn's Sheet (#66, ADR 0025), source this repo owns — a Radix Dialog that
 * slides in from an edge rather than rising from the bottom.
 *
 * Its one job in this application is the navigation drawer below 900px, which
 * is why there is a `side` and no `right`/`top`/`bottom` variants invented for
 * a caller that does not exist. `src/components/ui/dialog.tsx` is the other
 * shape and stays the one modals use; the two share the primitive and nothing
 * else.
 *
 * `SheetTitle` is required rather than optional. Radix warns without one, and
 * a drawer that opens over the whole screen with nothing announced is a screen
 * reader landing nowhere — so the drawer names itself, visibly or `sr-only`.
 */
import {
  Close as SheetClosePrimitive,
  Content as SheetContentPrimitive,
  Description as SheetDescriptionPrimitive,
  Overlay as SheetOverlayPrimitive,
  Portal as SheetPortalPrimitive,
  Root as SheetRootPrimitive,
  Title as SheetTitlePrimitive,
  Trigger as SheetTriggerPrimitive,
} from '@radix-ui/react-dialog'
import type { ComponentProps } from 'react'

import { cn } from '../../shared/cn'

function Sheet(props: ComponentProps<typeof SheetRootPrimitive>) {
  return <SheetRootPrimitive data-slot="sheet" {...props} />
}

function SheetTrigger(props: ComponentProps<typeof SheetTriggerPrimitive>) {
  return <SheetTriggerPrimitive data-slot="sheet-trigger" {...props} />
}

function SheetClose(props: ComponentProps<typeof SheetClosePrimitive>) {
  return <SheetClosePrimitive data-slot="sheet-close" {...props} />
}

function SheetOverlay({ className, ...props }: ComponentProps<typeof SheetOverlayPrimitive>) {
  return (
    <SheetOverlayPrimitive
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/45',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = 'left',
  ...props
}: ComponentProps<typeof SheetContentPrimitive> & { side?: 'left' | 'right' }) {
  return (
    <SheetPortalPrimitive data-slot="sheet-portal">
      <SheetOverlay />
      <SheetContentPrimitive
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'fixed inset-y-0 z-50 flex h-full w-[--spacing(72)] max-w-[85vw] flex-col gap-0 border-border bg-background shadow-lg transition ease-in-out',
          side === 'left' &&
            'left-0 border-r data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left',
          side === 'right' &&
            'right-0 border-l data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right',
          className,
        )}
        {...props}
      >
        {children}
      </SheetContentPrimitive>
    </SheetPortalPrimitive>
  )
}

function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1 p-4 text-left', className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: ComponentProps<typeof SheetTitlePrimitive>) {
  return (
    <SheetTitlePrimitive
      data-slot="sheet-title"
      className={cn('text-base font-semibold leading-tight text-foreground', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetDescriptionPrimitive>) {
  return (
    <SheetDescriptionPrimitive
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetTitle,
  SheetTrigger,
}
