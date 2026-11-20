/**
 * What every request meets before anything else the application serves: the
 * rescue it was addressed to (#112, ADR 0030).
 *
 * A page, a server function and `/api/*` all pass through here, so a host no
 * rescue is mapped to is answered once, in one place, with a 404 and a
 * sentence — never with the first rescue in the map, which would hand somebody
 * who mistyped a subdomain a sign-in screen for a rescue they do not belong to.
 * The API repeats the check for whatever calls it in-process, which is the
 * tests.
 *
 * **`/health` never reaches this.** `scripts/serve.mjs` answers it before the
 * application sees the request, on `localhost` from the Dockerfile's
 * healthcheck and from `deploy/deploy.sh`, and an unmapped host refused there
 * would roll back every deploy.
 *
 * **The CSRF middleware is restated, not lost.** Declaring any request
 * middleware replaces the one TanStack Start installs by default, so the
 * default — server functions refuse a cross-site request — is spelled out
 * below exactly as the library spells it, and stays first.
 */
import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'

import { rescueFor, unknownRescueResponse } from './server/rescues'

/** The library's own default, verbatim: server functions are same-origin RPC. */
const sameOrigin = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })

/** A request at a host no rescue answers at is refused before anything else runs. */
export const aMappedHost = createMiddleware({ type: 'request' }).server(({ request, next }) =>
  rescueFor(request) === null ? unknownRescueResponse(request) : next(),
)

export const startInstance = createStart(() => ({
  requestMiddleware: [sameOrigin, aMappedHost],
}))
