/** shadcn's Checkbox (#61), at app.css's own 22px so a gloved thumb finds it. */
import {
  Indicator as CheckboxIndicatorPrimitive,
  Root as CheckboxRootPrimitive,
} from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import type { ComponentProps } from 'react'

import { cn } from '../../shared/cn'

function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxRootPrimitive>) {
  return (
    <CheckboxRootPrimitive
      data-slot="checkbox"
      className={cn(
        'peer size-[22px] shrink-0 rounded-xs border border-input bg-background shadow-none transition-colors',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    >
      <CheckboxIndicatorPrimitive
        data-slot="checkbox-indicator"
        className="grid place-items-center text-current"
      >
        <Check aria-hidden="true" className="size-4" />
      </CheckboxIndicatorPrimitive>
    </CheckboxRootPrimitive>
  )
}

export { Checkbox }
