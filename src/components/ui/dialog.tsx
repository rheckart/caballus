/**
 * shadcn's Dialog (#61, ADR 0025) — the component `Sheet` in
 * `src/components/forms.tsx` now wraps. On a phone the content sits at the
 * bottom of the screen like the sheet it replaced; on a desktop it centres.
 *
 * The close button is icon *plus word*, never the icon alone (ADR 0025).
 */
import {
  Close as DialogClosePrimitive,
  Content as DialogContentPrimitive,
  Description as DialogDescriptionPrimitive,
  Overlay as DialogOverlayPrimitive,
  Portal as DialogPortalPrimitive,
  Root as DialogRootPrimitive,
  Title as DialogTitlePrimitive,
  Trigger as DialogTriggerPrimitive,
} from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '../../shared/cn'

function Dialog(props: ComponentProps<typeof DialogRootPrimitive>) {
  return <DialogRootPrimitive data-slot="dialog" {...props} />
}

function DialogTrigger(props: ComponentProps<typeof DialogTriggerPrimitive>) {
  return <DialogTriggerPrimitive data-slot="dialog-trigger" {...props} />
}

function DialogPortal(props: ComponentProps<typeof DialogPortalPrimitive>) {
  return <DialogPortalPrimitive data-slot="dialog-portal" {...props} />
}

function DialogClose(props: ComponentProps<typeof DialogClosePrimitive>) {
  return <DialogClosePrimitive data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogOverlayPrimitive>) {
  return (
    <DialogOverlayPrimitive
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/45',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: ComponentProps<typeof DialogContentPrimitive> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogContentPrimitive
        data-slot="dialog-content"
        className={cn(
          // The phone's sheet: full width, risen from the bottom, actions in
          // thumb reach. From 640px up it is the centred panel.
          //
          // `bottom` is not 0, because a fixed element is positioned against
          // the *large* viewport — the one with the browser's own toolbar
          // hidden — so on a phone showing that toolbar the last few
          // centimetres of the sheet sit behind it, whether the bar is at the
          // top (the page is pushed down) or at the bottom (it covers). The
          // gap is exactly `100lvh - 100dvh`, which is zero the moment the
          // toolbar goes away and on every desktop.
          'fixed bottom-[calc(100lvh-100dvh)] left-0 right-0 z-50 flex max-h-[90dvh] w-full flex-col gap-3 overflow-y-auto overscroll-contain rounded-t-xl border border-border bg-background p-4 pb-[calc(--spacing(4)+env(safe-area-inset-bottom,0px))] shadow-lg',
          'sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:max-h-[86dvh] sm:w-full sm:max-w-[640px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:gap-4 sm:rounded-lg sm:p-6',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogClosePrimitive
            data-slot="dialog-close"
            className="absolute right-3 top-3 inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none disabled:pointer-events-none sm:right-4 sm:top-4"
          >
            <X aria-hidden="true" className="size-4" />
            Close
          </DialogClosePrimitive>
        )}
      </DialogContentPrimitive>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1 pr-24 text-left', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-wrap items-center gap-2 border-t border-border pt-4', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogTitlePrimitive>) {
  return (
    <DialogTitlePrimitive
      data-slot="dialog-title"
      className={cn('text-xl font-semibold leading-tight text-foreground', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogDescriptionPrimitive>) {
  return (
    <DialogDescriptionPrimitive
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
