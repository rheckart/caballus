# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The skeleton exists, identity is on it, and **the roster is the first domain on top** (#34). Five reads and eleven writes, a login screen, a home page and three desktop admin screens under `src/routes/admin/`. `mutation` dedupes — it opens the transaction, records the key inside it and hands the handler the scoped `db`, so a write's effect, its key and its audit entry commit together (ADR 0020). Every endpoint is declared in `src/shared/api-contract.ts`, which is where every new one goes: the server registers against that contract and the phone calls against it, so a path or an answer shape neither side agrees on does not compile (ADR 0021). The rest of "Domain model" below is still a description of what the code will model — horses, shifts, checklists and reports land ticket by ticket.

**Signing in works, and it is where the shape of authorization is already settled** (#33). A Volunteer is created by a coordinator from a name and an email; they sign in with a six-digit code mailed to that address; the Account is _claimed_ rather than created, and nothing in the care record will ever reference it (ADR 0008, 0009). Sessions are rows in Postgres and revocation is a delete with no staleness window, because `src/server/request-context.ts` resolves the actor from the session on **every** request rather than trusting a token. Roles are rows; the role-to-Domain-Scope mapping is a constant — now in `src/shared/roles.ts`, because the admin screen grants Roles and shows what they carry, with the _checks_ still on the server in `src/server/api/authorization.ts` — and never a table (ADR 0010). There is **no impersonation and no god-mode** — the first President is made by `npm run bootstrap`, once, and holds `grants` through the same tables as everybody else.

**The three rostering gates are derived, never stored, and there is no override** (#34). `src/shared/rostering.ts` is a pure function of a Volunteer's facts and a day: an Orientation, a current Release, and for a minor a Consent. Two of the three go stale, and **both staleness rules are read-time derivations rather than a scheduled job** — an eighteenth birthday obsoletes a parent's signature and retires the Consent on the morning itself, and a Release Version published with the obsoletes flag stales every signature given before its valid-from. Nothing is ever auto-removed from a roster: a failing gate **flags** (ADR 0017), because a re-papering would otherwise empty every roster in the system on one morning. The date of birth is where the care goes — day and month are on the floor because the rescue has a party, the **year and the age sit behind `roster`** with contact details, and under-18 is shown as a state and never as a number. Redaction happens once, in `src/server/roster/people.ts`, on the way out.

Two things ADR 0017 asks for that #34 deliberately did **not** build, recorded so a later reader can tell deferred from forgotten. **The blank template a Release Version carries** — "one file per version, uploaded under `roster`" — is not stored: #32 puts document storage out of v1, and a URL column pointing at nothing would be worse than the column's absence. It lands with object storage, and `release_versions` takes one column when it does. **The gate is not armed.** ADR 0017 wants arming to be "one deliberate human act when the backfill is declared complete", and the backfill is sixty real dates read off paper by a person; nothing consumes rosterability yet, because Shifts do not exist, so there is nothing for an unarmed gate to fail open on. Arming belongs with the Shift roster, and it must not become a config flag that lingers.

**The audit log is derived and losable, and what lands in it is ADR 0003's tiers rather than taste.** Current-state edits get an entry; grants and revocations get one carrying actor, subject and reason; **publishing a Release Version gets none**, because a versioned-tier change _is_ a version. Denials stay structured logs, not rows. Reading the log is behind `roster`, one of ADR 0010's two carve-outs from the read-everything floor.

Thirteen tables. `orgs`; `idempotency_keys` (bookkeeping, not domain); Better Auth's `user`, `session` and `verification`, which alone carry no `org_id` and no policy, because identity is not org-scoped and Better Auth queries outside `forOrg`; and `volunteers`, `volunteer_accounts`, `volunteer_roles`, `volunteer_consents`, `release_versions`, `release_signatures`, `medication_authority` and `audit_entries`, which carry both like everything else will. `src/server/api/roster.test.ts` asserts the policies against the catalogue, so a future table added without `enableRLS()` fails a test rather than leaking.

Three things about signing in that are easy to get wrong twice. **A session cannot outlive 400 days** — RFC 6265bis caps the cookie and browsers enforce it — so "permanent" is a year, and the _row_ is refreshed on use while the cookie is not: `ApiResponse` deliberately cannot carry a header (ADR 0020), so nothing applies Better Auth's refresh cookie and a volunteer signs in again about once a year. That is a known gap, written down in `src/server/auth/auth.ts`, and closing it is a question about the response layer. **`requestCode` mints and sends the code itself** rather than letting Better Auth's `sendVerificationOTP` do it: that path swallows the sender's failure and answers `sent: true` for a message that never left, which with email as the only channel (ADR 0009) is a volunteer standing in a barn waiting. And **`actorForUser` is where membership is decided** — a revoked Account and a removed Volunteer are both refused there, because that is the read every request makes and it is what makes removal bite on the next request rather than whenever something forces a refresh.

The stack is decided and is not open by default: TypeScript end to end, TanStack Start on Postgres 18 through Drizzle, deployed as one container (ADR 0007). Read `docs/adr/` before designing anything; the ADRs are decisions, not notes.

**The guardrails are armed, and they are not negotiable.** ADR 0016 puts six invariants in `eslint.config.ts` — under **seven** exemptions covering ten paths as of #33, and both counts are asserted by `npm run lint:fixtures`, so widening one breaks the build — and four more in the types of `src/server/api/route.ts` — a handler declares its authorization; a write's payload and key come from the contract rather than from the call site (ADR 0021), so a keyless write is unwritable; a mutation answers with an `ApiResponse`, which only `src/server/api/answer.ts` builds — `json` and `noContent` for a handler, `rebuild` for the replay, so a stored answer comes back exactly rather than approximately; and every path and answer shape is one `src/shared/api-contract.ts` declares, on the server and on the phone alike. A `PostToolUse` hook runs the six on every file write and blocks on a violation. There are no `eslint-disable` comments — `noInlineConfig` is on — and the only way to exempt code is a path override in `eslint.config.ts` with a reason. If a rule fires, the fix is the alternative its message names, never a way around it. The same hook also checks whatever file was just written, on any path, for a literal control byte — the one invariant that passes ADR 0016's test but is outside what an AST selector can see (#29); `npm run check:control-bytes` asserts the same repo-wide in `verify`.

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
npm run bootstrap -- "<rescue>" <IANA/Zone> "<name>" <email>   # the first org and its first President, once
```

The database tests need Postgres and skip themselves without it:

```
docker compose up -d
docker compose exec -T postgres psql -U caballus -d caballus \
  -v app_password="caballus" -f - < scripts/provision-database.sql
cp .env.example .env && npm run db:migrate
```

The auth tests additionally need `BETTER_AUTH_SECRET` set in `.env`; without it they skip with everything else. Nothing needs an SMTP server — the tests replace the transport and read the code out of the message the way a volunteer reads it out of an inbox.

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
