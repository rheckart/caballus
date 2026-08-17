---
status: accepted
---

# The horse record has three persistence tiers, and care instructions are versioned

"Is this current state or an append-only log?" recurs for nearly every field on a horse. The answer is three tiers and one rule for choosing between them.

**Versioned** — immutable versions carrying a valid-from date, where the current value is the latest: the **feed and medication schedule**, **weather thresholds**, and **grooming assignment**.

**Current state plus an audit entry** — the value is edited in place, and the audit log records who changed what, when and why: **name**, **halter colour**, **blanket size**, **height**, **photo**, and **Space assignments**.

**Measurement series** — append-only, never edited, each entry carrying its date and the person who took it: **weight** and **body condition score**.

The rule: **versioning is for care instructions** — things a volunteer executes, where _"what were we doing then"_ is needed later to explain an outcome.

## Considered options

**Current state plus audit everywhere** was the recommendation during the #10 grilling, on the grounds that the question the rescue actually asks is _"why did this change"_, which an audit entry answers directly, and that audit logging is already a stated requirement so it costs nothing extra.

The rescue rejected it. Reconstructing a past schedule in full — _what was she eating the week she lost thirty pounds_ — is a real requirement, not a hypothetical, and replaying an audit log to rebuild it is both awkward and unreliable. Versioning was chosen deliberately, with the cheaper option understood and declined.

**Versioning everything** was never seriously on the table. A version history of a horse's height answers no question anyone has.

## Consequences

Editing a feed schedule **creates a version**; it does not update a row. Reads resolve the current version, which is the cost paid for reconstructability, and the "changed in the last 14 days" marker on the feed board is derived from version history rather than maintained by hand — strictly better than the whiteboard, whose blue `NEW` underline goes stale until somebody rubs it out.

Note what the tiers protect against, because the incumbent system demonstrates both failure modes at once. The whiteboard **overwrote** what should have been logged: earlier photographs show up to six dated weights per horse where today there are one or two, wiped for space, with nobody having decided to discard them. And it **duplicated** what should have been single: halter colour is recorded both on each name plate and in a separate panel, and the two already disagree.

A weight entry carries an optional **method** (tape or scale) despite #15 concluding no method field was needed. That conclusion was correct about the `LH` prefix — it is the President's initials, an actor rather than a method — and wrong about the consequence. Two people weighed the same horse **23 lb apart on the same day**, which is best explained by weight-tape technique, so how a weight was taken is worth recording and awkward to backfill. It also sets the noise floor: the interface must not present a twenty-pound move as a trend.
