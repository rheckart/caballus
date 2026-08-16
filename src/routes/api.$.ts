import { createFileRoute } from '@tanstack/react-router'

import { api } from '../server/api/app'

/**
 * The wildcard that hands every `/api/*` request to the Hono application
 * mounted at `/api/v1` (ADR 0007). Anything below `/api/` that the version
 * does not claim falls through to that application's 404, which is what an old
 * client replaying a write against a newer server has to be told.
 */
export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      ANY: ({ request }) => api.fetch(request),
    },
  },
})
