/**
 * shadcn's Table (#61). The wrapper div is the sideways scroller on a phone —
 * app.css did this with `display: block` on the table itself; here the
 * element keeps its table display and the container scrolls.
 */
import type { ComponentProps } from 'react'

import { cn } from '../../shared/cn'

function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn(
          'mb-4 w-full caption-bottom rounded-md border border-border bg-background text-sm',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead data-slot="table-header" className={cn('[&_tr]:border-b-0', className)} {...props} />
  )
}

function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-border transition-colors data-[state=selected]:bg-card-tint-lavender dark:data-[state=selected]:bg-secondary',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'whitespace-nowrap border-b border-border bg-secondary px-4 py-3 text-left align-middle text-[11px] font-semibold uppercase tracking-widest text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('px-4 py-3 align-top', className)} {...props} />
}

function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-2 text-left text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow }
