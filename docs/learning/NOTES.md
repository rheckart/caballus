# Working notes

## How Rob learns best (revise as this becomes clearer)

- Lessons are grounded in **this repository**, by file path. Abstract examples are a waste of his
  time; he has a real codebase with real decisions in it.
- He works in a codebase where every decision is written down and argued (ADRs, dense module
  comments). Lessons should match that register: state the reason, not just the rule.
- He has just built the thing being taught. Do not explain what he wrote — explain what he
  _inherited_ (library behaviour, protocol limits, provider requirements) and what will bite later.

## Workspace decisions

- Lives at `docs/learning/` inside the Caballus repo, beside `docs/adr/` and `docs/research/`, so a
  lesson that goes stale against the code shows up in a diff.
- `npm run format` runs Prettier over everything tracked, HTML and CSS included. Written to survive
  reformatting — no significant whitespace in the markup.
- `npm run check:control-bytes` scans every tracked file, so no smart quotes or stray bytes that
  are not plain UTF-8 text.

## Open threads for future lessons

1. **Lesson 2 — the connection URL.** Fastmail vs Resend, `smtp://` vs `smtps://`, and the
   `%40` trap. Highest value next: it is the step between "works locally" and "works at all".
2. **The once-a-year sign-in.** `updateAge` refreshes the session row but nothing applies Better
   Auth's refresh cookie, because `ApiResponse` cannot carry a header (ADR 0020). This is a real
   open design question, not a lesson yet — it needs a source (see `RESOURCES.md` gaps).
3. **What the daily cap protects and what it does not.** `DAILY_CAP` is per-process and in memory;
   a second container doubles it. Worth teaching alongside whatever hosting decision ADR 0006's
   tripwire eventually forces.
4. **Interleaving.** Once there are three lessons, revisit Lesson 1's quiz questions inside Lesson 3
   rather than only at the end of Lesson 1 — spacing is what turns fluency into retention.

## Not yet asked

- Whether he wants to join the Better Auth community, or would rather I keep bringing back answers.
