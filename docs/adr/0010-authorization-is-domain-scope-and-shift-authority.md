---
status: accepted
---

# Authorization is a domain scope and a roster position, and nothing else

A volunteer may act because of a **Domain Scope** they hold in the organisation, or because of the **position they hold on one Shift**. There is no third reason. No authorship axis, no ownership axis, no per-endpoint role list, and no wildcard.

Roles are stored rows carrying the barn's own words — _Head of Horse Welfare_, _Volunteer Coordinator_. The mapping from role to Domain Scope is a **constant in code**. Every check is written in scope terms; the role name never appears in a check.

## The scopes

Five are live in v1:

| Scope         | Covers                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `horse_care`  | Horse records, feed and medication schedules, alerts, weather thresholds, grooming assignment; ingests escalated welfare observations; grants Medication Authority |
| `maintenance` | Maintenance and groundskeeping items and their reports                                                                                                             |
| `roster`      | Volunteers, Shift Patterns, standing rosters, shift scheduling, removal from a Shift or from the rescue, volunteer contact details, the audit log                  |
| `supplies`    | Products, the reorder log, days-of-supply                                                                                                                          |
| `grants`      | Conferring and revoking scope-bearing roles                                                                                                                        |

Two more are declared and grantable but guard nothing: `financial` and `events`. The rescue has a Treasurer and an Event Coordinator today, and they should appear correctly in the app's people list before their domains exist. Their later maps then add grants rather than a migration.

`supplies` is an addition to the brief, which does not have it. The whiteboard does: barn supplies route to Cathy H., who is neither the maintenance contact nor one of the three horse-care contacts. The brief's four-way partition — welfare, maintenance, financial, volunteer management — was drawn from the officer list rather than from what volunteers actually report, and the board is the better evidence.

## The roles

| Role                  | Scopes                     |
| --------------------- | -------------------------- |
| President             | all seven, enumerated      |
| Board Member          | all seven, the same bundle |
| Head of Horse Welfare | `horse_care`               |
| Head of Maintenance   | `maintenance`              |
| Volunteer Coordinator | `roster`                   |
| Treasurer             | `financial`                |
| Event Coordinator     | `events`                   |

`supplies` has **no dedicated role**. It is the President's today, held through the enumeration above. When the rescue names the position, adding it is one row in the constant and one grant — and until they name it, `CONTEXT.md`'s rule that the barn's words win means we do not get to invent one.

**Three roles the brief lists do not exist here.** Feed Shift Lead and Feed Shift Co-Lead dissolve into roster positions, because being Lead of _this_ Shift is not something anyone holds between Shifts. Feed Shift Volunteer _is_ the floor, and a role that grants the floor is a role that means nothing. Keeping any of the three as a stored role would be worse than absent: they would look like the thing that authorizes, and something would eventually check them instead of checking the roster.

## Grants attach to the Volunteer, never the Account

A report addressed to `maintenance` has to reach Terry whether or not Terry has ever logged in, and ADR 0006 runs the entire POC with no volunteer accounts at all — so grants hung off Accounts would have nothing to resolve against on day one. It also keeps two acts separate that must be separate: revoking an Account does not vacate a scope, and removing a role does not sign anyone out.

The consequence is a legal and correct state: a Volunteer holding `roster` and no Account, an authorization claim about a person that nothing can currently exercise. ADR 0004 already requires a reachable mobile number for Lead and head roles, so the rule is that **holding a scope requires a reachable contact; it does not require an Account.**

Grant rows carry `org_id` like every other row, and are reachable by the row-level security of ADR 0007.

## Shift authority

The roster position on the copied roster row of ADR 0001 is one of `lead`, `co_lead`, `acting_lead`, `volunteer`. At most one `lead`; any number of `co_lead`; **zero of both is legal**, because that is precisely the state #11 exists to escalate, and a model that forbids it cannot represent the situation it most needs to.

**No check ever distinguishes Lead from Co-Lead.** The brief gives them a character-for-character identical responsibility set, so they must not be two permission sets. They remain two positions because the barn distinguishes them and "who was in charge on Thursday" is a question the record has to answer.

The authority set: set the start time, assign checklist items, drop Discretionary Work when short, curate Shift Notes, escalate Observations, close the Shift.

**Shift authority is final within the Shift's window.** A Head of Horse Welfare sets a horse's feed schedule; the Lead, standing in the barn, decides that horse is not eating tonight, and the Lead wins. An app that makes the person physically present execute an instruction they can see is wrong is an app that gets ignored — which is the map's _the app never decides that work does not need doing_, pointed the other way. But final authority means **authority to deviate and be accountable for it**, not authority to rewrite the instruction: changing a feed schedule creates a version under `horse_care` (ADR 0003), and no Lead can do that. Deviating tonight and rewriting the standing order are different acts, and only one of them is the Lead's.

### When a Shift has no Lead

Two things are true at once, and both are needed.

Officers can act on the Shift. They hold every scope already, so this names a fallback rather than inventing a privilege.

And **any rostered volunteer may claim `acting_lead`**, with the app suggesting one: Medication Authority first, tenure breaking ties. The claim is an explicit act written to the roster row. A silently derived "most senior volunteer" would mean nobody in the barn knows who the app decided was in charge, which is worse than nobody being in charge — the map's _never fabricate a completion_, applied to people rather than to work. Suggestion, not restriction: limiting the claim to the suggested person leaves a Shift leaderless exactly when that person did not show, which is the case this exists for.

`acting_lead` carries the **full** authority set, because a half-authority is a Shift that still cannot close. It stays visibly distinct from `lead` so that #11 can still see a Shift that had no real Lead.

## Medication Authority is a qualification, not a position

`CONTEXT.md` defined it as held by a Feed Shift Lead or Co-Lead, which reads as derived from position. It is not. It is a **grant on the Volunteer**, conferred and revoked under `horse_care`, and it is not a Domain Scope.

The check is: **rostered on this Shift, and holds Medication Authority.**

Two reasons. Being permitted to handle Bute is a training fact about a person that does not stop being true between Shifts and is revocable for cause; under the derived reading there is no place to record that a newly promoted Lead was never trained, and they would be silently authorized to syringe medication the moment somebody dropped them into a roster slot. And #7 needs to answer _will this Shift have Medication Authority present_ while the Coordinator is building a roster two weeks ahead — a question about people, not about a position on a Shift that has not happened.

"Leads and Co-Leads get it" is therefore the rescue's **policy for handing it out**, not the definition. `CONTEXT.md` already records the feed room sign being wrong about who may prepare food; the model should be able to express what the rescue does rather than what the sign says.

This is also what makes the `acting_lead` path safe: an acting Lead without the qualification still cannot medicate, and #7's staffing check still reports the Shift short for medication work.

## The floor

Every Volunteer in the organisation **reads everything** in v1's scope — horses, feed schedules, Shifts, checklists, reports, supplies. All of it is currently on a wall in a barn that every volunteer walks into. Hiding it would be a regression the app cannot justify, and the alternative to deciding this deliberately is deciding it accidentally, one endpoint at a time.

Two carve-outs sit behind `roster`: **volunteer contact details**, because five posted escalation numbers is not the same artifact as sixty people's mobile numbers, and the **audit log**.

Writes need no scope in exactly two cases: **recording work on a Shift you are rostered on**, and **recording an Observation**. Everything else needs a scope.

## Observations reach a Head through the Lead

The Lead is the rescue's single point of upward communication, and the app keeps it that way.

Any volunteer records an **Observation onto the Shift** — floor-level, fast, no org chart to learn, because a volunteer should never have to know who to tell. The Lead curates and **escalates**, and escalation is the act that creates the routed report.

That report is addressed to a **Domain Scope**, which resolves to its current holders at delivery. Not to a name and a number: a routing table of people is the fact that outlives its truth, which is the argument ADR 0008 used to refuse a membership claim in a token, and the board proves it in marker.

There is **no emergency bypass**. A real emergency is a phone call to the numbers already on the board, and a second escalation path that is worse than a phone call mostly guarantees somebody uses it instead.

Because officers hold every scope, no scope is ever literally vacant and routing never has nowhere to go. What the app surfaces in admin is the narrower and more useful fact: **no non-officer holds `maintenance`**. That is a staffing problem to show, not an authorization state to model. And the app never refuses to record an Observation — a volunteer who hits an error mid-shift goes back to the group chat permanently.

## Enforcement

**A typed authorization layer above the `forOrg` handle, not row-level security.**

The instinct is to do what ADR 0007 did for tenancy, since its whole argument is that with agents writing much of this code a leak being structurally impossible is worth the price. It does not transfer. The floor is _read everything_, so scope policies in Postgres would be predicates true for nearly every row — enormous machinery guarding almost nothing, while making every "why did this return zero rows" session worse than the twenty minutes 0007 already warns about. And the subject of a scope check is a **Volunteer**, while what the session has in hand is an Account; the Shift axis is a join, not a session variable.

Scopes bite on **writes**, and ADR 0007 has already funnelled every queueable write through `/api/v1` in Hono with an idempotency key. That chokepoint is where the required-scope declaration is made mandatory — the same trick as `forOrg`, one layer up. The `app.org_id` policies are untouched.

**A denial is explicit and names the scope it wanted.** Failing to zero rows is right for tenancy, where the existence of another org's row is itself the leak; there is no analogous threat when everyone in the org already reads everything. More decisively, ADR 0007 requires a rejected queued write to be explicitly surfaced and never misinterpreted — and a silent empty response is **indistinguishable from success to a retry queue**. A denial must also be distinguishable from a version rejection: _you may not do this_ and _your client is too old_ produce very different things on a phone in a barn.

**#17 gets a fourth rule, and it should be a type error rather than a lint error.** Every `/api/v1` handler declares the authorization it requires, with an explicit `floor()` declaration as the way to say _none_ — so that **omission is the error** and "no scope required" is a deliberate statement rather than an absence. If route registration takes the declaration as a required argument this is enforced by the type checker, which runs on every keystroke; #17 exists because agents forget prose under context pressure, and this is the rule where that is cheapest to prevent.

## What is audited, and what is not

Four mechanisms, separated by **who reads them** rather than by accident.

**Grants and revocations** — roles and Medication Authority — are **audit entries** carrying actor, subject and reason. ADR 0008 put session revocations in the audit log because a `pg_dump` up to fifteen minutes old can resurrect a revoked session; a revoked role has the identical property, so it joins the same line in the restore runbook rather than getting one of its own.

**Shift deviations** — dropping Discretionary Work, overriding a care instruction — are **domain records on the Shift**, not audit entries. #7 already requires the app to record that work did not happen. An audit log records changes to records; a deviation is a fact about the shift, and filing it as audit would hide it from the people who need to see it.

**`acting_lead` claims** are on the roster row, which ADR 0001 already makes a recorded fact.

**Denials are structured logs, not audit rows** — the same stdout JSON ADR 0007 already mandates for every mutation, so "why couldn't Terry do that" is a grep over SSH. An audit table of things that did not happen is a table nobody reads.

Two guards: **nobody grants themselves a role**, and **the last holder of `grants` cannot be removed**, because ADR 0008's bootstrap command should stay a floor rather than becoming a routine. And **removing a Volunteer from the rescue revokes their grants**, audited like any other revocation — the one path where `roster` reaches a grant, which is why keeping `grants` separate from `roster` has to be stated rather than assumed.

## Considered options

**Granting scopes directly, with roles as a UI label**, was rejected because the barn already owns the vocabulary. _Head of Horse Welfare_ is what people say, and it has to be a stored fact for routing, for the people list, and for every conversation about the app.

**A `role_scope` table an administrator can edit** was rejected in the other direction. Nobody at this rescue will ever redefine what Head of Maintenance means, and the price is a permissions-editing screen, its own audit problem, and a system whose behaviour cannot be read off the source.

**Scope × action (`read` / `write` / `admin`)** was rejected because with a read-everything floor and officers spanning everything, roughly two cells of that matrix vary and the rest are constant. A matrix whose only real function is to be filled in wrong is worse than a binary flag. If a genuinely read-only variant ever appears, it is a new scope, not a new dimension.

**A President wildcard that short-circuits every check** was rejected as a second code path through authorization, reliably the one nobody tests. ADR 0008 already refused a god-mode path; a wildcard is god-mode with better manners. Enumeration also buys deliberateness: when `medical` arrives, somebody has to decide whether the President reads diagnoses rather than having them inherit it silently.

**Letting `roster` grant roles** was rejected because it makes `roster` transitively every scope, which would render the domain partition this whole decision rests on decorative. Hence `grants`, held only by officers.

**Letting the observer file the routed report directly** was the assumption in #14, in the map's table, and in the first pass at this decision. The rescue corrected it: the Lead is the single point of upward communication. Two steps turns out to be the better model anyway — the volunteer still never has to know the org chart, the Lead's curation is a real job the app was about to lose, and a Head stops receiving eleven volunteers' unfiltered output, which is how an app gets muted.

**Event sourcing** was considered for the whole record and declined, and it is recorded here rather than left implicit because the four audit mechanisms above otherwise read as accumulation instead of as a decision.

The reason specific to this project is row-level security. ADR 0007 bought exactly one structural guarantee: policies over typed columns fail _closed_. A policy over a JSONB event payload fails **open** the moment an event type forgets to write `org_id`, so an event store would trade away the single thing the stack was chosen for.

ADR 0003 also already answered the general form of this question twice. It considered _current state plus audit everywhere_, rejected it; considered _version everything_, rejected that; and landed on three tiers chosen by what question each field has to answer. _Derive everything from the log_ is the third member of that family and loses to the same argument: it is a uniform answer to a question the domain answers non-uniformly. A horse's height genuinely needs no history. Its feed schedule genuinely does.

What event sourcing would actually buy is three things, and two are already delivered. Temporal reconstruction — _what was she eating the week she lost thirty pounds_ — is ADR 0003's versioning, for exactly the fields that need it. Reactivity is pg-boss on the same Postgres, where the write and the job it triggers commit together. The third, rebuilding projections in a shape nobody anticipated, is worth real money at scale and approximately nothing at eleven horses and sixty volunteers with a solo maintainer. Meanwhile the cost lands where ADR 0006 is thinnest: adding _rebuild projections_ to a restore runbook makes its ~1h RTO stop being true, and that number is only real because the restore is rehearsed by hand.

## Consequences

**An audit table is derived; an event store is the app.** Keeping it derived is what keeps the restore simple — the audit log could be lost without losing the application, and that is the property being protected.

**Three roles from the brief are gone**, which will read as an omission to anyone who checks the brief against the code. Feed Shift Lead is the one to watch: it is the most natural thing in the world to add it back as a role, and doing so would immediately create two answers to "may this person medicate."

**`Scope` is now overloaded and has been renamed.** `CONTEXT.md` already used _Scope_ for which horses a piece of work applies to — the barn's sense, and the barn's word wins. The authorization concept is **Domain Scope** everywhere, in prose and in code.

**Shift Notes arrived from this grilling with no prior definition**, are curated by whoever holds Shift authority, and are #13's to specify beyond the glossary entry.

**An Observation recorded and never escalated is invisible upward.** The Facebook group fails the same way, so this is not a regression — but the app can see it where the group could not, and #14 owns making unescalated Observations on a closed Shift surface rather than settle. This is the ticket's sharpest handoff and the likeliest place for the two-step model to fail in practice.

**The `supplies` scope has no holder but the President**, so its reports land on the President until somebody is named. That is the correct behaviour and also a standing prompt: the admin screen showing "no non-officer holds `supplies`" is the app asking the rescue a question it has not answered.

## What would make this wrong

**If baths, grooming, recurring care, the reorder log and attendance each end up hand-rolling an append-only table with its own replay logic**, the domain is saying it is event-shaped, and the result will be an event store built badly and by accident rather than deliberately. The map already lists three of those five as unspecified schedule-history-overdue triads, so this is not hypothetical. The tripwire is the third one that gets hand-rolled.

**If the two-step Observation flow measurably loses reports** — volunteers recording things that Leads never escalate, or volunteers going back to texting because escalation felt slow — then single-point routing was the wrong read of the barn, and the fix is the one-step flow with the Lead copied rather than gating. That is a reversal of this decision's most contested branch and it should be taken quickly if the evidence appears, not argued with.

**If a permissions screen is ever requested**, the role-to-scope constant is the wrong shape and the `role_scope` table rejected above becomes right. Nothing else in this decision changes with it.
