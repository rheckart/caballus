/**
 * Signing in, on a phone, outdoors, with gloves on.
 *
 * Two steps and one field each, because that is the whole of the credential:
 * something the rescue already knows, then the six digits it sent there.
 *
 * **The one field takes an email address or a mobile number** (#78, ADR 0029),
 * and the screen does not ask which — a segmented control here would be one
 * more thing to get wrong with gloves on, and the server already has to decide
 * (`looksLikeMobile`, shared so the two cannot disagree). What the screen does
 * do is name both in the label, so nobody stands there wondering whether their
 * number would work.
 *
 * A typed code rather than a tapped link, deliberately — a link opened inside
 * the Gmail app lands the session in an in-app browser while the volunteer's
 * real browser stays signed out, and they conclude the app is broken
 * (ADR 0009).
 *
 * Every refusal is said plainly, including *we do not know that address*. That
 * is ADR 0008's decision against the usual convention: enumerating a
 * sixty-person invite-only roster is not a meaningful threat, and the polite
 * version leaves somebody standing in a barn waiting for a code that a
 * mistyped character guaranteed would never arrive.
 */
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { PawPrint } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Alert, AlertTitle } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { requestSignInCode, submitSignInCode } from '../server/auth/login'
import { looksLikeMobile } from '../shared/mobile'

export const Route = createFileRoute('/login')({
  component: Login,
})

/** Which of the two steps the screen is on. */
type Step =
  | { readonly name: 'address' }
  | { readonly name: 'code'; readonly identifier: string; readonly byText: boolean }

/** What each refusal says out loud. One sentence, and an action where there is one. */
const REFUSALS: Record<string, string> = {
  'unrecognised-email':
    'We do not have that address. Check it for a typo, or ask a coordinator to add you.',
  'unrecognised-mobile':
    'We do not have that number. Check it for a typo, or ask a coordinator to add it.',
  'volunteer-removed': 'That belongs to somebody who has left the rescue.',
  'account-revoked': 'That account has been switched off. A coordinator can turn it back on.',
  'wrong-code': 'That code is wrong or has expired. Ask for a new one.',
  'email-not-sent': 'We could not send the email. Nothing has arrived — please tell the operator.',
  'sms-not-sent':
    'We could not send the text. Nothing has arrived — try your email address, or tell the operator.',
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

const LABEL = 'mb-1 block text-sm font-medium text-foreground'

function Login() {
  const router = useRouter()
  const [step, setStep] = useState<Step>({ name: 'address' })
  const [problem, setProblem] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function askForCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const identifier = new FormData(event.currentTarget).get('identifier')
    if (typeof identifier !== 'string') return

    setWorking(true)
    setProblem(null)
    try {
      const asked = await requestSignInCode({ data: { identifier } })
      if (asked.sent) {
        // Which way it went, so the next screen can say *check your texts*
        // rather than a sentence about an inbox nobody is looking at. The same
        // rule the server used, from the same module.
        setStep({ name: 'code', identifier, byText: looksLikeMobile(identifier) })
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

  async function sendCode(event: FormEvent<HTMLFormElement>, identifier: string) {
    event.preventDefault()
    const code = new FormData(event.currentTarget).get('code')
    if (typeof code !== 'string') return

    setWorking(true)
    setProblem(null)
    try {
      const answered = await submitSignInCode({ data: { identifier, code } })
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
    <main className="grid min-h-dvh max-w-none content-center justify-items-center px-4 py-8">
      {/* The mark, then the name. Field Signal's one piece of identity on a
          screen that is otherwise a single field: a volunteer opening this in
          a barn is checking they are in the right app before they type an
          address into it. */}
      <div className="mb-2 flex w-full max-w-[400px] flex-col items-center">
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground"
        >
          <PawPrint className="size-8" strokeWidth={2} />
        </span>
        <h1 className="mb-1 mt-4 text-center">Caballus</h1>
      </div>

      {step.name === 'address' ? (
        <form
          className="w-full max-w-[400px] rounded-lg border border-border bg-background p-6"
          onSubmit={askForCode}
        >
          <label htmlFor="identifier" className={LABEL}>
            Your email address or mobile number
          </label>
          <Input
            id="identifier"
            name="identifier"
            // `text` rather than `email`, and no `inputMode`: the browser's own
            // validation would refuse a phone number, and a keypad would make
            // an address unreachable. `autoComplete="username"` is what both
            // password managers and iOS use for a field that is either.
            type="text"
            autoComplete="username"
            autoFocus
            required
          />
          <Button type="submit" className="mt-4 w-full" disabled={working}>
            {working ? 'Sending…' : 'Send me a code'}
          </Button>
        </form>
      ) : (
        <form
          className="w-full max-w-[400px] rounded-lg border border-border bg-background p-6"
          onSubmit={(event) => void sendCode(event, step.identifier)}
        >
          <p className="mt-0 text-sm text-muted-foreground">
            We {step.byText ? 'texted' : 'sent'} a six-digit code to{' '}
            <strong>{step.identifier}</strong>. It works for a few minutes.
          </p>
          <label htmlFor="code" className={LABEL}>
            The code
          </label>
          <Input
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
          <Button type="submit" className="mt-4 w-full" disabled={working}>
            {working ? 'Checking…' : 'Sign in'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="mt-2 w-full"
            onClick={() => {
              setProblem(null)
              setStep({ name: 'address' })
            }}
          >
            Use something else
          </Button>
        </form>
      )}

      {/* Announced, not just shown: the screen is read aloud as often as it is
          read, and a refusal that only changes colour says nothing. */}
      {problem !== null && (
        <Alert variant="destructive" className="mt-4 w-full max-w-[400px]">
          <AlertTitle>{problem}</AlertTitle>
        </Alert>
      )}
    </main>
  )
}
