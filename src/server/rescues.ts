/**
 * Which rescue a request is for: the host it arrived at (#112, ADR 0030).
 *
 * **`RESCUES` is one piece of configuration, keyed by host.** JSON, validated
 * once and failing loudly on a malformed value, mapping every host this
 * deployment answers at to the organisation behind it:
 *
 *   RESCUES={"caballus.tech":{"orgId":"01a0…"},"localhost:3000":{"orgId":"…"}}
 *
 * A rescue's whole configuration is one entry, so whatever else becomes one
 * per rescue — the kiosk token, the texting sender — joins that entry rather
 * than becoming a second map keyed some other way.
 *
 * **Configuration, and deliberately not a column on `orgs`.** The `orgs` policy
 * is keyed on `app.org_id`, so reading a host off it would be a read before the
 * tenant is known — an exemption in the policy catalogue for the one query
 * every request makes. And adding a rescue is meant to be a deploy, the way a
 * migration is (ADR 0007), rather than a row anybody with database access can
 * insert.
 *
 * **The host chooses a door and never a person.** ADR 0008 forbids deriving
 * the tenant from a header, because a caller naming a tenant and being believed
 * is the impersonation vector. The host is not believed: the session still has
 * to resolve to an Account of the rescue it names, and since #111 an Account
 * belongs to exactly one, so a rescue-A cookie at rescue B's host is nobody.
 *
 * **A key is the `Host` header exactly** — lowercased, port included. A browser
 * sends no port for the scheme's default, so a production key is
 * `caballus.tech`, and a development key is `localhost:3000`. Only `Host` is
 * read, never `X-Forwarded-Host`: Traefik passes the original `Host` through,
 * and a forwarded header is whatever the client chose to write.
 */
import { z } from 'zod'

import { API_ROOT } from '../shared/api-client'

/** One rescue's configuration. #113 and #114 add to it. */
export interface Rescue {
  readonly host: string
  readonly orgId: string
}

// `guid` rather than `uuid`: Postgres takes any 8-4-4-4-12 hex, and RFC 9562's
// version digit is not a fact about which rescue this is.
const entry = z.object({ orgId: z.guid() }).strict()

/**
 * A host as a browser sends it: a name, optionally a port, and nothing else —
 * no scheme, no path, no uppercase. A key that could never equal a `Host`
 * header is a rescue nobody can reach, and saying so at boot beats finding out
 * from a volunteer.
 */
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/

const map = z
  .record(
    z
      .string()
      .regex(HOST, 'a key is a host as the browser sends it, like caballus.tech or localhost:3000'),
    entry,
  )
  .refine((rescues) => Object.keys(rescues).length > 0, 'RESCUES names no rescue at all')

/** A configuration that will not parse — thrown, so the process refuses to serve. */
export class MalformedRescues extends Error {}

/**
 * Parses `RESCUES`, or throws saying why.
 *
 * Exported for `deploy/render-env.sh`'s twin and for the tests; the
 * application reads it through `rescues()` below.
 */
export function parseRescues(raw: string | undefined): ReadonlyMap<string, Rescue> {
  if (raw === undefined || raw.trim() === '') {
    throw new MalformedRescues('RESCUES is not set: no host is mapped to a rescue')
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new MalformedRescues('RESCUES is not JSON')
  }
  const parsed = map.safeParse(json)
  if (!parsed.success) {
    throw new MalformedRescues(`RESCUES is malformed: ${z.prettifyError(parsed.error)}`)
  }
  return new Map(
    Object.entries(parsed.data).map(([host, rescue]) => [host, { host, orgId: rescue.orgId }]),
  )
}

let injected: ReadonlyMap<string, Rescue> | null = null
let cached: {
  readonly raw: string | undefined
  readonly value: ReadonlyMap<string, Rescue>
} | null = null

/**
 * Every rescue this deployment serves.
 *
 * Parsed on first use and kept, which is *once at startup* for a process that
 * serves a request as soon as it boots — and `src/start.ts`'s gate is the
 * first thing every request meets. Re-parsed only if the variable itself
 * changed, which in a running container it does not.
 */
export function rescues(): ReadonlyMap<string, Rescue> {
  if (injected !== null) return injected
  const raw = process.env.RESCUES
  if (cached === null || cached.raw !== raw) cached = { raw, value: parseRescues(raw) }
  return cached.value
}

/**
 * Puts a map in place of configuration, or `null` to go back to it — the
 * seam `setEmailTransport` already is, so a test names its rescues rather than
 * writing JSON into the environment.
 */
export function setRescues(replacement: ReadonlyMap<string, Rescue> | null): void {
  injected = replacement
}

/**
 * The host a request arrived at, as `RESCUES` keys it.
 *
 * The `Host` header, and the URL's host only when there is no header at all —
 * which is a `Request` built in-process by a test, never one off the wire:
 * Node's server always has the header, and it is what it builds the URL from.
 */
export function hostOf(request: Request): string {
  const header = request.headers.get('host')
  const host = header ?? new URL(request.url).host
  return host.toLowerCase().replace(/\.$/, '').replace(/\.:/, ':')
}

/** The rescue this request knocked at, or `null` for a host nobody mapped. */
export function rescueFor(request: Request): Rescue | null {
  return rescues().get(hostOf(request)) ?? null
}

/** The sentence an unmapped host is answered with, on every surface. */
export const UNKNOWN_RESCUE =
  'No rescue is served at this address. Check the address you were given by your rescue.'

/**
 * The answer to a request at a host nobody mapped: a 404 and a sentence, never
 * the first rescue in the map. Defaulting would hand somebody who mistyped a
 * subdomain a sign-in screen for a rescue they do not belong to.
 *
 * JSON under the API root, where the phone's client reads a body; plain text
 * everywhere else, including a server function, whose caller shows the text.
 */
export function unknownRescueResponse(request: Request): Response {
  const path = new URL(request.url).pathname
  if (path === API_ROOT || path.startsWith(`${API_ROOT}/`)) {
    return Response.json({ error: 'unknown_rescue', message: UNKNOWN_RESCUE }, { status: 404 })
  }
  return new Response(UNKNOWN_RESCUE, {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
