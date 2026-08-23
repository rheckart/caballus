/**
 * Signing in, on a phone, outdoors, with gloves on.
 *
 * Two steps and one field each, because that is the whole of ADR 0009's
 * credential: an address the rescue already knows, then the six digits it
 * mailed there. A typed code rather than a tapped link, deliberately — a link
 * opened inside the Gmail app lands the session in an in-app browser while the
 * volunteer's real browser stays signed out, and they conclude the app is
 * broken (ADR 0009).
 *
 * Every refusal is said plainly, including *we do not know that address*. That
 * is ADR 0008's decision against the usual convention: enumerating a
 * sixty-person invite-only roster is not a meaningful threat, and the polite
 * version leaves somebody standing in a barn waiting for a code that a
 * mistyped character guaranteed would never arrive.
 */
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { requestSignInCode, submitSignInCode } from '../server/auth/login'

export const Route = createFileRoute('/login')({
  component: Login,
})

/** Which of the two steps the screen is on. */
type Step = { readonly name: 'address' } | { readonly name: 'code'; readonly email: string }

/** What each refusal says out loud. One sentence, and an action where there is one. */
const REFUSALS: Record<string, string> = {
  'unrecognised-email':
    'We do not have that address. Check it for a typo, or ask a coordinator to add you.',
  'volunteer-removed': 'That address belongs to somebody who has left the rescue.',
  'account-revoked': 'That account has been switched off. A coordinator can turn it back on.',
  'wrong-code': 'That code is wrong or has expired. Ask for a new one.',
  'email-not-sent': 'We could not send the email. Nothing has arrived — please tell the operator.',
  'too-many-codes': 'That is a lot of codes. Wait an hour, or check the ones already sent to you.',
}

/**
 * What a failed call says. Not a refusal — the server never answered at all,
 * which in a barn is usually the signal rather than the app.
 */
const UNREACHABLE = 'We could not reach the app. Check your signal and try again.'

function refusalText(because: string): string {
  return REFUSALS[because] ?? 'That did not work. Please try again.'
}

function Login() {
  const router = useRouter()
  const [step, setStep] = useState<Step>({ name: 'address' })
  const [problem, setProblem] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function askForCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = new FormData(event.currentTarget).get('email')
    if (typeof email !== 'string') return

    setWorking(true)
    setProblem(null)
    try {
      const asked = await requestSignInCode({ data: { email } })
      if (asked.sent) {
        setStep({ name: 'code', email })
      } else {
        setProblem(refusalText(asked.because))
      }
    } catch {
      // Without this the screen simply does nothing: the message was cleared,
      // the button re-enables, and the one failure a volunteer most needs
      // explained is the one that says nothing at all.
      setProblem(UNREACHABLE)
    } finally {
      setWorking(false)
    }
  }

  async function sendCode(event: FormEvent<HTMLFormElement>, email: string) {
    event.preventDefault()
    const code = new FormData(event.currentTarget).get('code')
    if (typeof code !== 'string') return

    setWorking(true)
    setProblem(null)
    try {
      const answered = await submitSignInCode({ data: { email, code } })
      // The server function answers with a `Response` so that the session's
      // cookie reaches the browser; the body is the same shape either way.
      const body = (await answered.json()) as { signedIn: boolean; because?: string }
      if (body.signedIn) {
        // A full navigation rather than a client-side one: the session arrived
        // as a cookie, and everything rendered before it did was rendered for
        // nobody.
        await router.invalidate()
        window.location.assign('/')
      } else {
        setProblem(refusalText(body.because ?? ''))
      }
    } catch {
      setProblem(UNREACHABLE)
    } finally {
      setWorking(false)
    }
  }

  return (
    <main className="centred-page">
      <h1>Caballus</h1>

      {step.name === 'address' ? (
        <form onSubmit={askForCode}>
          <label htmlFor="email">Your email address</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            required
          />
          <button type="submit" disabled={working}>
            {working ? 'Sending…' : 'Send me a code'}
          </button>
        </form>
      ) : (
        <form onSubmit={(event) => void sendCode(event, step.email)}>
          <p>
            We sent a six-digit code to <strong>{step.email}</strong>. It works for five minutes.
          </p>
          <label htmlFor="code">The code</label>
          <input
            id="code"
            name="code"
            // A numeric keypad on a phone, and the platform's own autofill for
            // a one-time code — which is most of what makes this bearable with
            // gloves on.
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            autoFocus
            required
          />
          <button type="submit" disabled={working}>
            {working ? 'Checking…' : 'Sign in'}
          </button>
          <button
            type="button"
            onClick={() => {
              setProblem(null)
              setStep({ name: 'address' })
            }}
          >
            Use a different address
          </button>
        </form>
      )}

      {/* Announced, not just shown: the screen is read aloud as often as it is
          read, and a refusal that only changes colour says nothing. */}
      {problem !== null && <p role="alert">{problem}</p>}
    </main>
  )
}
