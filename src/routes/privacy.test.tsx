/**
 * The privacy policy, at the UI seam (#80, ADR 0028).
 *
 * What is claimed here is not *the page renders* — it is that **the three
 * things 10DLC vetting requires are still on it**. A rewording that drops the
 * non-sharing sentence, the frequency note or the rates disclosure fails a
 * campaign review a fortnight later, in an email nobody reading a diff would
 * connect back to it, so the three are asserted by their exact words.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NO_SHARING, RATES } from '../components/public'
import { renderRoutes } from '../test/route-harness'
import { Route } from './privacy'

const component = Route.options.component

async function renderPrivacy() {
  if (component === undefined) throw new Error('The route has no component.')
  const rendered = renderRoutes(
    [
      { path: '/privacy', component },
      { path: '/', component: () => null },
      { path: '/terms', component: () => null },
    ],
    '/privacy',
  )
  // The router resolves a route asynchronously, so nothing is in the document
  // until it has: every test below waits on the page's own heading first.
  await screen.findByRole('heading', { name: 'Privacy policy' })
  return rendered
}

describe('the three things a carrier looks for', () => {
  it('states, in the carrier’s own wording, that mobile numbers are not shared', async () => {
    await renderPrivacy()

    expect(screen.getByText(NO_SHARING)).toBeTruthy()
    // The plain-English restatement beside it, for the other reader — a
    // volunteer, for whom the sentence above is not written.
    expect(screen.getByText(/not sold, not\s+rented/)).toBeTruthy()
  })

  it('notes how often messages are sent', async () => {
    await renderPrivacy()

    expect(screen.getByText(/Message frequency varies and is low/)).toBeTruthy()
    // The cap in `src/server/sms.ts`, stated where the person receiving them
    // reads it rather than only in the ADR.
    expect(screen.getByText(/more than 120 in any twenty-four hours/)).toBeTruthy()
  })

  it('carries the message and data rates disclosure', async () => {
    await renderPrivacy()

    expect(screen.getByText(RATES)).toBeTruthy()
  })
})

describe('the rest of what it has to say', () => {
  it('names the operator and says there is no public sign-up', async () => {
    await renderPrivacy()

    expect(screen.getByText('Rob Heckart')).toBeTruthy()
    expect(screen.getByText(/There is no public sign-up/)).toBeTruthy()
  })

  it('says stopping the texts never stops you signing in', async () => {
    // ADR 0029's separation, stated where the person affected reads it.
    await renderPrivacy()

    expect(screen.getByText(/stopping\s+the alerts never stops you signing in/)).toBeTruthy()
  })

  it('names who outside the rescue is given anything', async () => {
    await renderPrivacy()

    for (const processor of ['Twilio', 'Our mail provider', 'Our hosting provider']) {
      expect(screen.getByText(processor)).toBeTruthy()
    }
  })

  it('gives somewhere to write, and a way to the other public pages', async () => {
    await renderPrivacy()

    expect(screen.getAllByRole('link', { name: 'rob@heckart.me' })[0]?.getAttribute('href')).toBe(
      'mailto:rob@heckart.me',
    )
    expect(screen.getByRole('link', { name: 'Terms and conditions' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'About Caballus' })).toBeTruthy()
  })
})
