/**
 * shadcn's Input (#61), adjusted: 44px tall and 16px type, because a phone in
 * a barn zooms the page on any smaller focus target (DESIGN.md's floor).
 */
import type { ComponentProps } from 'react'

import { cn } from '../../shared/cn'

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-base text-foreground shadow-none transition-colors',
        'placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground',
        'file:inline-flex file:h-8 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 outline-none',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
