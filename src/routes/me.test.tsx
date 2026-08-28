/**
 * Your own details, at the UI seam: the real route component, the real typed
 * client, and only `fetch` stubbed (#32's testing decisions, #68).
 *
 * What is claimed here. **The wire carries three fields and no more** — a save
 * of name and mobile sends `name`, `mobile` and the key, and neither a
 * `volunteerId` nor a `reason`, which is ADR 0027's whole argument spelled as
 * an assertion about a request body: the subject is the actor, so there is no
 * field to name somebody else in, and nobody will ever ask why you changed your
 * own phone number. **A blank mobile is null**, because blank and absent are
 * one fact about a phone number.
 *
 * **The email is two steps, and the first one changes nothing.** Asking for a
 * code posts to `/me/email/code` and reaches `/me/email` not at all — until the
 * code comes back the old address still signs in, which is the lockout ADR 0027
 * exists to prevent — and the code is submitted against the address it was sent
 * to rather than whatever is in the box by then. A refused code leaves the
 * volunteer on the code step with the sentence, because the next thing they do
 * is type it again.
 *
 * **The six fields that are somebody else's statement are absent and said to be
 * absent.** A screen that merely lacks the orientation date reads as an app
 * that lost it, so the omission is asserted alongside the sentence that sends
 * the volunteer to a coordinator.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { answeredNothing, refused, stubApi } from '../test/api-stub'
import { renderRoute } from '../test/route-harness'
import { Route } from './me'

afterEach(() => {
  vi.unstubAllGlobals()
})

const component = Route.options.component

function renderMe() {
  if (component === undefined) throw new Error('The route has no component.')
  return renderRoute('/me', component)
}

function me(overrides: Record<string, unknown> = {}) {
  return {
    volunteerId: 'beth',
    name: 'Beth Ann',
    email: 'beth@barn.test',
    mobile: '410-555-0100',
    domainScopes: [],
    ...overrides,
  }
}

/** The two writes' bodies, as JSON the assertions can read field by field. */
function bodyOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

describe('the Your details screen', () => {
  it('shows your name, your number and the address you sign in at', async () => {
    stubApi({ '/me': me() })
    renderMe()

    expect(await screen.findByLabelText('Name')).toHaveProperty('value', 'Beth Ann')
    expect(screen.getByText('beth@barn.test')).toBeTruthy()
    // The number is shown rather than sitting in an editable box beside the
    // name: since #78 it is a credential, and moving it takes a code.
    expect(screen.getByText(/Your number is 410-555-0100/)).toBeTruthy()
  })

  it('saves the name with no volunteerId and no reason on the wire', async () => {
    let posted: Record<string, unknown> | null = null
    stubApi({
      '/me': me(),
      '/me/contact-details': (init: RequestInit) => {
        posted = bodyOf(init)
        return answeredNothing()
      },
    })
    renderMe()

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Beth Kelly' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(posted).toMatchObject({ name: 'Beth Kelly' })
    })
    // The point of the test: no field on the wire could name another person,
    // and none could carry an explanation of a decision about one. The mobile
    // left this write with #78 — an unverified move is the lockout ADR 0027
    // built the address flow to prevent.
    expect(Object.keys(posted ?? {}).sort()).toEqual(['idempotencyKey', 'name'])
  })
})

/**
 * Changing the number you sign in with (#78, ADR 0029) — the shape the address
 * already had, for the field that became a credential.
 */
describe('changing the number you sign in with', () => {
  it('asks for a code at the new number and changes nothing yet', async () => {
    let posted: Record<string, unknown> | null = null
    stubApi({
      '/me': me(),
      '/me/mobile/code': (init: RequestInit) => {
        posted = bodyOf(init)
        return answeredNothing()
      },
    })
    renderMe()

    fireEvent.change(await screen.findByLabelText('New number'), {
      target: { value: '410-555-0199' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }))

    await waitFor(() => {
      expect(posted).toMatchObject({ mobile: '410-555-0199' })
    })
    // Nothing has moved: the screen still shows the old number.
    expect(screen.getByText(/Your number is 410-555-0100/)).toBeTruthy()
  })

  it('moves the number only when the code comes back', async () => {
    let posted: Record<string, unknown> | null = null
    stubApi({
      '/me': me(),
      '/me/mobile/code': () => answeredNothing(),
      '/me/mobile': (init: RequestInit) => {
        posted = bodyOf(init)
        return answeredNothing()
      },
    })
    renderMe()

    fireEvent.change(await screen.findByLabelText('New number'), {
      target: { value: '410-555-0199' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }))

    fireEvent.change(await screen.findByLabelText('Code'), { target: { value: '481920' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change my number' }))

    await waitFor(() => {
      expect(posted).toMatchObject({ mobile: '410-555-0199', code: '481920' })
    })
  })

  it('gives the number up with no code at all', async () => {
    let posted: Record<string, unknown> | null = null
    stubApi({
      '/me': me(),
      '/me/mobile/removal': (init: RequestInit) => {
        posted = bodyOf(init)
        return answeredNothing()
      },
    })
    renderMe()

    fireEvent.click(await screen.findByRole('button', { name: 'Remove my number' }))

    // Verification exists to stop somebody being locked out by a number they
    // cannot receive at; giving one up cannot lock anybody out.
    await waitFor(() => {
      expect(posted).not.toBeNull()
    })
    expect(Object.keys(posted ?? {})).toEqual(['idempotencyKey'])
  })

  it('offers nothing to remove when there is no number on file', async () => {
    stubApi({ '/me': me({ mobile: null }) })
    renderMe()

    await screen.findByText(/You have no number on file/)
    expect(screen.queryByRole('button', { name: 'Remove my number' })).toBeNull()
  })
})

describe('changing the address you sign in with', () => {
  it('asks for a code and changes nothing yet', async () => {
    let asked: Record<string, unknown> | null = null
    let applied = 0
    stubApi({
      '/me': me(),
      '/me/email/code': (init: RequestInit) => {
        asked = bodyOf(init)
        return answeredNothing()
      },
      '/me/email': () => {
        applied += 1
        return { sessionsEnded: 0 }
      },
    })
    renderMe()

    fireEvent.change(await screen.findByLabelText('New address'), {
      target: { value: 'beth@home.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }))

    expect(await screen.findByLabelText('Code')).toBeTruthy()
    expect(asked).toMatchObject({ email: 'beth@home.test' })
    // The address the code went to is named on the screen, because a code that
    // arrived somewhere the volunteer did not expect is the one they should
    // not type.
    expect(screen.getByText('beth@home.test')).toBeTruthy()
    // Nothing has moved: until the code comes back the old address still
    // signs in, which is what the screen says and what this asserts.
    expect(applied).toBe(0)
  })

  it('submits the code against the address the code was sent to, and says who was signed out', async () => {
    let confirmed: Record<string, unknown> | null = null
    // The re-read after the change answers the new address, the way the server
    // would — the sentence is about `/me`, not about what was typed.
    let current = me()
    stubApi({
      '/me': () => current,
      '/me/email/code': answeredNothing,
      '/me/email': (init: RequestInit) => {
        confirmed = bodyOf(init)
        current = me({ email: 'beth@home.test' })
        return { sessionsEnded: 2 }
      },
    })
    renderMe()

    fireEvent.change(await screen.findByLabelText('New address'), {
      target: { value: 'beth@home.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }))

    fireEvent.change(await screen.findByLabelText('Code'), { target: { value: '314159' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change my address' }))

    const said = await screen.findByRole('status')
    expect(said.textContent).toMatch(/Your address is now beth@home\.test/)
    expect(said.textContent).toMatch(/2 other devices were signed out/)
    expect(confirmed).toMatchObject({ email: 'beth@home.test', code: '314159' })
  })

  it('says a wrong code in words and leaves the volunteer on the code step', async () => {
    stubApi({
      '/me': me(),
      '/me/email/code': answeredNothing,
      '/me/email': refused('wrong_code'),
    })
    renderMe()

    fireEvent.change(await screen.findByLabelText('New address'), {
      target: { value: 'beth@home.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }))

    fireEvent.change(await screen.findByLabelText('Code'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change my address' }))

    expect(
      await screen.findByText('That code is not right. Check the message and try again.'),
    ).toBeTruthy()
    // Still on the code step, because typing it again is the next thing a
    // volunteer who fat-fingered a digit does.
    expect(screen.getByLabelText('Code')).toBeTruthy()
  })

  it('does not advance to the code step when the code was never sent', async () => {
    stubApi({
      '/me': me(),
      '/me/email/code': refused('email_taken'),
    })
    renderMe()

    fireEvent.change(await screen.findByLabelText('New address'), {
      target: { value: 'kate@barn.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }))

    expect(await screen.findByText('Somebody at the rescue already has that address.')).toBeTruthy()
    // A code box for a code nobody was sent is a box that can only ever refuse.
    expect(screen.queryByLabelText('Code')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send me a code' })).toBeTruthy()
  })
})

describe('what this screen deliberately cannot edit', () => {
  it('offers no control for the six facts somebody else has to state, and says where they live', async () => {
    stubApi({ '/me': me() })
    renderMe()

    await screen.findByLabelText('Name')
    for (const somebodyElses of [
      'Orientation',
      'Release',
      'Consent',
      'Date of birth',
      'Role',
      'Medication authority',
    ]) {
      expect(screen.queryByLabelText(new RegExp(somebodyElses, 'i'))).toBeNull()
    }
    expect(screen.getByText(/recorded by a coordinator and are not editable here/)).toBeTruthy()
  })

  it('tells a signed-out visitor to sign in rather than showing an empty form', async () => {
    stubApi({ '/me': refused('not_authorized', 401) })
    renderMe()

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Sign in to see your details.',
    )
    expect(screen.queryByLabelText('Name')).toBeNull()
    expect(screen.queryByLabelText('New address')).toBeNull()
  })
})
