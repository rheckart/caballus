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
        // The overlay is also the frame the panel is laid out in, which is
        // what keeps a sheet from ever running off the bottom of a phone.
        //
        // A fixed box's *bottom* is the bottom of the large viewport — the
        // one measured with the browser's own toolbar hidden — so anything
        // anchored to it hides behind that toolbar. Its *top* is never wrong.
        // So the frame is measured downward from the top, `100dvh` tall, which
        // is the height actually on screen right now; the panel is a flex item
        // sitting at the end of it and inherits a bottom that is always
        // visible, with no viewport arithmetic of its own.
        'fixed inset-0 z-50 flex h-[100dvh] items-end justify-center overflow-hidden bg-black/45',
        'sm:items-center sm:p-6',
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
      {/*
        The panel is nested *inside* the overlay rather than sitting beside
        it, which is Radix's own arrangement for a dialog that has to fit a
        viewport. `max-h-full` is then the frame's height and nothing else —
        no `dvh` on the panel, no `translate`, no `bottom` — so the sheet
        cannot be taller than the screen it is on, whatever the browser is
        doing with its toolbar. Clicking the overlay still closes: the target
        is outside the content node, which is all Radix asks.
      */}
      <DialogOverlay>
        <DialogContentPrimitive
          data-slot="dialog-content"
          className={cn(
            // The phone's sheet: full width, risen from the bottom, actions in
            // thumb reach. From 640px up it is the centred panel.
            'relative flex max-h-full w-full flex-col gap-3 overflow-y-auto overscroll-contain rounded-t-xl border border-border bg-background p-4 pb-[calc(--spacing(4)+env(safe-area-inset-bottom,0px))] shadow-lg',
            'sm:max-w-[640px] sm:gap-4 sm:rounded-lg sm:p-6',
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
      </DialogOverlay>
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
