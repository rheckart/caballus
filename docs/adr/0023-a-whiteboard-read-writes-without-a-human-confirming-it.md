---
status: accepted
---

# A Whiteboard Read writes without a human confirming it

A rescue adopting Caballus has no data in it and a whiteboard holding all of it — ten horse rows with stalls, turnout, halter colours, heights and per-shift feed and medication lines, plus the panels of contacts and standing rules beside them. A **Whiteboard Read** photographs one panel and writes the records it can read: Spaces, Horses, Products, Feed Schedule lines, Contacts and Standing Rules. It writes them **directly**, with no step where a person approves each one.

That is the decision, and it is deliberately the opposite of the app's usual posture — _the app never fabricates_ — so the reasoning matters. A confirm step is the manual entry the feature exists to remove: sixty-odd records approved one at a time is the same evening's typing with an extra tap on each. The record is not left unattributable to buy that: `mutation` takes `PersonAuthorization` (ADR 0022), so a Whiteboard Read is run signed in by whoever took the photograph, they must hold every Domain Scope the panel writes into, and each created record carries an audit entry naming them with the reason _read from the whiteboard photograph_.

## Considered options

**A human confirms each record** — rejected above. **A staging table the AI proposes into** — rejected twice over: it is a fourth hand-rolled log of the kind ADR 0019 already refused, and the rows in it are the same review by another name.

## Consequences

A misread feed amount can reach a Feed Schedule with nobody in between. Three things stand in for the review step rather than one:

- **Nothing is confidence-scored.** A model's own confidence is not calibrated and would be trusted anyway. A cell that is not clearly legible is left **blank**, which is the same rule a blank Item already follows.
- **The answer names every gap** — created, skipped as already held, left blank, and could not place — so the person who pressed the button is told what to go and look at.
- **The whiteboard stays up.** Onboarding runs in parallel with the paper, which is the rollout ADR 0006 already assumes.

A Whiteboard Read is additive only and never edits an existing record, so a second run cannot overwrite a correction. It keeps its idempotency key but declares `neverQueued: true` (ADR 0018's rule): it is a desk act done once on wifi, and holding a five-megabyte image in IndexedDB to retry later would buy nothing and cost a second paid call.
