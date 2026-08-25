/**
 * shadcn's class combiner (#61): clsx for the conditionals, tailwind-merge so
 * a caller's `bg-x` beats a component's default `bg-y` instead of tying.
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
