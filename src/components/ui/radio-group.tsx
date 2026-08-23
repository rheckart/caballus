/** shadcn's RadioGroup (#61). */
import {
  Indicator as RadioGroupIndicatorPrimitive,
  Item as RadioGroupItemPrimitive,
  Root as RadioGroupRootPrimitive,
} from '@radix-ui/react-radio-group'
import { Circle } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '../../shared/cn'

function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupRootPrimitive>) {
  return (
    <RadioGroupRootPrimitive
      data-slot="radio-group"
      className={cn('grid gap-3', className)}
      {...props}
    />
  )
}

function RadioGroupItem({ className, ...props }: ComponentProps<typeof RadioGroupItemPrimitive>) {
  return (
    <RadioGroupItemPrimitive
      data-slot="radio-group-item"
      className={cn(
        'aspect-square size-[22px] shrink-0 rounded-full border border-input bg-background text-primary shadow-none transition-colors',
        'data-[state=checked]:border-primary',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    >
      <RadioGroupIndicatorPrimitive
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <Circle aria-hidden="true" className="absolute size-2.5 fill-primary" />
      </RadioGroupIndicatorPrimitive>
    </RadioGroupItemPrimitive>
  )
}

export { RadioGroup, RadioGroupItem }
