/**
 * The terms and conditions, at the UI seam (#80, ADR 0028).
 *
 * The same claim `privacy.test.tsx` makes, against a longer required list:
 * 10DLC vetting wants the programme described, the frequency, the rates
 * disclosure, HELP, STOP, the carrier-liability line and a link to the privacy
 * policy. Each is asserted by its words, because losing one to an edit costs a
 * campaign review rather than a broken screen anybody would notice.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RATES } from '../components/public'
import { renderRoutes } from '../test/route-harness'
import { Route } from './terms'

const component = Route.options.component

async function renderTerms() {
  if (component === undefined) throw new Error('The route has no component.')
  const rendered = renderRoutes(
    [
      { path: '/terms', component },
      { path: '/', component: () => null },
      { path: '/privacy', component: () => null },
    ],
    '/terms',
  )
  // The router resolves a route asynchronously, so nothing is in the document
  // until it has: every test below waits on the page's own heading first.
  await screen.findByRole('heading', { name: 'Terms and conditions' })
  return rendered
}

describe('the list a carrier looks for', () => {
  it('describes the programme and names the two cases it carries', async () => {
    await renderTerms()

    expect(screen.getByText('Caballus Volunteer Alerts')).toBeTruthy()
    expect(screen.getByText(/shift you could work is short of people/)).toBeTruthy()
    expect(screen.getByText(/rescue news that will not keep/)).toBeTruthy()
    // The closed list, said out loud — ADR 0028 is emphatic that it is closed.
    expect(screen.getByText(/in two situations, and no others/)).toBeTruthy()
  })

  it('states the frequency and the rates disclosure', async () => {
    await renderTerms()

    expect(screen.getByText(/Message frequency varies and is low/)).toBeTruthy()
    expect(screen.getByText(new RegExp(RATES))).toBeTruthy()
  })

  it('says how to get help and how to stop', async () => {
    await renderTerms()

    expect(screen.getByText('HELP')).toBeTruthy()
    expect(screen.getByText('STOP')).toBeTruthy()
    expect(screen.getByText(/never locks you out of the application/)).toBeTruthy()
    // Opting back in, which the STOP paragraph on its own leaves as a dead end.
    expect(screen.getByText(/Starting again/)).toBeTruthy()
  })

  it('says carriers are not liable for a message that did not arrive', async () => {
    await renderTerms()

    expect(
      screen.getByText(/Carriers are not liable for delayed or undelivered messages/),
    ).toBeTruthy()
  })

  it('links the privacy policy', async () => {
    await renderTerms()

    expect(screen.getByRole('link', { name: 'privacy policy' })).toBeTruthy()
  })
})

describe('the rest of what it has to say', () => {
  it('names the operator and says there is no public sign-up', async () => {
    await renderTerms()

    expect(screen.getByText('Rob Heckart')).toBeTruthy()
    expect(
      screen.getByText(/no public sign-up and no way to join by texting a keyword/),
    ).toBeTruthy()
  })

  it('says a real emergency is a phone call', async () => {
    // ADR 0028 refuses colic as a case on exactly this reasoning: the failure
    // is somebody typing into the app, feeling finished, and not dialling.
    await renderTerms()

    expect(screen.getByText(/A real emergency is a phone call, not a text./)).toBeTruthy()
  })
})
