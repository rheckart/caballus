import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  // Migrations run as the owner, never as the application role — the
  // application's role is the one the policies apply to (ADR 0007), and one
  // that could reshape the schema would not be much of a constraint.
  dbCredentials: { url: process.env.ADMIN_DATABASE_URL ?? '' },
  // The application role and its grants are provisioned by the deploy, not by
  // a migration: ADR 0007 has the app connect as a non-superuser so that the
  // policies actually bite, and a migration that can create roles is running
  // as something that ignores them.
  entities: { roles: false },
  verbose: true,
  strict: true,
})
