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
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      ADMIN_DATABASE_URL: process.env.ADMIN_DATABASE_URL ?? '',
    },
  },
})
