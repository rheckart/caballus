/**
 * Your own details (#68, ADR 0027).
 *
 * Nothing in this application let a person change anything about themselves
 * before this screen. Every write about a Volunteer took a `volunteerId`, sat
 * behind `roster` and demanded a `reason`, so a volunteer whose mobile number
 * changed had to find a Coordinator.
 *
 * **Three fields and no more.** Orientation, Consent, Release, date of birth,
 * Roles and Medication Authority are all statements somebody *else* has to make
 * — a Release is already never self-recorded for exactly this reason (ADR
 * 0017) — so none of them is on this screen, and the server refuses them here
 * whether or not it is.
 *
 * **Name and mobile commit immediately. The email is the credential**, and it
 * takes a code at the **new** address first: `volunteers.email` is what decides
 * whether a sign-in code is sent at all, so moving it without proving the inbox
 * is a permanent lockout only a Coordinator can undo. Until the code comes
 * back, nothing has changed and the old address still signs in — which is what
 * both the screen and the message say.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { Actions, Field, Fields } from '../components/forms'
import { Refusal } from '../components/refusal'
import { Alert, AlertTitle } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ApiError, client } from '../shared/api-client'
import { refusalText } from '../shared/refusals'
import type { Answers, contract } from '../shared/api-contract'

export const Route = createFileRoute('/me')({
  component: MyDetails,
})

type Me = Answers<typeof contract, '/me'>

/**
 * Where the email form is. `asking` is the second step and carries the address
 * the code went to, so the confirm form cannot be submitted against a different
 * one than the one that was verified.
 */
type EmailStep =
  | { readonly step: 'idle' }
  | { readonly step: 'asking'; readonly email: string }
  | { readonly step: 'changed'; readonly sessionsEnded: number }

function MyDetails() {
  const [me, setMe] = useState<Me | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [email, setEmail] = useState<EmailStep>({ step: 'idle' })

  const load = useCallback(async () => {
    setMe(await client.get('/me'))
  }, [])

  useEffect(() => {
    void load().catch((error: unknown) => {
      setMissing(
        error instanceof ApiError && error.status === 401
          ? 'Sign in to see your details.'
          : refusalText(error),
      )
    })
  }, [load])

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      setProblem(null)
      try {
        await work()
        await load()
        return true
      } catch (error: unknown) {
        setProblem(refusalText(error))
        return false
      }
    },
    [load],
  )

  if (missing !== null) {
    return (
      <main>
        <h1>Your details</h1>
        <p role="alert">{missing}</p>
      </main>
    )
  }

  if (me === null) {
    return (
      <main>
        <h1>Your details</h1>
        <p>One moment…</p>
      </main>
    )
  }

  return (
    <main>
      <h1>Your details</h1>

      {problem !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </Alert>
      )}

      <section className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
        <h2 className="m-0">Name and mobile</h2>
        <p className="text-sm text-muted-foreground">
          These commit as soon as you save. Nobody is asked why.
        </p>
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            const mobile = String(data.get('mobile') ?? '').trim()
            setSaved(false)
            void act(() =>
              client.post('/me/contact-details', {
                name: String(data.get('name') ?? ''),
                mobile: mobile === '' ? null : mobile,
              }),
            ).then((ok) => {
              setSaved(ok)
            })
          }}
        >
          <Fields>
            <Field label="Name" htmlFor="my-name">
              <Input id="my-name" name="name" required maxLength={200} defaultValue={me.name} />
            </Field>
            <Field label="Mobile" htmlFor="my-mobile">
              <Input id="my-mobile" name="mobile" maxLength={60} defaultValue={me.mobile ?? ''} />
            </Field>
          </Fields>
          <Actions>
            <Button type="submit">Save</Button>
            {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
          </Actions>
        </form>
      </section>

      <section className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
        <h2 className="m-0">Sign-in address</h2>
        <p className="text-sm text-muted-foreground">
          You sign in at <strong>{me.email}</strong>. Changing it takes a code sent to the new
          address — until you enter that code, nothing changes and the old address still works.
        </p>

        {email.step === 'changed' && (
          <p role="status">
            Your address is now <strong>{me.email}</strong>. We told the old one.
            {email.sessionsEnded > 0 &&
              ` ${String(email.sessionsEnded)} other device${email.sessionsEnded === 1 ? ' was' : 's were'} signed out.`}
          </p>
        )}

        {email.step !== 'asking' && (
          <form
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const wanted = String(new FormData(event.currentTarget).get('email') ?? '').trim()
              void act(() => client.post('/me/email/code', { email: wanted })).then((ok) => {
                if (ok) setEmail({ step: 'asking', email: wanted })
              })
            }}
          >
            <Fields>
              <Field label="New address" htmlFor="my-email">
                <Input id="my-email" name="email" type="email" required maxLength={320} />
              </Field>
            </Fields>
            <Actions>
              <Button type="submit">Send me a code</Button>
            </Actions>
          </form>
        )}

        {email.step === 'asking' && (
          <form
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const code = String(new FormData(event.currentTarget).get('code') ?? '')
              setProblem(null)
              void client.post('/me/email', { email: email.email, code }).then(
                (answered) => {
                  // The step moves off the write's own answer and **before**
                  // the re-read, deliberately. The code is spent the moment
                  // the server takes it, and a failed `/me` after that would
                  // otherwise leave the screen asking for a code that can
                  // only ever answer *already used* — with the address in
                  // fact moved and every other session already ended.
                  setEmail({ step: 'changed', sessionsEnded: answered.sessionsEnded })
                  void load().catch(() => {
                    setProblem(
                      'Your address changed, but this screen could not reload. Pull to refresh.',
                    )
                  })
                },
                (error: unknown) => {
                  setProblem(refusalText(error))
                },
              )
            }}
          >
            <p className="text-sm text-muted-foreground">
              We sent a six-digit code to <strong>{email.email}</strong>. It works for five minutes.
            </p>
            <Fields>
              <Field label="Code" htmlFor="my-email-code">
                <Input
                  id="my-email-code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={20}
                />
              </Field>
            </Fields>
            <Actions>
              <Button type="submit">Change my address</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEmail({ step: 'idle' })
                }}
              >
                Cancel
              </Button>
            </Actions>
          </form>
        )}
      </section>

      {/* Named rather than silently absent, because a volunteer who came here
          to fix their orientation date needs to be told where it lives — a
          screen that simply lacks the field reads as an app that lost it. */}
      <p className="text-sm text-muted-foreground">
        Your orientation, release, consent, date of birth, roles and medication authority are
        recorded by a coordinator and are not editable here. Each of them is somebody else&rsquo;s
        statement about you, which is the point of them.
      </p>
    </main>
  )
}
