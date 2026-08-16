/**
 * The browser's entry point, and the one place a report can start from.
 *
 * TanStack Start ships a default client entry that only hydrates; this file
 * replaces it to add the one call it has no way to know about. Reporting
 * starts *before* hydration, because an exception thrown while the router
 * hydrates is the one a volunteer describes as "it just showed nothing" and
 * nobody can reproduce from a desk.
 *
 * Without `VITE_SENTRY_DSN` this is a no-op: the SDK never initialises, so a
 * phone on one bar in a barn has no upload to retry (ADR 0004's floor
 * degrades, it never walls).
 *
 * The import is static and stays static, at a measured cost of 28.6kB gzipped
 * in the initial chunk (99.9 → 128.5). Loading it lazily inside that DSN guard
 * would buy the bytes back on a DSN-less build, and would cost the thing this
 * file exists for: the SDK installs its global handlers when it initialises,
 * so an `await` in front of that leaves a window during hydration where a
 * throw is caught by nobody — the exact error this ordering is here to keep.
 * A deployment with no DSN is a development box, and that is not the phone the
 * 28.6kB is being spent on.
 *
 * **The service worker gets no reporting path of its own.** ADR 0004 gives it
 * one job — precache the app shell — and ADR 0005 records that WebKit has no
 * Background Sync, so the queue drains *in the page*, while it is open. The
 * failure most worth seeing is therefore a page failure and this SDK sees it.
 * A second Sentry client inside the worker would cost a second copy of the SDK
 * in the cache for shell-fetch errors nobody acts on. Registering the worker
 * is the ticket that ships the precache; if it ever grows work of its own —
 * Background Sync arriving on iOS is the trigger — that ticket revisits this,
 * and the wrapper it must go through is `shared/observability.browser.ts`.
 */
import { StrictMode, startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { StartClient } from '@tanstack/react-start/client'

import { startObservability } from './shared/observability.browser'

startObservability()

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  )
})
