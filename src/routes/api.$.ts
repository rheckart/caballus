import { createFileRoute } from '@tanstack/react-router'

import { api } from '../server/api/app'

/**
 * The wildcard that hands every `/api/*` request to the Hono application
 * mounted at `/api/v1` (ADR 0007) — including the ones naming a version that
 * does not exist, which is why it is a wildcard over the whole of `/api/`
 * rather than the version. That application answers a path this version does
 * not claim with a 404 and a version it does not serve with an explicit
 * rejection, and an old client replaying a write has to be told which.
 */
export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      ANY: ({ request }) => api.fetch(request),
    },
  },
})
