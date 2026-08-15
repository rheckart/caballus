---
status: accepted
amends: 0007 (the day-boundary ban is repo-wide rather than client-side; the idempotency key and the authorization declaration move from lint to types)
---

# An unenforced invariant is a type where it can be, a lint rule where it cannot, and never prose

ADR 0007 named three rules that nothing enforces, and in all three the **wrong option is the more ergonomic one**. That is the whole problem. A rule whose violation is easier to write than its observance does not survive contact with an agent under context pressure, and `CLAUDE.md` is read once and forgotten. So each of these invariants gets a mechanism, and the mechanism is chosen by how tight its feedback loop is.

The order is: **make the wrong thing unrepresentable, then a type error, then a lint error, then a test — and exactly one of those per invariant.** Two enforcements of one rule is two places to update and one that eventually goes stale and contradicts the other. Applying that order moved half of this ticket out of lint entirely, which is the main thing decided here.

## What this rules out, and why the list is closed

An invariant earns mechanical enforcement when three things are true: an accepted ADR decided it, the wrong option is the more ergonomic one, and it is detectable with **zero false positives**. All three, or it is a test or a review comment instead.

That test excludes things it is tempting to include. ADR 0007's 48px touch targets and no-hover rule are design tokens, not statically decidable. "Migrations never run at boot" and "an entity id is not an idempotency key" are semantic and fail the third clause. A rule that fires on correct code is worse than no rule, because the exemption that follows teaches everyone that the rules are negotiable.

## What becomes a type

**Every `/api/v1` handler declares the authorization it requires.** ADR 0010 made this a rule and made "no scope required" *sayable* — an explicit `floor()` — so that omission is the error. If route registration takes that declaration as a **required argument**, omitting it is a type error, and a type error is strictly better than a lint error because the type checker runs on every keystroke while lint runs when something invokes it. Registration therefore reads `route(method, path, auth, handler)` and there is no overload without `auth`.

`floor()` has **three** legitimate uses today: recording work on a Shift you are rostered on, recording an Observation (ADR 0010), and recording your own presence (ADR 0012). That count is stated where the helper is defined, so a fourth is a deliberate act rather than a quiet one.

**Every queueable mutation carries an idempotency key.** ADR 0005 requires it and ADR 0007 states it, and it has the same shape: mutation registration takes a Zod schema that must extend an idempotency-key base, so a keyless mutation does not compile. This is the half of ADR 0007's API rule that lint was never going to hold — lint can see which door a write goes through, not what it carries.

**`forOrg` takes a branded `OrgId`, mintable only from request context.** The lint rule below guarantees that every handle came from `forOrg`; it says nothing at all about the argument. `forOrg(someRow.orgId)` type-checks, lints clean, and hands RLS a faithful scope to the wrong organisation. These are two different invariants — *which handle* and *which org* — and they get one mechanism each.

**`now()` returns a branded `Instant`, not a `Date`.** A wall-clock helper that returns a `Date` is defeated one hop later: `now().getDate()` derives a day boundary in the browser's timezone and passes every check. An `Instant` is epoch millis with no calendar methods, so elapsed time is arithmetic and the calendar is simply unreachable outside the one module that owns it.

## What becomes a lint rule

Six, all deny-by-default, all in `eslint.config.ts`. They are deliberately **type-unaware** — every one is an import, global or literal ban needing no type information — which is what makes running them per-file affordable below.

| Invariant | Mechanism | Exempt today |
|---|---|---|
| Queueable writes POST to `/api/v1`, never a server function | `no-restricted-imports` on `createServerFn` | **2** — login, desktop admin forms |
| No database handle except through `forOrg` | `no-restricted-imports` on `src/db/client` | **1** — `src/db/for-org.ts` |
| No day boundary derived outside the org's timezone | `no-restricted-globals` on `Date`, `Intl`; `no-restricted-syntax` on `Date.now`, `toLocaleDateString`, `toLocaleTimeString` | **1** — `src/server/time.ts` |
| Wire shapes are hand-written Zod | `no-restricted-imports` on `drizzle-zod` | **0** |
| No error report bypasses scrubbing | `no-restricted-imports` on `@sentry/*` | **1** — `src/server/observability.ts` and its browser twin |
| No unversioned API path | `no-restricted-syntax` on `Literal[value=/^\/api\//]` | **1** — `src/shared/api-client.ts` |

**The server-function ban is inverted deliberately.** Lint cannot tell a queueable write from one that can never be queued — *can this be replayed from somebody's pocket on Thursday* is a semantic question. So every `createServerFn` is banned and each legal one is an exemption, which is the only form with no false positives and which puts the count in one reviewable place.

**The day-boundary ban is repo-wide, and that is a change from ADR 0007.** That ADR says *client-side* day boundaries, but ADR 0007 also chose TanStack Start with selective SSR, and the same module renders on both sides. There is no directory that means "the client", so a client-scoped ban is unenforceable at exactly the boundary it cares about. One ban with one exempt module is both simpler and tighter. The replacement is `now()` from `src/shared/time.ts` for a wall clock and `formatDay(dateString, tz)` for display, which is the only place `Intl` is constructed; day boundaries arrive from the server as `date` strings and are computed nowhere else. `src/server/time.ts` does the real IANA arithmetic with **Luxon** — chosen over `temporal-polyfill` on ADR 0007's own instruction to prefer the unfashionable option with a decade of answers behind it, and confined to that module.

**The `/api/` literal ban guards a door that should have no traffic.** With a typed client nobody has a reason to write the path. It is one line, it passes all three clauses of the test, and *nobody would write that* is precisely the reasoning this ADR exists to distrust: an agent reaching for `fetch('/api/shifts')` under context pressure is the most predictable violation on the list, and ADR 0007 makes the version in the path load-bearing for replayed writes.

**The Sentry rule is the weak form, and says so.** It guarantees that every report passes through the wrapper. It guarantees nothing about the wrapper being correct — that is a unit test with a volunteer's name and a mobile number as fixtures. The strong form, inspecting what fields reach the payload, is not statically decidable and fails the test. A rule that implies more protection than it delivers is worse than no rule, and ADR 0007 makes a phone number load-bearing.

## Exemptions are countable, and inline escape hatches do not exist

**There are no `eslint-disable` comments for these rules.** A rule that can be silenced in one line is a rule an agent will silence rather than obey — the exact failure this ADR exists to prevent. The only way to exempt code is a **path override in `eslint.config.ts`**, carrying a one-line reason, visible in one file and appearing in a diff. `linterOptions.reportUnusedDisableDirectives` is `error` repo-wide.

The counts in the table above are stated here so that a seventh exemption is something a person has to write down. **Today: two, one, one, zero, one, one.**

Each rule's message states the correct alternative and the ADR, in one sentence, no URL — these messages are the only documentation anyone reads at the moment they are about to do the wrong thing:

> Queueable writes POST to `/api/v1`; server functions are for writes that can never be queued (ADR 0007).

## The rules are armed, and hit early

**A `PostToolUse` hook runs them on every file write.** ADR 0007 runs lint at pre-push and in CI, which means an agent writing thirty files hits nothing until the end — by which point the wrong pattern is established across all thirty and the correction is a refactor. The hook matches `Write|Edit` over `src/**/*.{ts,tsx}`, runs ESLint limited to these six rules, and **blocks on exit 2** so the violation is fed back immediately. It is scoped to these rules on purpose: a hook running the full config would block on formatting noise mid-refactor, and the only thing permitted to stop work mid-file is this class of error.

**The rules are tested, because a selector that matches nothing is green in exactly the way a clean codebase is.** These are hand-written AST queries and the failure mode is silent — the guardrail reports clean forever and nobody learns it was never armed. A `lint-fixtures/` directory holds deliberately-violating files and a script asserts the **exact violation count per rule**, inside `npm run verify`. It also makes the exemption counts self-checking: change an override, a count breaks, someone reads this file.

## Consequences

**Paths are named here, before the code exists.** `src/db/client.ts`, `src/db/for-org.ts`, `src/shared/time.ts`, `src/server/time.ts`, `src/server/observability.ts`, `src/shared/api-client.ts`. ADR 0007 already committed to `src/db`, `src/shared`, `src/routes` and `src/server`, so this fills in a half-decided layout rather than inventing one. An ADR that says *the module that wraps the handle* instead of naming it is the prose this ticket says agents forget. If the skeleton wants other names, that is a change to this ADR, made deliberately.

**This lands the day the patterns land, and not later.** The whole argument for mechanical enforcement over prose is that it is free while the codebase has zero violations; retrofitting is an afternoon of exemptions and a rule nobody trusts. The application skeleton therefore carries the config and the hook as an acceptance criterion, and the `/api/v1` layer carries the two type constraints.

**Every timestamp now costs an import.** That is the price, it is real, and it is the point.

**This is the first ADR here that adds nothing to `CONTEXT.md`.** The glossary is the barn's language, and `forOrg` is not one of the barn's words. Worth stating once so the omission reads as deliberate.

## What would make this wrong

**The blocking hook becoming a wall.** If it fires on legitimate intermediate states often enough that anyone wants it off, the answer is to narrow its matcher, not to make it advisory — an advisory guardrail is prose with extra steps.

**Exemption creep.** Six rules with six exemptions is a design. The tripwire is the first exemption added without a reason line, or a count in this file going stale, because at that point the config has stopped being reviewable and the numbers are decoration.

**`createServerFn` leaking through a re-export.** An import ban holds only while there is one import path. If a local wrapper re-exports it, the rule is intact and useless — a case fixtures should cover and a reason the rule is tested rather than trusted.

**Selective SSR making the `Date` ban too expensive.** If a genuinely client-only surface turns up that needs calendar work — a date picker in desktop admin is the plausible one — the exit is a second exempt module rather than a client/server split, which selective SSR still cannot express.
