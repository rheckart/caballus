/**
 * Serves the production build.
 *
 * `vite build` emits a fetch handler rather than a listening server, so this is
 * the twelve lines that put it on a port — the container of ADR 0006 runs
 * exactly this. Migrations are not run here: ADR 0007 makes them an explicit
 * one-shot deploy step, because a boot that can hang on a lock is a boot on the
 * critical path of a 6am restart while a Lead waits for the medication list.
 */
import { serve } from '@hono/node-server'

import handler from '../dist/server/server.js'

const port = Number(process.env.PORT ?? 3000)

serve({ fetch: handler.fetch, port }, (info) => {
  process.stdout.write(
    `${JSON.stringify({ level: 'info', event: 'listening', port: info.port })}\n`,
  )
})
