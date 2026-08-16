/**
 * The raw database handle.
 *
 * Nothing imports this but `src/db/for-org.ts`, and that is a lint rule rather
 * than a convention (ADR 0016): a query issued outside `forOrg` runs without
 * `app.org_id` set, which under ADR 0007's policies returns zero rows — it
 * fails closed, but it fails silently, and twenty minutes later somebody
 * disables the policy to make it stop.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

export type Database = ReturnType<typeof connect>

let handle: Database | undefined
let socket: ReturnType<typeof postgres> | undefined

function connect(url: string) {
  socket = postgres(url, {
    // Sixty users and no pooler between app and database (ADR 0007), so this
    // is the whole connection budget — and the absence of a pooler is also why
    // prepared statements are left on.
    max: 10,
  })
  return drizzle(socket, { schema })
}

/** The handle, connected on first use. */
export function rawDb(): Database {
  if (handle === undefined) {
    const url = process.env.DATABASE_URL
    if (url === undefined || url === '') {
      throw new Error('DATABASE_URL is not set')
    }
    handle = connect(url)
  }
  return handle
}

/** Closes the connection. For tests and for a clean shutdown. */
export async function closeDb(): Promise<void> {
  await socket?.end()
  handle = undefined
  socket = undefined
}
