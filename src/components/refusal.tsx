/**
 * A refusal's words, with the one action a refusal can carry.
 *
 * `refusalText` answers a plain string and stays that way — it is read by
 * tests, by the queue and by code with no DOM anywhere near it. This is the
 * rendering half: everything passes straight through untouched, except the
 * signed-out sentence, which becomes the same sentence with *Sign in again*
 * as a link to `/login`.
 *
 * Why a component rather than a link at each site: a session ending is the one
 * refusal that can happen on **every** screen, and thirty-seven places
 * rendering `{problem}` inside an `AlertTitle` are thirty-seven places that
 * would each have to remember. Wrapping the text is the one change each of
 * them makes, and a screen added later gets it by copying its neighbour.
 */
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { SIGNED_OUT } from '../shared/refusals'

export function Refusal({ children }: { children: ReactNode }) {
  if (children !== SIGNED_OUT) return <>{children}</>

  // Spelled out rather than sliced out of the constant, because string surgery
  // on a sentence is a rename away from rendering nonsense. `refusal.test.tsx`
  // asserts the two say exactly the same thing, so they cannot drift.
  return (
    <>
      You have been signed out.{' '}
      <Link to="/login" className="font-semibold underline underline-offset-2">
        Sign in again
      </Link>{' '}
      to carry on.
    </>
  )
}
