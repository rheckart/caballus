/**
 * `deploy/render-env.sh`, run for real against a stand-in for 1Password.
 *
 * The script is the last thing between a vault and a running container, and
 * what it refuses is the whole of its value: a rendered `.env` that would boot
 * an application answering nobody must stop the deploy with the working file
 * untouched. So this runs it — the real script, a temporary stack directory, a
 * real template — with an `op` on the `PATH` that resolves each reference from
 * a table the test writes, the way the service account resolves it from the
 * vault.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = join(ROOT, 'deploy/render-env.sh')
const TEMPLATE = join(ROOT, 'deploy/.env.tpl')

const RESCUE_LIST = join(ROOT, 'deploy/rescues.tpl')

/**
 * The existing rescue's line, exactly as the repository's list carries it.
 *
 * The tests below build their own list from this rather than copying the
 * repository's whole file, because that file grows a line every time a rescue
 * is added (ADR 0030) and a test about the render's rules must not change
 * meaning when it does. The repository's real list is rendered whole, every
 * line, by its own test at the end.
 */
const EXISTING_LINE =
  '{"host":"{{ op://Caballus/rescue-freedom-hill/hostname }}","orgId":"{{ op://Caballus/rescue-freedom-hill/org-id }}","boardToken":"{{ op://Caballus/rescue-freedom-hill/board-token }}","sms":true}'

const ORG = '01a03af7-0000-7000-8000-000000000001'
const SECOND_ORG = '01a03af7-0000-7000-8000-000000000002'
const TOKEN = 'a-kiosk-token-at-least-twenty-four-long'

/**
 * A stand-in for `op inject`: every `{{ op://vault/item/field }}` replaced from
 * the table in `FAKE_VAULT`, and a reference the table lacks fails the render
 * exactly as an unresolvable one does.
 */
const FAKE_OP = `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs')
const args = process.argv.slice(2)
if (args[0] !== 'inject') process.exit(2)
const inFile = args[args.indexOf('--in-file') + 1]
const outFile = args[args.indexOf('--out-file') + 1]
const vault = JSON.parse(process.env.FAKE_VAULT)
let failed = null
const out = readFileSync(inFile, 'utf8').replace(/\\{\\{ op:\\/\\/([^ ]+) \\}\\}/g, (_, ref) => {
  if (!(ref in vault)) failed = ref
  return vault[ref] ?? ''
})
if (failed !== null) { process.stderr.write('could not resolve ' + failed + '\\n'); process.exit(1) }
writeFileSync(outFile, out)
`

/** Every reference the template makes, with a value that renders cleanly. */
function vaultFor(overrides = {}) {
  return {
    'Caballus/postgres/password': 'owner-password',
    'Caballus/postgres/app-password': 'app-password',
    'Caballus/app/better-auth-secret': 'secret',
    'Caballus/rescue-freedom-hill/hostname': 'caballus.tech',
    'Caballus/rescue-freedom-hill/org-id': ORG,
    'Caballus/rescue-freedom-hill/board-token': TOKEN,
    'Caballus/rescue-second/hostname': 'second.caballus.tech',
    'Caballus/rescue-second/org-id': SECOND_ORG,
    'Caballus/smtp/url': 'smtps://user:pass@smtp.example:465',
    'Caballus/twilio/account-sid': 'AC',
    'Caballus/twilio/auth-token': 'token',
    'Caballus/twilio/from-number': '+15555550100',
    'Caballus/twilio/verify-service-sid': 'VA1',
    'Caballus/twilio/verify-change-service-sid': 'VA2',
    'Caballus/openrouter/api-key': 'key',
    ...overrides,
  }
}

describe('render-env.sh', () => {
  let stack

  beforeEach(async () => {
    stack = await mkdtemp(join(tmpdir(), 'render-env-'))
    await copyFile(TEMPLATE, join(stack, '.env.tpl'))
    await writeFile(join(stack, 'rescues.tpl'), `${EXISTING_LINE}\n`)
    await writeFile(join(stack, 'op-token'), 'token\n')
    await chmod(join(stack, 'op-token'), 0o600)
    await writeFile(join(stack, 'op'), FAKE_OP)
    await chmod(join(stack, 'op'), 0o755)
  })

  afterEach(async () => {
    await rm(stack, { recursive: true, force: true })
  })

  function render(vault) {
    return spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CABALLUS_STACK: stack,
        PATH: `${stack}:${process.env.PATH ?? ''}`,
        FAKE_VAULT: JSON.stringify(vault),
      },
    })
  }

  async function rendered() {
    return readFile(join(stack, '.env'), 'utf8')
  }

  function line(env, name) {
    return new RegExp(`^${name}=(.*)$`, 'm').exec(env)?.[1]
  }

  /** `RESCUES` as the application receives it: compose strips the single quotes. */
  function rescuesOf(env) {
    const raw = line(env, 'RESCUES') ?? ''
    expect(raw.startsWith("'") && raw.endsWith("'")).toBe(true)
    return JSON.parse(raw.slice(1, -1))
  }

  /** A second rescue's line, the way _Adding a rescue_ in docs/deploy.md writes it. */
  const SECOND =
    '{"host":"{{ op://Caballus/rescue-second/hostname }}","orgId":"{{ op://Caballus/rescue-second/org-id }}"}'

  async function withLines(...lines) {
    await writeFile(join(stack, 'rescues.tpl'), [EXISTING_LINE, ...lines, ''].join('\n'))
  }

  it('carries the existing rescue’s line exactly as this file assumes', async () => {
    const list = await readFile(RESCUE_LIST, 'utf8')
    expect(list.split('\n')).toContain(EXISTING_LINE)
  })

  it('renders every line of the repository’s own rescue list', async () => {
    // A value for every reference the real list makes, so a rescue added to it
    // is rendered and checked here the day it lands, by the same rules.
    const list = await readFile(RESCUE_LIST, 'utf8')
    await writeFile(join(stack, 'rescues.tpl'), list)
    const vault = vaultFor()
    let next = 0
    for (const [, item, field] of list.matchAll(
      /\{\{ op:\/\/Caballus\/(rescue-[a-z0-9-]+)\/([a-z-]+) \}\}/g,
    )) {
      const ref = `Caballus/${item}/${field}`
      if (ref in vault) continue
      next += 1
      vault[ref] =
        field === 'hostname'
          ? `${item}.caballus.test`
          : field === 'org-id'
            ? `01a1fb57-0000-7000-8000-${String(next).padStart(12, '0')}`
            : `${'k'.repeat(32)}${String(next)}`
    }

    const run = render(vault)
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    const rendered_ = rescuesOf(await rendered())
    const lines = list.split('\n').filter((one) => one.trim().startsWith('{'))
    expect(Object.keys(rendered_)).toHaveLength(lines.length)
    // And exactly one of them texts: the one rescue the sender is registered for.
    expect(Object.values(rendered_).filter((one) => one.sms === true)).toHaveLength(1)
  })

  it('renders the existing rescue, alone, from its own line', async () => {
    const run = render(vaultFor())
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)

    const env = await rendered()
    expect(rescuesOf(env)).toEqual({
      'caballus.tech': { orgId: ORG, boardToken: TOKEN, sms: true },
    })
    expect(line(env, 'CABALLUS_ROUTER_RULE')).toBe('Host(`caballus.tech`)')
  })

  it('renders two rescues into one map and one router rule (#116)', async () => {
    await withLines(SECOND)

    const run = render(vaultFor())
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)

    const env = await rendered()
    // The second rescue texts nothing and has no tablet yet: no sms, no token.
    expect(rescuesOf(env)).toEqual({
      'caballus.tech': { orgId: ORG, boardToken: TOKEN, sms: true },
      'second.caballus.tech': { orgId: SECOND_ORG },
    })
    // The same hosts, routed: one list, two outputs.
    expect(line(env, 'CABALLUS_ROUTER_RULE')).toBe(
      'Host(`caballus.tech`) || Host(`second.caballus.tech`)',
    )
    // And nothing the render worked through is left beside it.
    expect(existsSync(join(stack, 'rescues.next'))).toBe(false)
  })

  it('routes every rendered host to the one app service, with TLS', async () => {
    await withLines(SECOND)
    expect(render(vaultFor()).status).toBe(0)
    const rule = line(await rendered(), 'CABALLUS_ROUTER_RULE') ?? ''

    // The compose file's router, with the rendered value put where compose
    // interpolates it — so what Traefik is given is exactly the list the
    // application maps, and the certresolver gets a certificate for each.
    const compose = await readFile(join(ROOT, 'deploy/docker-compose.yml'), 'utf8')
    const label = /- traefik\.http\.routers\.caballus\.rule=(.*)$/m.exec(compose)?.[1] ?? ''
    const routed = label.replace(/\$\{CABALLUS_ROUTER_RULE[^}]*\}/, rule)
    expect(routed).toContain('Host(`caballus.tech`)')
    expect(routed).toContain('Host(`second.caballus.tech`)')
    expect(compose).toContain('traefik.http.routers.caballus.tls.certresolver=letsencrypt')
    expect(compose).toContain('traefik.http.routers.caballus.entrypoints=websecure')
    expect(compose.match(/traefik\.http\.routers\.[a-z-]+\.rule=/g)).toHaveLength(1)
  })

  it.each([
    [
      'a host named twice',
      '{"host":"caballus.tech","orgId":"01a03af7-0000-7000-8000-000000000009"}',
      /names the host caballus.tech twice/,
    ],
    [
      'an organisation behind two hosts',
      `{"host":"third.caballus.tech","orgId":"${ORG}"}`,
      /two hosts to the same organisation/,
    ],
    ['a line that is not JSON', '{"host": caballus', /is not JSON/],
    [
      'a line with a field nobody reads',
      `{"host":"third.caballus.tech","orgId":"${SECOND_ORG}","colour":"red"}`,
      /at most boardToken and sms/,
    ],
  ])('refuses %s, and leaves the working .env alone', async (_label, extra, because) => {
    await writeFile(join(stack, '.env'), 'WORKING=yes\n')
    await withLines(extra)

    const run = render(vaultFor())
    expect(run.status).not.toBe(0)
    expect(run.stderr).toMatch(because)
    expect(await rendered()).toBe('WORKING=yes\n')
  })

  it('refuses a rescue whose item is missing, and names the reference', async () => {
    await writeFile(join(stack, '.env'), 'WORKING=yes\n')
    await withLines(
      '{"host":"{{ op://Caballus/rescue-third/hostname }}","orgId":"{{ op://Caballus/rescue-third/org-id }}"}',
    )

    const run = render(vaultFor())
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('rescue-third')
    expect(await rendered()).toBe('WORKING=yes\n')
  })

  it('renders none of the variables #113 retired', async () => {
    expect(render(vaultFor()).status).toBe(0)
    const env = await rendered()
    for (const gone of ['APP_URL', 'BOARD_TOKEN', 'BARN_LATITUDE', 'BARN_LONGITUDE']) {
      expect(line(env, gone)).toBeUndefined()
    }
  })

  it.each([
    [
      'a host that is not one',
      { 'Caballus/rescue-freedom-hill/hostname': 'https://caballus.tech' },
      /not one/,
    ],
    [
      'an org id that is not one',
      { 'Caballus/rescue-freedom-hill/org-id': 'freedom-hill' },
      /not an id/,
    ],
    ['an empty org id', { 'Caballus/rescue-freedom-hill/org-id': '' }, /not an id/],
    [
      'a kiosk token anybody could guess',
      { 'Caballus/rescue-freedom-hill/board-token': 'barn' },
      /shorter than 24/,
    ],
  ])('refuses %s, and leaves the working .env alone', async (_label, overrides, because) => {
    await writeFile(join(stack, '.env'), 'WORKING=yes\n')

    const run = render(vaultFor(overrides))
    expect(run.status).not.toBe(0)
    expect(run.stderr).toMatch(because)
    expect(await rendered()).toBe('WORKING=yes\n')
  })
})
