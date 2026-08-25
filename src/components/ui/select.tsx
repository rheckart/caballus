/**
 * shadcn's Select (#61) — a Radix listbox, not a `<select>`, which is why the
 * jsdom stubs in `src/test/setup-dom.ts` and the `chooseOption` helper in
 * `src/test/route-harness.tsx` exist (ADR 0025). The trigger is 44px tall at
 * its default size, DESIGN.md's touch floor.
 */
import {
  Content as SelectContentPrimitive,
  Group as SelectGroupPrimitive,
  Icon as SelectIconPrimitive,
  Item as SelectItemPrimitive,
  ItemIndicator as SelectItemIndicatorPrimitive,
  ItemText as SelectItemTextPrimitive,
  Label as SelectLabelPrimitive,
  Portal as SelectPortalPrimitive,
  Root as SelectRootPrimitive,
  ScrollDownButton as SelectScrollDownButtonPrimitive,
  ScrollUpButton as SelectScrollUpButtonPrimitive,
  Separator as SelectSeparatorPrimitive,
  Trigger as SelectTriggerPrimitive,
  Value as SelectValuePrimitive,
  Viewport as SelectViewportPrimitive,
} from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '../../shared/cn'

function Select(props: ComponentProps<typeof SelectRootPrimitive>) {
  return <SelectRootPrimitive data-slot="select" {...props} />
}

function SelectGroup(props: ComponentProps<typeof SelectGroupPrimitive>) {
  return <SelectGroupPrimitive data-slot="select-group" {...props} />
}

function SelectValue(props: ComponentProps<typeof SelectValuePrimitive>) {
  return <SelectValuePrimitive data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: ComponentProps<typeof SelectTriggerPrimitive> & {
  size?: 'sm' | 'default'
}) {
  return (
    <SelectTriggerPrimitive
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-base text-foreground shadow-none transition-colors whitespace-nowrap',
        'data-[size=default]:h-11 data-[size=sm]:h-9 data-[size=sm]:text-sm',
        'data-[placeholder]:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 outline-none',
        'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        '*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2',
        className,
      )}
      {...props}
    >
      {children}
      <SelectIconPrimitive asChild>
        <ChevronDown aria-hidden="true" className="size-4 opacity-50" />
      </SelectIconPrimitive>
    </SelectTriggerPrimitive>
  )
}

function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentProps<typeof SelectContentPrimitive>) {
  return (
    <SelectPortalPrimitive>
      <SelectContentPrimitive
        data-slot="select-content"
        className={cn(
          'relative z-50 max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-32 overflow-y-auto overflow-x-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectViewportPrimitive
          className={cn(
            'p-1',
            position === 'popper' &&
              'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1',
          )}
        >
          {children}
        </SelectViewportPrimitive>
        <SelectScrollDownButton />
      </SelectContentPrimitive>
    </SelectPortalPrimitive>
  )
}

function SelectLabel({ className, ...props }: ComponentProps<typeof SelectLabelPrimitive>) {
  return (
    <SelectLabelPrimitive
      data-slot="select-label"
      className={cn('px-2 py-1.5 text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectItemPrimitive>) {
  return (
    <SelectItemPrimitive
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-2 pl-2 pr-8 text-base outline-none',
        'focus:bg-secondary focus:text-secondary-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectItemIndicatorPrimitive>
          <Check aria-hidden="true" className="size-4" />
        </SelectItemIndicatorPrimitive>
      </span>
      <SelectItemTextPrimitive>{children}</SelectItemTextPrimitive>
    </SelectItemPrimitive>
  )
}

function SelectSeparator({ className, ...props }: ComponentProps<typeof SelectSeparatorPrimitive>) {
  return (
    <SelectSeparatorPrimitive
      data-slot="select-separator"
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: ComponentProps<typeof SelectScrollUpButtonPrimitive>) {
  return (
    <SelectScrollUpButtonPrimitive
      data-slot="select-scroll-up-button"
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronUp aria-hidden="true" className="size-4" />
    </SelectScrollUpButtonPrimitive>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: ComponentProps<typeof SelectScrollDownButtonPrimitive>) {
  return (
    <SelectScrollDownButtonPrimitive
      data-slot="select-scroll-down-button"
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronDown aria-hidden="true" className="size-4" />
    </SelectScrollDownButtonPrimitive>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
