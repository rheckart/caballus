/**
 * ADR 0016: an unenforced invariant is a type where it can be, a lint rule
 * where it cannot, and never prose.
 *
 * Six rules, deny-by-default, all type-unaware so they are affordable to run
 * on every file write. Each message states the correct alternative and the
 * ADR, in one sentence, because these messages are the only documentation
 * anyone reads at the moment they are about to do the wrong thing.
 *
 * Exemptions are path overrides here and nowhere else — there are no inline
 * escape hatches, and `noInlineConfig` makes that mechanical rather than a
 * promise. The counts are stated in ADR 0016 and asserted by
 * `npm run lint:fixtures`, so a seventh exemption is something a person has to
 * write down.
 */
import js from '@eslint/js'
import type { Linter } from 'eslint'
import tseslint from 'typescript-eslint'

export type BanId = 'serverFn' | 'dbClient' | 'dayBoundary' | 'drizzleZod' | 'sentry' | 'apiPath'

interface Ban {
  readonly id: BanId
  /** The invariant, as ADR 0016's table states it. */
  readonly invariant: string
  readonly message: string
  readonly paths?: readonly { name: string; importNames?: string[] }[]
  readonly patterns?: readonly string[]
  readonly globals?: readonly string[]
  readonly syntax?: readonly string[]
}

export const BANS: readonly Ban[] = [
  {
    id: 'serverFn',
    invariant: 'Queueable writes POST to /api/v1, never a server function',
    message:
      'Queueable writes POST to /api/v1; server functions are for writes that can never be queued (ADR 0007).',
    // Inverted deliberately: lint cannot tell a queueable write from one that
    // can never be queued, so every server function is banned and each legal
    // one is an exemption with a reason.
    //
    // Both specifiers, because an import ban holds only while there is one
    // import path (ADR 0016) — `@tanstack/react-start` re-exports this from
    // `@tanstack/start-client-core`, which is hoisted, resolvable, and what an
    // editor's auto-import will offer.
    paths: [
      { name: '@tanstack/react-start', importNames: ['createServerFn'] },
      { name: '@tanstack/start-client-core', importNames: ['createServerFn'] },
    ],
  },
  {
    id: 'dbClient',
    invariant: 'No database handle except through forOrg',
    message:
      'Reach the database through forOrg in src/db/for-org.ts; a raw handle runs with no app.org_id and quietly returns nothing (ADR 0007).',
    patterns: ['**/db/client', '**/db/client.*', './client', './client.*', '../client', '../client.*'],
    // A static import is not the only way through a door.
    syntax: ['ImportExpression[source.value=/db\\/client(\\.\\w+)?$/]'],
  },
  {
    id: 'dayBoundary',
    invariant: "No day boundary derived outside the organisation's timezone",
    message:
      "A day belongs to the organisation's timezone: take the clock from now() in src/shared/time.ts and the calendar from src/server/time.ts (ADR 0007).",
    globals: ['Date', 'Intl'],
    // The calendar libraries too, and the ones nobody has installed yet: a ban
    // on `Date` that leaves the library sitting in `package.json` reachable
    // just moves the wrong answer one import along.
    patterns: ['luxon', 'luxon/**', 'date-fns', 'date-fns/**', 'dayjs', 'dayjs/**', 'temporal-polyfill', 'temporal-polyfill/**'],
    syntax: [
      'MemberExpression[object.name="Date"][property.name="now"]',
      'MemberExpression[object.name="globalThis"][property.name=/^(Date|Intl)$/]',
      'CallExpression[callee.property.name="toLocaleDateString"]',
      'CallExpression[callee.property.name="toLocaleTimeString"]',
    ],
  },
  {
    id: 'drizzleZod',
    invariant: 'Wire shapes are hand-written Zod',
    message:
      'Wire shapes are hand-written Zod; a generated one teaches the API to mirror the tables, and ADR 0003 says they differ (ADR 0007).',
    patterns: ['drizzle-zod', 'drizzle-zod/**'],
  },
  {
    id: 'sentry',
    invariant: 'No error report bypasses scrubbing',
    message:
      "Report through src/server/observability.ts or its browser twin, which take a volunteer's name and number out before send (ADR 0007).",
    patterns: ['@sentry/*', '@sentry/*/**'],
  },
  {
    id: 'apiPath',
    invariant: 'No unversioned API path',
    message:
      'Call the API through src/shared/api-client.ts; the version in the path is what makes a write replayed from a pocket on Thursday safe (ADR 0007).',
    // The template form as well as the literal: a real path takes parameters,
    // so backticks are the likelier half of the traffic this guards.
    syntax: ['Literal[value=/^\\/api\\//]', 'TemplateElement[value.raw=/^\\/api\\//]'],
  },
]

interface Exemption {
  readonly bans: readonly BanId[]
  readonly files: readonly string[]
  readonly reason: string
}

/**
 * Today: two, one, one, zero, one, one — the counts ADR 0016 states. One entry
 * is one exemption with one reason, and an entry may cover the pair of modules
 * that share a reason.
 */
export const EXEMPTIONS: readonly Exemption[] = [
  {
    bans: ['serverFn'],
    // No file yet: identity lands with Better Auth (ADR 0008). Named rather
    // than globbed, so that the next file under `src/server/auth/` is a
    // decision somebody writes down instead of one this line made for them.
    files: ['src/server/auth/login.ts'],
    reason: 'Signing in is a credential exchange that must never be replayed from a queue.',
  },
  {
    bans: ['serverFn'],
    // No file yet: the admin surface lands with the screens that need it.
    files: ['src/routes/admin/**/*.{ts,tsx}'],
    reason: 'Desktop admin forms are posted from a desk on real connectivity and never queue.',
  },
  {
    bans: ['dbClient'],
    files: ['src/db/for-org.ts'],
    reason: 'forOrg is the sanctioned handle, so it is the one module that may hold the raw one.',
  },
  {
    bans: ['dayBoundary'],
    files: ['src/server/time.ts', 'src/shared/time.ts'],
    reason:
      "The two time modules: Luxon's IANA arithmetic on the server, and the only Intl constructed for display.",
  },
  {
    bans: ['sentry'],
    files: ['src/server/observability.ts', 'src/shared/observability.browser.ts'],
    reason: 'The two scrubbing wrappers, server and browser; every report passes through them.',
  },
  {
    bans: ['apiPath'],
    files: ['src/shared/api-client.ts', 'src/routes/api.$.ts'],
    reason:
      'The two places the versioned path is written: the typed client that calls it and the file route that mounts it.',
  },
]

/**
 * The six rules, minus the bans a path override lifts.
 *
 * Four of the six share the `no-restricted-imports` rule and two share
 * `no-restricted-syntax`, so an override cannot simply omit what it exempts —
 * a later config that leaves a rule out inherits it. Every rule is therefore
 * restated on every override, `off` where the exemption applies and whole
 * where it does not, so that exempting one ban never quietly lifts another.
 */
export function rulesExcept(exempt: readonly BanId[] = []): Linter.RulesRecord {
  const active = BANS.filter((ban) => !exempt.includes(ban.id))

  const paths = active.flatMap((ban) =>
    (ban.paths ?? []).map((path) => ({ ...path, message: ban.message })),
  )
  const patterns = active
    .filter((ban) => ban.patterns !== undefined)
    .map((ban) => ({ group: [...(ban.patterns ?? [])], message: ban.message }))
  const globals = active.flatMap((ban) =>
    (ban.globals ?? []).map((name) => ({ name, message: ban.message })),
  )
  const syntax = active.flatMap((ban) =>
    (ban.syntax ?? []).map((selector) => ({ selector, message: ban.message })),
  )

  return {
    'no-restricted-imports':
      paths.length > 0 || patterns.length > 0 ? ['error', { paths, patterns }] : 'off',
    'no-restricted-globals': globals.length > 0 ? ['error', ...globals] : 'off',
    'no-restricted-syntax': syntax.length > 0 ? ['error', ...syntax] : 'off',
  }
}

/**
 * The guardrails alone. `npm run lint` runs these with everything else; the
 * PostToolUse hook and the fixture check run only these, because the only
 * thing permitted to stop work mid-file is this class of error.
 */
export const guardrails: Linter.Config[] = [
  {
    name: 'caballus/guardrails',
    files: ['**/*.ts', '**/*.tsx'],
    // Stated here rather than inherited, so that the hook and the fixture
    // check — which load these configs alone — parse what they lint.
    languageOptions: {
      parser: tseslint.parser as Linter.Parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    linterOptions: {
      // The one way to exempt code is a path override in this file (ADR 0016):
      // a rule that can be silenced in one line is a rule an agent will
      // silence rather than obey.
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
    rules: rulesExcept(),
  },
  ...EXEMPTIONS.map(
    (exemption): Linter.Config => ({
      name: `caballus/exempt: ${exemption.reason}`,
      files: [...exemption.files],
      rules: rulesExcept(exemption.bans),
    }),
  ),
]

export default [
  {
    ignores: [
      '.output/**',
      '.nitro/**',
      '.tanstack/**',
      'dist/**',
      'node_modules/**',
      // Generated by the router; regenerated on every build.
      'src/routeTree.gen.ts',
      // Deliberate violations. `npm run lint:fixtures` is what reads them.
      'lint-fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The verify scripts and the hook run on Node, outside the bundle.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', Buffer: 'readonly', console: 'readonly' },
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  ...guardrails,
] satisfies Linter.Config[]
