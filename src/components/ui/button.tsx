/**
 * shadcn's Button (#61, ADR 0025), source this repo owns.
 *
 * Field Signal's own rule about height, which is two rules rather than one:
 * **on the phone a hit target never goes under 44px** — the default — **and
 * the one primary action on a screen is 52px** (`lg`), because it is pressed
 * with a glove on. **At the desk a control is 40px** (`sm`), because it is
 * pressed with a mouse and a 44px row of buttons above a table reads as a
 * toolbar rather than as a page. `rounded-md` is 12px now; still rectangles,
 * never pills — a pill in this system is a *status*, not something you press.
 */
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '../../shared/cn'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-pressed',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background text-foreground hover:bg-secondary',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-secondary hover:text-secondary-foreground',
        link: 'text-link underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-4.5 py-2',
        sm: 'h-10 rounded-md px-3.5',
        lg: 'h-13 rounded-md px-6 text-base',
        icon: 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
