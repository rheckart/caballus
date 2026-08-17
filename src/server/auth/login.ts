/**
 * The transport for signing in, and the one place in this application that is
 * allowed a server function (ADR 0016's first exemption, written down before
 * this file existed).
 *
 * The reason is the exemption's: **signing in is a credential exchange that
 * must never be replayed from a queue.** Every other write in the system POSTs
 * to `/api/v1` behind an idempotency key precisely so that it *can* be sent
 * twice from a phone in a barn (ADR 0005) — and a six-digit code is the one
 * payload for which that is the wrong promise. A code is spent once, and a
 * queue that retried one would be retrying a credential.
 *
 * There is a second reason the API layer could not carry this even if the
 * first were waved through: a sign-in answers with a `Set-Cookie`, and
 * `ApiResponse` deliberately cannot express one (ADR 0020, #30). A stored
 * answer is rebuilt from a status and a body, and a session handed back from
 * the replay of a stored answer would be a session nobody authenticated for.
 *
 * The decisions are all in `./sign-in.ts`. What is here is the shell: parse,
 * call, and put the headers on the way out.
 */
import { createMiddleware, createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { currentOrgId } from '../request-context'
import { requestCode, signOut, submitCode } from './sign-in'

/**
 * Shapes checked at the boundary, because a server function's input is
 * whatever the browser posted. Loose on the address on purpose — `z.email()`
 * would refuse before the gate could say *we do not know that address*, which
 * is the answer ADR 0008 chose to give a volunteer who mistyped.
 */
const asked = z.object({ email: z.string().min(1).max(320) })
const answered = asked.extend({ code: z.string().min(1).max(16) })

/** Asks for a code. Answers whether one is coming, and if not, why not. */
export const requestSignInCode = createServerFn({ method: 'POST' })
  .validator((data: unknown) => asked.parse(data))
  .handler(({ data }) => requestCode(currentOrgId(), data.email))

/**
 * Exchanges a code for a session.
 *
 * Answers with a `Response` rather than a value, because the session is a
 * `Set-Cookie` and the browser is the thing that has to receive it. The body
 * is the same discriminated answer the caller would otherwise have got, so the
 * screen reads one shape either way.
 */
export const submitSignInCode = createServerFn({ method: 'POST' })
  .validator((data: unknown) => answered.parse(data))
  .handler(async ({ data }) => {
    const result = await submitCode(currentOrgId(), data.email, data.code)
    if (!result.signedIn) {
      return Response.json({ signedIn: false, because: result.because }, { status: 200 })
    }

    // Better Auth's headers, carried through rather than rebuilt: the cookie's
    // name, flags and lifetime are its decisions, and a copy made here is a
    // copy that goes stale on the first upgrade.
    const headers = new Headers(result.headers)
    headers.set('content-type', 'application/json')
    return new Response(JSON.stringify({ signedIn: true, volunteerId: result.volunteerId }), {
      status: 200,
      headers,
    })
  })

/**
 * The incoming request, put where a server function can reach it.
 *
 * Signing out is the one of the three that needs it: the cookie being ended is
 * the one that arrived. The other two are told everything they need in their
 * payload.
 */
const carryingTheRequest = createMiddleware({ type: 'request' }).server(({ request, next }) =>
  next({ context: { request } }),
)

/**
 * Ends this session, and only this one — the phone in a pocket keeps its own.
 * Revoking every session an Account holds is an officer's act and lives in
 * `./revoke.ts`.
 */
export const signOutHere = createServerFn({ method: 'POST' })
  .middleware([carryingTheRequest])
  .handler(async ({ context }) => {
    const headers = new Headers(await signOut(context.request))
    headers.set('content-type', 'application/json')
    return new Response(JSON.stringify({ signedOut: true }), { status: 200, headers })
  })
