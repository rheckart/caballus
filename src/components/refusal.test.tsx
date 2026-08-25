/**
 * The signed-out refusal is the one that carries an action, and its two
 * spellings — the constant `refusalText` answers and the JSX the link is built
 * into — must say exactly the same thing. This is what stops a reword of one
 * from leaving the other rendering half a sentence.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Refusal } from './refusal'
import { renderRoutes } from '../test/route-harness'
import { SIGNED_OUT } from '../shared/refusals'

describe('a refusal on screen', () => {
  it('passes an ordinary refusal straight through', () => {
    render(<Refusal>That horse is not here any more.</Refusal>)
    expect(screen.getByText('That horse is not here any more.')).toBeTruthy()
  })

  it('gives the signed-out one a link to the sign-in screen, and says the same words', async () => {
    renderRoutes(
      [
        { path: '/', component: () => <Refusal>{SIGNED_OUT}</Refusal> },
        { path: '/login', component: () => <p>Sign in</p> },
      ],
      '/',
    )
    const link = await screen.findByRole('link', { name: 'Sign in again' })
    expect(link.getAttribute('href')).toBe('/login')
    expect(link.closest('body')?.textContent).toContain(SIGNED_OUT)
  })
})
