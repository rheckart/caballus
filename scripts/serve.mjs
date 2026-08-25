/**
 * Serves the production build.
 *
 * `vite build` emits a fetch handler rather than a listening server, so this is
 * the twelve lines that put it on a port — the container of ADR 0006 runs
 * exactly this. Migrations are not run here: ADR 0007 makes them an explicit
 * one-shot deploy step, because a boot that can hang on a lock is a boot on the
 * critical path of a 6am restart while a Lead waits for the medication list.
 *
 * `/health` is answered here rather than by the application, and deliberately.
 * ADR 0016 requires every endpoint the application serves to be declared in
 * `src/shared/api-contract.ts` with an authorization, and there is no public
 * one — inventing it would widen ADR 0010's two axes for an operations probe
 * that is not a domain read at all. Answering ahead of the handler also means
 * the check still answers when the handler itself is the thing that is broken,
 * which is the hour a health check exists for.
 */
import { serve } from '@hono/node-server'
import postgres from 'postgres'

import handler from '../dist/server/server.js'

const port = Number(process.env.PORT ?? 3000)

/**
 * A connection of its own, and one, because a probe that waits behind the
 * application's ten busy connections reports the queue rather than the
 * database. It is opened on the first check and kept.
 */
let probe

function probeSocket() {
  if (probe === undefined) {
    const url = process.env.DATABASE_URL
    if (url === undefined || url === '') {
      throw new Error('DATABASE_URL is not set')
    }
    probe = postgres(url, { max: 1, idle_timeout: 30, connect_timeout: 5 })
  }
  return probe
}

/**
 * ADR 0006 asks this to prove the application *and* its data path *and* that
 * last night's dump happened. The first two are here; the age of the last
 * successful backup lands with the backup job itself, since a field reporting
 * on a job that does not exist would report a reassuring nothing.
 */
async function health() {
  try {
    await probeSocket()`select 1`
    return new Response(JSON.stringify({ status: 'ok', database: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  } catch (error) {
    // Unauthenticated, so it says up or down and never why (ADR 0006). The
    // reason goes to stdout, where the operator can already grep for it.
    process.stdout.write(
      `${JSON.stringify({ level: 'error', event: 'health.failed', message: String(error) })}\n`,
    )
    return new Response(JSON.stringify({ status: 'down', database: 'down' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  }
}

serve(
  {
    // Every argument is forwarded, not just the request: what the adapter
    // hands a fetch handler beyond it is the adapter's business, and dropping
    // it here would be a silent difference between this and calling the
    // handler directly.
    fetch: (request, ...rest) =>
      new URL(request.url).pathname === '/health' ? health() : handler.fetch(request, ...rest),
    port,
  },
  (info) => {
    process.stdout.write(
      `${JSON.stringify({ level: 'info', event: 'listening', port: info.port })}\n`,
    )
  },
)
