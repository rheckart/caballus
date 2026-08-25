/**
 * shadcn's Skeleton (#66, ADR 0025), source this repo owns.
 *
 * A grey block standing where content will be, for the one loading state in
 * this application that is worth drawing rather than wording: Home is opened
 * cold, on a phone, on barn signal, and *Loading…* on a blank screen there
 * reads as an app that has not started (#67).
 */
import type { ComponentProps } from 'react'

import { cn } from '../../shared/cn'

function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-secondary', className)}
      {...props}
    />
  )
}

export { Skeleton }
