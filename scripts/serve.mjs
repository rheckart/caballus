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
 *
 * And `dist/client` is served here too, because **nothing else serves it**. The
 * build emits the browser's half beside the server's and the server bundle does
 * not read it, so without these thirty lines every stylesheet, every script,
 * `manifest.webmanifest` and `sw.js` answer 404 while the HTML answers 200 — an
 * application that renders as unstyled text and installs as nothing. It went
 * unnoticed because `npm run dev` has Vite serving them and the smoke test only
 * ever asked for a page.
 */
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serve } from '@hono/node-server'
import postgres from 'postgres'

import handler from '../dist/server/server.js'

const port = Number(process.env.PORT ?? 3000)

/** The browser's half of the build, which this process is the only server of. */
const clientRoot = fileURLToPath(new URL('../dist/client', import.meta.url))

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
}

/**
 * The file at that path, or nothing — in which case the request belongs to the
 * application handler, which is where every route lives.
 */
async function staticFile(pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // A malformed escape is not a path, and is nobody's file.
    return undefined
  }

  // Resolved and then checked against the root rather than scanned for `..`:
  // a prefix test is the one form of this that cannot be spelled around.
  const path = resolve(clientRoot, `.${decoded}`)
  if (path !== clientRoot && !path.startsWith(clientRoot + sep)) return undefined

  const found = await stat(path).catch(() => undefined)
  if (found === undefined || !found.isFile()) return undefined

  const body = await readFile(path)
  return new Response(body, {
    headers: {
      'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
      'content-length': String(body.byteLength),
      // `/assets/` is Vite's content-hashed output — the bytes at a given hash
      // never change, which is the same reason `public/sw.js` caches it first
      // (#48). Everything else is a stable name whose contents move, `sw.js`
      // above all, where a cached copy is a shell that cannot be updated.
      'cache-control': decoded.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    },
  })
}

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
    fetch: async (request, ...rest) => {
      const { pathname } = new URL(request.url)
      if (pathname === '/health') return health()

      // A file is looked for only on the methods that can have one. A POST to
      // a path that happens to name an asset is a route, or a 405 from the
      // handler, and never a file.
      if (request.method === 'GET' || request.method === 'HEAD') {
        const file = await staticFile(pathname)
        if (file !== undefined) return file
      }

      return handler.fetch(request, ...rest)
    },
    port,
  },
  (info) => {
    process.stdout.write(
      `${JSON.stringify({ level: 'info', event: 'listening', port: info.port })}\n`,
    )
  },
)
