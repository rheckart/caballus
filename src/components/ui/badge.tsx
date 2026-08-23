/**
 * shadcn's Badge (#61), with app.css's four tinted badges carried over as
 * variants — a card tint spent as an accent, which is the one way a tint may
 * be spent in dark (ADR 0025).
 */
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '../../shared/cn'

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-sm px-2 py-0.5 text-[13px] font-semibold leading-snug [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default:
          'bg-card-tint-gray text-secondary-foreground dark:bg-secondary dark:text-secondary-foreground',
        purple:
          'bg-card-tint-lavender text-brand-purple-800 dark:bg-transparent dark:border dark:border-card-tint-lavender/40 dark:text-card-tint-lavender',
        orange:
          'bg-card-tint-peach text-brand-orange-deep dark:bg-transparent dark:border dark:border-card-tint-peach/40 dark:text-card-tint-peach',
        green:
          'bg-card-tint-mint text-brand-green dark:bg-transparent dark:border dark:border-card-tint-mint/40 dark:text-card-tint-mint',
        blue: 'bg-card-tint-sky text-link-blue-pressed dark:bg-transparent dark:border dark:border-card-tint-sky/40 dark:text-card-tint-sky',
        destructive: 'bg-destructive text-destructive-foreground',
        outline: 'border border-border text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
