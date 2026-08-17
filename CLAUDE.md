# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The skeleton exists; the domain does not. There are two tables (`orgs`, and `idempotency_keys` which is bookkeeping rather than domain), one API endpoint (`GET /api/v1/day`) and one page. `mutation` dedupes — it opens the transaction, records the key inside it and hands the handler the scoped `db`, so a write's effect and its key commit together (ADR 0020). The endpoint is declared in `src/shared/api-contract.ts`, which is where every new one goes: the server registers against that contract and the phone calls against it, so a path or an answer shape neither side agrees on does not compile (ADR 0021). Everything in "Domain model" below is still a description of what the code will model, not of what it does — the care record, shifts, checklists and reports land ticket by ticket.

The stack is decided and is not open by default: TypeScript end to end, TanStack Start on Postgres 18 through Drizzle, deployed as one container (ADR 0007). Read `docs/adr/` before designing anything; the ADRs are decisions, not notes.

**The guardrails are armed, and they are not negotiable.** ADR 0016 puts six invariants in `eslint.config.ts` and four more in the types of `src/server/api/route.ts` — a handler declares its authorization; a write's payload and key come from the contract rather than from the call site (ADR 0021), so a keyless write is unwritable; a mutation answers with an `ApiResponse`, which only `src/server/api/answer.ts` builds — `json` and `noContent` for a handler, `rebuild` for the replay, so a stored answer comes back exactly rather than approximately; and every path and answer shape is one `src/shared/api-contract.ts` declares, on the server and on the phone alike. A `PostToolUse` hook runs the six on every file write and blocks on a violation. There are no `eslint-disable` comments — `noInlineConfig` is on — and the only way to exempt code is a path override in `eslint.config.ts` with a reason. If a rule fires, the fix is the alternative its message names, never a way around it.

**The local gate matches ADR 0007's description of it, as of its #27 amendment.** Husky's pre-commit runs Prettier on staged files through lint-staged; pre-push runs `npm run verify`. Prettier and ESLint do not fight — `eslint-config-prettier` turns off any stylistic rule that would disagree, though nothing in this config sets one yet. CI still does not exist; that half of the ADR is still aspirational.

## Commands

```
npm run dev                  # the application on :3000
npm run verify               # typecheck, lint, fixtures, tests, migration check — the one gate
npm run format               # prettier --write .; pre-commit already runs it on staged files
npm test                     # vitest
npx vitest run src/shared/scrub.test.ts   # a single test file
npx vitest run -t 'day boundary'          # a single test by name
npm run lint                 # eslint over the repo
npm run lint:fixtures        # asserts the ADR 0016 rules still fire, with exact counts
npm run build && npm start   # the production build, served on :3000
npm run db:generate          # a migration from a schema change
npm run db:migrate           # apply migrations (never at boot — ADR 0007)
npm run db:check             # migration consistency
```

The database tests need Postgres and skip themselves without it:

```
docker compose up -d
docker compose exec -T postgres psql -U caballus -d caballus \
  -v app_password="caballus" -f - < scripts/provision-database.sql
cp .env.example .env && npm run db:migrate
```

Postgres runs on **5433** on the host, because this box already has one on 5432. The application connects as `caballus_app`, a non-superuser, so that the row-level security policies apply to it; migrations connect as the owner through `ADMIN_DATABASE_URL`.

## Product

"Caballus" — a **mobile-first** application for horse rescue organizations. Primary users are volunteers working a shift in a barn, on a phone, often outdoors and possibly on poor connectivity. Data capture during a shift is the core loop; reporting and coordination are built on top of it.

## Domain model

Two entity clusters, and most features are joins between them.

**Horse** is the central record. It accumulates append-only logs across many care domains — feeding/nutrition, medical, dental, farrier, daily wellness, behavioral/training, emergency, adoption/foster/transfer, end-of-life. Design implications that recur across all of them:

- Care events are **historical logs, not current-state fields**. Feed changes, weight, body condition, medication, and training progress each need date + actor + reason, because "why did this change" is a real question rescues ask. Overwriting current state loses the answer.
- Many domains pair a **schedule** with a **history** and derive an **overdue alert** from the gap (vaccination, deworming, dental, farrier, grooming). That schedule/history/overdue triad is one pattern, not five — model it once.
- Fields that look required frequently aren't known. Date of birth is often unknown, so **age is derived when DOB exists and entered directly otherwise**. Assume incomplete intake data throughout.
- Photos attach to care events, not just to the horse (hoof records pre/post farrier, dental findings, memorial photos).
- Documents and compliance artifacts (Coggins, health certificates, adoption/foster/relinquishment agreements, test results) attach to the horse and have their own expiry/regulatory tracking.
- Audit logs are required for all record changes.

**Shift** is the other core entity, and it is where volunteers actually spend their time. A shift has a lead, a co-lead, volunteers, a start time, and a checklist. Two kinds:

- **Regular feed shifts** run a standard checklist: prepare food per horse, prepare/administer medication per horse, turn horses in/out, check real-feel temperature and act on it, hay and water in every paddock/field/stall (water heaters on when cold), muck paddocks and stalls, groom, fly spray, sunscreen, sweep barn.
- **Pop-up shifts** are ad-hoc (special feeding, hosing horses down in heat, welfare checks in adverse weather) and use **volunteer sign-up** rather than assignment.

Checklist items are **per-horse or per-area**, and some are **role-restricted** — food prep and medication are typically limited to the Feed Shift Lead or Co-Lead. Checklist completion is not a single boolean on the shift.

**Weather drives care decisions.** Real-feel temperature above or below a horse's threshold changes what happens on a shift: sheets/blankets in cold, fans in heat, horses kept in stalls at either extreme, water heaters on. Thresholds are per-horse. This means the app needs real-feel temperature as an input, not just a display.

**Shifts generate reports that route to roles.** A volunteer on a feed shift observing a medical, dental, or farrier issue reports it to the Head of Horse Welfare; a maintenance issue goes to the Head of Maintenance; low medicine/feed/supply levels trigger reorder. This observation → routed report → coordinator action flow is a first-class workflow, not an afterthought.

## Roles and permissions

Roles are the authorization model. **A volunteer may hold many roles simultaneously** — model this as a many-to-many assignment, never a single `role` column on a user.

- **President** and **Board Member** — can perform all functions for all roles.
- **Treasurer** — all financial matters.
- **Head of Maintenance** — sees and acts on maintenance and groundskeeping items.
- **Head of Horse Welfare** — sees and acts on medical/dental/farrier items; ingests issues reported from feed shifts, coordinates them back to volunteers, schedules visits.
- **Volunteer Coordinator** — new-volunteer orientation, assigning volunteers to shifts, removing volunteers from shifts or the rescue.
- **Feed Shift Lead** / **Feed Shift Co-Lead** — same responsibility set: set shift start time, food prep, medication, checklist completion, supervise volunteers, report medical/dental/farrier and maintenance issues upward, report low supplies.
- **Feed Shift Volunteer** — completes checklist items assigned to them by the Lead/Co-Lead.
- **Event Coordinator** — educational and public events (scout horsemanship badges, holiday events, open houses) and volunteer sign-up registration for them.

Permissions are scoped by **care domain** (medical/dental/farrier vs. maintenance vs. financial vs. volunteer management), which is why the two "head" roles and the Treasurer partition cleanly. Build authorization around domain scopes rather than enumerating per-endpoint role lists.

## Source of truth

`brainstorming_document.md` is the product brief and is more detailed than the summary above — read it before designing any feature area, since each care domain has specific fields listed there. It is aspirational scope, not a committed roadmap; the app is intended to eventually cover all aspects of rescue operations.
