/**
 * shadcn's Separator (#66, ADR 0025), source this repo owns. A hairline that
 * is `role="none"` by default — the rule between a sidebar's Destinations and
 * its account footer is a drawn line and not a landmark, and announcing it
 * would put a separator in the middle of a screen reader's navigation.
 */
import { Root as SeparatorPrimitive } from '@radix-ui/react-separator'
import type { ComponentProps } from 'react'

import { cn } from '../../shared/cn'

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: ComponentProps<typeof SeparatorPrimitive>) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className,
      )}
      {...props}
    />
  )
}

export { Separator }
