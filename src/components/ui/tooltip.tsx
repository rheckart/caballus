/**
 * shadcn's Tooltip (#66, ADR 0025), source this repo owns.
 *
 * It exists for exactly one thing: a sidebar collapsed to its icons still has
 * to say what an icon means. It is **never** the only place a fact is written
 * — DESIGN.md's rule that an icon carries a word beside it holds everywhere a
 * finger can reach, and a tooltip answers to a pointer that a phone does not
 * have. The collapsed rail is a desk affordance, and this is its label.
 */
import {
  Content as TooltipContentPrimitive,
  Portal as TooltipPortalPrimitive,
  Provider as TooltipProviderPrimitive,
  Root as TooltipRootPrimitive,
  Trigger as TooltipTriggerPrimitive,
} from '@radix-ui/react-tooltip'
import type { ComponentProps } from 'react'

import { cn } from '../../shared/cn'

function TooltipProvider({
  delayDuration = 0,
  ...props
}: ComponentProps<typeof TooltipProviderPrimitive>) {
  return (
    <TooltipProviderPrimitive
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip(props: ComponentProps<typeof TooltipRootPrimitive>) {
  return <TooltipRootPrimitive data-slot="tooltip" {...props} />
}

function TooltipTrigger(props: ComponentProps<typeof TooltipTriggerPrimitive>) {
  return <TooltipTriggerPrimitive data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof TooltipContentPrimitive>) {
  return (
    <TooltipPortalPrimitive>
      <TooltipContentPrimitive
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-md border border-border bg-popover px-2.5 py-1.5 text-sm text-popover-foreground shadow-md',
          'data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      />
    </TooltipPortalPrimitive>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
