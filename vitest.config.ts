import { existsSync } from 'node:fs'

import { defineConfig } from 'vitest/config'

// The integration tests need a real Postgres (ADR 0007: the database is
// tested, not mocked). Everything else runs without one and the database tests
// skip themselves, so a machine with no Docker still gets a green suite and
// says which tests it did not run.
if (existsSync('.env')) process.loadEnvFile('.env')

// Deliberately separate from `vite.config.ts`: the tests exercise modules, not
// the application shell, and loading the framework plugin to run them buys
// nothing but time on a machine that is also running Postgres.
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      ADMIN_DATABASE_URL: process.env.ADMIN_DATABASE_URL ?? '',
    },
    // Two projects rather than one `environment`: component tests render real
    // route components with Testing Library (the spec's fifth seam), which
    // needs a DOM, and everything else is a module test that does not need
    // the cost of one.
    projects: [
      {
        extends: true,
        test: { name: 'unit', environment: 'node', include: ['src/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test/setup-dom.ts'],
        },
      },
    ],
  },
})
