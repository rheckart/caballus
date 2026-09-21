# Caballus

Operations for a horse rescue: the daily care of the horses, and the coordination
of the volunteers who deliver it.

Caballus is a **mobile-first** web app. Its main users are volunteers working a
feed shift in a barn — on a phone, often outdoors, often on a bad signal. The
core loop is capturing what happened on a shift; reporting, rostering and
coordination are built on top of it. It is built for one real rescue in
Maryland and replaces a whiteboard, a paper sign-in sheet and a Facebook group.

It is installable (a PWA), works through dropped connections, and runs as a
single container on a small VPS.

## What it does

| Area                | What the barn gets                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Roster**          | Volunteers, Roles and three rostering gates — Orientation, a current Release, and parental Consent for minors — derived on every read, never stored.                                                     |
| **Horses & Spaces** | Horse profiles, stalls, pastures, paddocks and barns; standing Alerts (bites, allergies, prohibitions); a per-horse Timeline of everything recorded about her.                                           |
| **Feed**            | Versioned Feed Schedules, a Product catalogue (feed, supplements, medications, topicals), and Days-of-Supply tracking with reorder points.                                                               |
| **Shifts**          | Recurring Shift Patterns that generate a rolling two-week horizon, Cover and Drop, Acting Lead, staffing gaps, and an evening digest to coordinators.                                                    |
| **Checklist**       | Per-horse and per-area Items materialized from Tasks, Feed Schedules and the weather; ticked Done offline and synced later; Dropped / Not done; a Shift that closes and never reopens.                   |
| **Weather**         | Per-horse cold and heat thresholds evaluated against the forecast (Open-Meteo, falling back to api.weather.gov) to decide sheets, blankets, fans and whether horses stay in.                             |
| **The Board**       | A barn tablet that shows the whole feed grid, signed in as the barn rather than as a person.                                                                                                             |
| **Attendance**      | The sign-in sheet, replaced — shifts and ad-hoc Visits, and per-county service-learning hours reports for students.                                                                                      |
| **Reports**         | Observations from the floor, Escalated to the right Head (horse welfare, maintenance, supplies), with a thread and a closing note back to the reporter.                                                  |
| **Announcements**   | The wall: short-lived notices on the home screen and the Board, plus a Contacts screen.                                                                                                                  |
| **Urgent texts**    | Exactly two cases — a Shift declared Short, and an Announcement that will not keep — sent by SMS to people who consented, with a daily cap.                                                              |
| **Whiteboard Read** | Photograph a panel of the existing whiteboard and let a model (Claude, via OpenRouter) create the horses, spaces, products and feed lines it can read — additive only, with a report of what it skipped. |

Sign-in is passwordless: a six-digit code sent by email, or by text through
Twilio Verify. There is no public sign-up — a Volunteer Coordinator adds people.

## Stack

- **TypeScript** end to end
- **TanStack Start** (React 19, TanStack Router) served by **Hono**
- **Postgres 18** through **Drizzle**, with row-level security on every table
- **Better Auth** for identity (email and SMS one-time codes)
- **Zod** — one hand-written API contract that the server and the phone both compile against
- **Tailwind CSS 4** and **shadcn/ui** (Radix)
- **Vitest** (node and jsdom projects) and Testing Library
- **Sentry** for error reporting, with personal data scrubbed before anything leaves
- **Twilio** (Verify for codes, a 10DLC campaign for urgent texts), SMTP for email
- Deployed as **one Docker container** behind Traefik, images on `ghcr.io`

## Getting started

You need **Node 24+** and **Docker**.

```sh
npm install

# Postgres 18 (on host port 5433) and Mailpit (a local inbox)
docker compose up -d

# Create the non-superuser role the app connects as, so row-level security applies
docker compose exec -T postgres psql -U caballus -d caballus \
  -v app_password="caballus" -f - < scripts/provision-database.sql

cp .env.example .env
```

Edit `.env`:

- Set `BETTER_AUTH_SECRET` — generate one with
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
- Set `SMTP_URL=smtp://localhost:1025` so sign-in codes land in Mailpit at
  <http://localhost:8025>

Then:

```sh
npm run db:migrate

# Create the first organisation and its first President (run once)
npm run bootstrap -- "Your Rescue" America/New_York "Your Name" you@example.com

npm run dev    # http://localhost:3000
```

Sign in with the email you bootstrapped; the code arrives in Mailpit.

### Optional configuration

Everything else in `.env.example` is off by default, and each one fails loudly
rather than pretending to work when unset:

| Variable                          | Turns on                                                    |
| --------------------------------- | ----------------------------------------------------------- |
| `BARN_LATITUDE`, `BARN_LONGITUDE` | Weather readings and Condition evaluation                   |
| `BOARD_TOKEN`                     | The barn tablet (`/board?token=…`)                          |
| `OPENROUTER_API_KEY`              | The Whiteboard Read                                         |
| `TWILIO_*`                        | SMS sign-in and urgent texts (Twilio test credentials work) |
| `SENTRY_DSN`, `VITE_SENTRY_DSN`   | Error reporting                                             |

`.env.example` explains every variable in full.

## Commands

```sh
npm run dev                  # the app on :3000
npm run verify               # typecheck, lint, lint fixtures, tests, migration check — the one gate
npm test                     # vitest
npx vitest run src/shared/staffing.test.ts   # one test file
npx vitest run -t 'day boundary'             # one test by name
npm run lint                 # eslint
npm run format               # prettier --write .
npm run build && npm start   # production build on :3000
npm run db:generate          # a migration from a schema change
npm run db:migrate           # apply migrations (a deliberate step, never at boot)
npm run db:check             # migration consistency
```

The database and auth tests need the Postgres above and `BETTER_AUTH_SECRET`;
without them they skip rather than fail. Nothing needs a real mail server —
tests swap the transport and read the code out of the message.

## Project layout

```
src/
  routes/         screens — phone screens at the top level, desk screens under admin/
  components/     shared UI (shadcn components, navigation shell, public pages)
  server/         one folder per domain: roster, horses, shifts, checklist, weather, …
    api/          route registration, authorization, idempotency, the typed answer
  shared/         code both sides run: the API contract, and the pure derivations
                  (rostering, staffing, materialization, conditions, board, …)
  db/             Drizzle schema, migrations, the org-scoped client
public/           PWA manifest, icons, the static service worker
deploy/           the stack the VPS runs
docs/
  adr/            29 architecture decision records — read these before designing anything
  deploy.md       the deploy runbook, written as the commands actually ran
  research/       background research (e.g. Maryland volunteer-records rules)
design/           static design mockups of every screen
CONTEXT.md        the glossary: the words the app and the barn agree on
brainstorming_document.md   the product brief — aspirational scope, not a roadmap
```

## How it is built

A few decisions shape almost every file. Each has an ADR in `docs/adr/`.

- **Care events are history, not overwritten fields.** Feed changes, weights and
  thresholds are versions or append-only series; current-state edits carry an
  audit entry (ADR 0003).
- **Authorization is Domain Scope plus Shift Authority.** Roles carry scopes
  like `horse_care`, `roster`, `supplies`; the other way to act is being on the
  Shift in question. A handler must declare which it uses, or it does not
  compile (ADR 0010, ADR 0016).
- **Every write carries a client-minted idempotency key**, stored with its
  answer, so a phone retrying on a bad signal can never do something twice
  (ADR 0005, ADR 0020). Ticks queue in IndexedDB and retry; Cover, Drop and a
  few others deliberately do not.
- **One API contract.** Every endpoint is declared in
  `src/shared/api-contract.ts`; a path or answer shape the server and client
  disagree on is a type error (ADR 0021).
- **Derived, not stored.** Rostering gates, staffing gaps, overdue items and
  weather Conditions are pure functions of the facts, heavily table-tested in
  `src/shared/`.
- **Guardrails are enforced, not suggested.** Custom ESLint rules and type
  invariants encode the ADRs; `npm run lint:fixtures` asserts the rules still
  fire. There are no `eslint-disable` comments.
- **Row-level security everywhere.** The app connects as a non-superuser and
  every table is scoped to an organisation.

## Deployment

CI (`.github/workflows/ci.yml`) runs `npm run verify` against a real Postgres 18
on every push and publishes an image to `ghcr.io/rheckart/caballus` from
`main`. Deploying (`deploy.yml`) is dispatched by a person, because running
migrations is a deliberate act. The full runbook is [`docs/deploy.md`](docs/deploy.md);
the stack on the box is [`deploy/`](deploy/).

## Status

In active development, built with and for one rescue. The domains above are built;
much of `brainstorming_document.md` — medical, farrier, dental, adoption,
documents — is not yet.

Issues and plans live on GitHub Issues.

## License

No license has been chosen yet, so all rights are reserved for now.
