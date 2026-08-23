---
status: accepted
extends: 0014 (the floor records an Observation; it does not raise an Alert — the first deliberate narrowing of "a volunteer should never have to know who to tell"), 0003 (the Alert is a fourth member of the current-state-plus-audit tier), 0013 (the Alert/Task line: a standing fact that generates no work is not a Task)
---

# An Alert is standing, scoped to `horse_care`, and is not an Observation

`CONTEXT.md` has defined an **Alert** since #32 — a standing warning on a horse that a volunteer must read before working with it, a prohibition, a care alert or an allergy — and until #60 nothing wrote one. The horse profile held the heading, the Board held the column, and `api-contract.ts` said so in two places on purpose. It is the one gap that blocks go-live: a new volunteer reading a profile and not being told the horse bites is the failure the paper board does not have.

Three things about it are surprising, and each was a real choice.

## An Alert is its own record, not an Observation grown up

The obvious move is to make an Alert a fourth Disposition (ADR 0014): a volunteer records "she bit me", somebody dispositions it as _raise an Alert_, and the Observation becomes standing. It was rejected on lifetime. An Observation is **frozen the moment it reaches the server** and is never edited or deleted, because it is a record of what one person saw at one moment. An Alert says what is **always true** and therefore has to be endable — the horse stops biting, the allergy turns out to be something else. Making the standing thing a mode of the immutable thing means you can never end it cleanly, and the two would be fighting over the same row forever.

They stay unlinked in the data. An Observation is very often _why_ somebody raised an Alert, and the note on the Alert is where that gets said. A foreign key would suggest a lifecycle they do not share, the way an Escalation deliberately shares none with the Reorder created from it (ADR 0019).

## Only `horse_care` raises one, and this narrows ADR 0014 on purpose

ADR 0014's whole argument is that a volunteer should never have to know who to tell, which is why an Observation sits on the floor and needs no Domain Scope. An Alert does not get that door. Raising and ending are both `horse_care`.

The trade-off is real and it was weighed. A volunteer who discovers on a Saturday that a horse has started biting cannot post the warning themselves; they record an Observation, which escalates, which mails the Scope's current holders — a delay of hours. Against that: an Alert anybody may post is a wall of notices nobody reads, which is precisely the Facebook-group failure ADR 0014 exists to fix, and it is **permanent** where the Saturday delay is not. An Alert earns its place at the top of the profile by being rare. The floor already has a door and it is the Observation.

Loosening this later is a one-line change to an authorization. Tightening it after two years of accumulated noise is not, which is the asymmetry the decision turns on.

## An Alert is current state with an audit entry, and ending it needs a reason

It is a fourth member of ADR 0003's current-state tier, beside name, halter colour and Space assignments. It is **not** versioned: versioning is for care instructions a volunteer executes, where _what were we doing then_ explains an outcome, and an Alert is a thing to know rather than a thing to do. It is not a measurement series either.

Ending is a date and an actor and **never a delete**, the same shape as a horse's departure (ADR 0002), and it carries a **required reason**. The audit entry answers who and when; only the reason answers _why the biting Alert is gone_, which is the question actually asked six months later. Every other end-of-life act in this application already carries one — closing an Escalation, closing a Reorder, revoking a grant.

Ended Alerts leave the profile's standing section, the Work Surface card and the Board, and are readable in an **ended** section on the horse profile, on the read-everything floor rather than behind `roster`. The history must not leave with the record, which is ADR 0002's own argument for a departure date, and _she used to bite and we stopped saying so_ is care history the floor already reads everything of.

## Consequences

The Board renders the Alert's **full text** in the cell it has been holding, not a count. "2 alerts" on a wall read across a barn tells nobody the horse bites, which is the failure this decision exists to prevent; the paper board writes the words, and so does this.

An Alert applies to a **horse and nothing else**. A standing warning about a Space — a broken gate latch — is a maintenance Escalation, which already routes to a Scope and already closes. Widening to Spaces later is a nullable column; narrowing later is a migration.

The whiteboard read (#59, ADR 0023) **still does not read the ALERT column**, and this decision is why rather than an omission. ADR 0023 permits writing without a human confirming each record on three rules, and an Alert breaks the first: the model would have to **guess the kind** from a scrawled abbreviation, and a mis-kinded safety fact is worse than the blank the rule already prescribes. It can land as its own ticket where the report names every Alert for a `horse_care` holder to check, the way created medications already are.
