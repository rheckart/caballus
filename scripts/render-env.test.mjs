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
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = join(ROOT, 'deploy/render-env.sh')
const TEMPLATE = join(ROOT, 'deploy/.env.tpl')

const ORG = '01a03af7-0000-7000-8000-000000000001'

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
    'Caballus/app/hostname': 'caballus.tech',
    'Caballus/app/org-id': ORG,
    'Caballus/app/better-auth-secret': 'secret',
    'Caballus/app/board-token': 'a-kiosk-token-at-least-twenty-four-long',
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

  it('renders the existing rescue as a one-entry RESCUES', async () => {
    const run = render(vaultFor())
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)

    const rescues = JSON.parse(line(await rendered(), 'RESCUES') ?? '')
    expect(rescues).toEqual({
      'caballus.tech': {
        orgId: ORG,
        boardToken: 'a-kiosk-token-at-least-twenty-four-long',
        sms: true,
      },
    })
  })

  it('renders none of the variables #113 retired', async () => {
    expect(render(vaultFor()).status).toBe(0)
    const env = await rendered()
    for (const gone of ['APP_URL', 'BOARD_TOKEN', 'BARN_LATITUDE', 'BARN_LONGITUDE']) {
      expect(line(env, gone)).toBeUndefined()
    }
  })

  it.each([
    ['a host that is not one', { 'Caballus/app/hostname': 'https://caballus.tech' }, /not a host/],
    ['an org id that is not one', { 'Caballus/app/org-id': 'freedom-hill' }, /not an id/],
    ['an empty org id', { 'Caballus/app/org-id': '' }, /not an id/],
    [
      'a kiosk token anybody could guess',
      { 'Caballus/app/board-token': 'barn' },
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
