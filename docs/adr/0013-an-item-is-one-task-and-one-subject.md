---
status: accepted
amends: 0003 (three new records join the versioned tier; a Feed Schedule line may carry a Condition)
---

# An item is one Task and one Subject, materialized once a day and never regenerated

The brief said the thing that matters most about this ticket in a single line: **completion is not a single boolean on the shift**. Everything below is the shape that falls out of taking that seriously, and the shape is smaller than the ticket's list of open questions suggested, because four of them turned out to be the same question asked about different tasks.

The whiteboard is the reason to be careful here. It is not a list of twelve chores. It is twelve chores, a red-ink correction about hay amounts that somebody had to write because people were getting it wrong, a water procedure with five exceptions, a per-horse grooming column, a per-horse blanket table, an alternate hay plan that applies only on hot days, a cross-shift prep chain three links deep, a salt-block check that appears on no list anywhere, and a separate closing checklist screwed to the wall. A model that can hold the twelve and not the rest is a model that loses the parts the rescue had to learn.

# The item is a (Task, Subject) pair

One tickable item is one **Task** applied to one **Subject**, where a Subject is a Horse, a Space, or the rescue as a whole. Feed × Apollo. Water × Field D. Sweep × the rescue. Salt blocks × each Space.

The pressure on this grain came from the board's sub-procedures, and it is worth recording that we declined to follow them down. Water is not "fill it" — it is dump the dirty water in the grass, refill only half way, one bucket unless the horse is staying in, small troughs to cover the heat element, large troughs half way, a scoop of electrolytes in new water, scrub if there is algae, and D trough fills to the top as a standing exception to the half-way rule. Hay is not "hay done" — it is per-receptacle target levels across hayhut, haynet, haybox, hay pouch and named spots like Fence and Run In.

All of that is **instruction text on the item**, not more items. Twelve horses and eight-odd Spaces already generate something near ninety items on a Feed Shift; taking hay to per-receptacle would push a single shift past a hundred and fifty ticks on a phone held in a glove. The tick count is the thing that decides whether this app is used or abandoned, and the red hay correction is evidence of a **comprehension** failure rather than a tracking one — the rescue needed the sentence read, not each hayhut audited individually.

The price is explicit: this model cannot answer *which receptacle was missed*. If that question ever gets asked in anger, the fix is to promote receptacles to Subjects, and the grain is where to make that change.

# The catalogue is data, and its structural properties are a closed set

A **Task** is a record the rescue edits, not an enumeration in code. The brief's twelve were already wrong before we finished reading the board — salt blocks, bedding carts and feed cans are none of them, and the weather rules will add sheets, blankets, fans and fly sheets. A code-only catalogue means every change in the barn is a deploy, and the barn changes faster than that.

What a Task carries is fixed, and this fence is the whole reason the decision is safe:

- **subject kind** — horse, Space, or rescue
- **priority** — Essential or Discretionary
- **period** — Shift or Day
- **requires Medication Authority**
- **an optional Condition gate**
- **a nullable tolerance**
- **a closing flag**
- **generic instruction text**

The rescue may add a Task and choose from those properties. It may not invent a new one. A catalogue with open-ended behaviour is a workflow builder, and nobody at this rescue wants to configure a workflow builder — they want to add *check the salt blocks* without waiting for a release. Editing sits under `horse_care`, which fits every task on today's list and will need revisiting the first time a genuinely maintenance-side task wants a catalogue entry.

# Which Shift normally does it is a property of the pair, and it is the `GROOM` column generalized

The board already solved this once and we nearly modelled it twice. The `GROOM` column holds `AM` or `PM` per horse — grooming is not assigned on the day by a Lead, it is a standing property the Shift inherits. Mucking stalls turned out to have exactly the same shape: AM takes stalls 6 through 10, PM takes 1 through 5.

So there is one record, the **Task Assignment**: for a given (Task, Subject), which Shift Type normally does it. It lives in ADR 0003's **versioned** tier alongside the grooming assignment it generalizes, and it keeps #10's three states — assigned to a Shift Type, deliberately assigned to none, or **not yet decided**. That third state is load-bearing for the reason #10 gave: Mystery and Nora's blanks in the `GROOM` column are a gap rather than a rule, and a model that renders *undecided* as *no work* silently converts an unanswered question into a settled one.

**It is a default, not a division.** The item still belongs to the Day and either Shift may complete it, which is what #7 required. AM's screen foregrounds stalls 6 through 10 and shows 1 through 5 collapsed as *PM's, not yet done*; an AM volunteer with time who mucks stall 3 has completed an item, not committed an error.

Period and assignment are independent properties, and stating them together sorts the list cleanly:

| | period | assignment | priority |
|---|---|---|---|
| Feed | Shift | none — every horse, every Shift | Essential |
| Water | Shift | none | Essential |
| Muck stalls | Day | 6–10 AM, 1–5 PM | Essential |
| Groom | Day | the `GROOM` column | Discretionary |

# Items materialize at the start of the Shift's day, and are immutable thereafter

ADR 0001 has Shifts **copy** their roster two weeks out, because *who was supposed to be there on the 14th* has to be a fact recorded at the time. The checklist deliberately does not follow that precedent, and the reason is that the two are differently situated: a roster is a promise made to people, while a checklist is a consequence of care instructions that already carry their own version history. Freezing the list a fortnight early buys reconstructability that ADR 0003 gives for free, and costs correctness — a horse may arrive or depart, a Feed Schedule may change, and the weather Condition is simply unknowable that far out.

Nor is the list derived live at read. It is materialized **at the start of the Shift's day**, resolving the versioned care instructions and evaluating each Shift's Conditions, and it does not change after that.

Start-of-day rather than at-open, because an **Unstaffed Shift must still be able to report what went undone**, and a list that springs into being only when somebody opens the Shift would leave the worst shift of the year with no record at all. Before materialization the Shift shows a live-derived preview, labelled as not yet fixed.

Immutability holds through mid-day change too, and there it is not merely consistent but correct. When a horse departs at noon, its morning items stay — that horse genuinely needed feeding at 6am. When Blue moves from stall 4 to stall 7, muck × stall 4 stays, because stall 4 has a day's muck in it regardless of who lives there now. A departed horse's remaining items show the departure on the card and a person resolves them. The app does not decide on anyone's behalf that work evaporated.

# Four outcomes, and blank is always reported as blank

ADR 0005 already established that a tick is a claim by an actor rather than a boolean being flipped. What an item can end as:

- **Done**
- **Dropped** — Discretionary items only, requires Shift Authority, carries a reason
- **Not done** — available on anything, carries a reason
- **blank** — the default, meaning nobody answered

Two states were deliberately refused. There is no **N/A**: an item that does not apply should never have been generated, and an N/A button is how an app quietly learns to make work disappear — the failure #7 rejected outright. There is no **partial**: the honest expression of half-done is Not done with a reason.

Blank is never rendered as anything softer than blank. At close the Shift reports the count of unanswered items and the closer acknowledges it.

**Reversal appends and never deletes.** ADR 0010 refused an authorship axis, so *may I untick what I ticked* cannot be governed by having ticked it — any Volunteer rostered on the Shift may change any outcome while the Shift is open. The item holds a series of claims and its current outcome is the latest, which keeps ADR 0005's replay safe.

# Assignment to a person is a hint, and never a gate

The brief has a Feed Shift Volunteer completing "items assigned to them by the Lead/Co-Lead", and ADR 0010 put assigning items in the Shift Authority set. But assignment does not gate completion: every item is completable by any Volunteer rostered on the Shift.

A gate would break on precisely the shift that most needs to work — three people, no Lead, an item nobody is permitted to touch. ADR 0010 already set the floor at *recording work on a Shift you are rostered on needs no scope*, so a per-item gate would be a third authorization axis smuggled in past the two that ADR has.

What a three-person barn shift actually needs is not permission control but *I've got the stalls*, so two people do not muck the same one. **Self-claim is the same field used in the other direction**, and is the form we expect to see used.

# Feed and Medicate are separate items

The feed room sign says *"Only FSL's + CL's prepare grain + meds. Other volunteers can add water + stir"* — one item split by role mid-task, which ADR 0010 correctly identified as inexpressible on its two axes and warned against solving with a third. The solution is not authorization at all. It is grain.

A horse gets a **Feed** item when its Feed Schedule for that Shift Type has non-medication lines, and a **Medicate** item when it has medication lines. Feed is never gated. Medicate requires Medication Authority. #10 made a line's kind derivable from its Product, so this is computed rather than declared.

This encodes the practice and visibly disagrees with the sign, which #7 established is correct: food prep is not restricted, and somebody should update the sign. It also makes #11's Staffing Gap check a straight count — *does this Shift have Medicate items, and is anyone rostered who can do them* — rather than an inference over schedules.

What it does not solve: when a Route puts medication in the feed, the two items are not independent in time. That ordering rides on the before/after-meal modifier #10 already structured, as instruction, and the app does not enforce it.

# Prep for a later Shift points at a Shift Type

The AM leads forgot Dawson's lunch soak and the lunchtime volunteer found out by opening an empty bucket. The chain is three deep — AM preps for Lunch, Lunch preps for PM, PM feeds it — and there are non-horse versions that cross midnight: *fill feed cans if low for next shift*, *fill bedding carts for next shift*.

A prep item carries a **target Shift Type**, resolved at display time to the next Shift of that type. It does not carry a pointer to a specific consuming item. An edge would need both endpoints to exist and to pair one to one, and neither holds: the day boundary breaks it for feed cans, and those two have no counterpart item at all, because the thing they feed is a whole shift rather than one task.

The consuming Shift gets a **prep-owed panel** on its opening screen, and the per-horse card carries the earlier prep's outcome inline — the treatment the feed board prototype already demonstrates on Dawson.

**An unmet prep surfaces; it does not send.** ADR 0010 made Escalation the Lead's deliberate act and the single upward path from a Shift, and an app-generated escalation would be a second path that fires on every lunch volunteer arriving before the AM shift has finished. A prep still unmet when the consuming Shift closes becomes a **Not done** with its reason prefilled: a visible record, in the vocabulary that already exists, costing no new machinery and no new notification.

# A Condition gates items, and an alternate plan is a second gated set

A **Condition** is a named predicate evaluated per Shift and snapshotted onto it. What the predicates are, what data feeds them, and where their numbers live is #16's, and the contract between the two tickets is narrow enough to state in a sentence: *evaluated per Shift against that Shift's own window, at materialization, and frozen*.

Per Shift rather than per day matters — a day that starts at 30° and reaches 85° is one day and two entirely different Shifts, so a single daily evaluation would be wrong for one of them.

Substitution is not a special mechanism. The board's *IF STAYING IN* hay panel replaces the per-Field hay regime with a per-**horse** one, so the subject kind itself changes and it cannot be one item with varying text. Instead the normal hay items are gated on the Condition being false and the alternate ones on it being true, and only one set materializes. The optional Condition gate on the Task is all this needs.

Two things follow that are worth naming rather than discovering. It is an **authoring hazard**: nothing in the model stops someone gating two sets on conditions that can both hold, and the barn gets doubled work — the mitigation is that the materialized list is visible before the Shift, not a constraint in the schema. And **Storm's two scoops of soaked alfalfa pellets mean a Feed Schedule line needs an optional Condition**, which is a fourth optional field on a model #10 already resolved.

**The plan does not change mid-shift.** #7 already requires the evaluated result to be snapshotted so that a volunteer who sheeted four horses at 6am does not later appear to have done it for nothing. Items materializing on a phone mid-shift is a hostile interface, and items vanishing is the make-work-disappear failure again. Shift Authority is precisely the authority to deviate from a care instruction and be accountable for it, so *it warmed up and we did not blanket* is a Not done with a reason — which is the record the rescue wants anyway.

# Instruction text has two layers, and both are versioned

The board has generic corrections that apply everywhere — *these amounts are totals that should always be in the receptacles, NOT what should be put out every shift* — and subject-specific exceptions: *please fill D trough to the top* against the standing half-way rule, and *only use the yellow bottle by his stall labeled with his name* for Badger's fly spray.

Both render on the item, generic first and specific second. Generic text lives on the Task; specific text lives on the Task Assignment, which already exists per (Task, Subject), so no new entity appears.

Instruction text goes in the **versioned** tier by ADR 0003's own rule — it is a care instruction someone executes, and the hay correction is exactly a case where *what were we doing then* explains an outcome later.

# Discretionary tolerance counts any outcome that is not Done

#7 asked for consecutive Shifts skipped rather than a last-done date, because *stalls not mucked for 3 shifts* is a sentence a Lead can act on while *last mucked Tuesday* makes them do arithmetic in a barn. The numbers were left unset and remain the rescue's to set, per Task, nullable, with null meaning never overdue.

**A skip is any outcome that is not Done** — Dropped, Not done and blank alike. Counting only honest Drops would let a Lead dodge the counter by leaving items unanswered, rewarding the worse behaviour with the cleaner record.

The counting unit falls out of `period` with no new concept: days for per-Day tasks, Shifts for per-Shift ones. Both produce a sentence somebody can act on — *stall 4 not mucked for 3 days*, *Blue not groomed for 5 days*.

At the limit, **the item shows as overdue and the Drop action is withdrawn**. It can still go undone, because the app never blocks the barn, but it can no longer be filed as a clean drop — it becomes a Not done with a reason. A real consequence, and not another thing to send.

# Closing is items, and blanks do not block

The Leads' closing checklist — gates fastened and secure, lights off in the tack room, feed room and loft — is not a second entity. It is Tasks with the closing flag, subject rescue or Space, shown in a final section, with the same outcomes and the same actor attribution as everything else.

What blocks a close was already settled elsewhere and is unchanged: **Unsent** work blocks it (ADR 0005) and an **Open** Attendance blocks it (ADR 0012). Blank checklist items do not block. The close screen states the count of unanswered items and requires a deliberate confirmation, which is the honest position between blocking a Lead in a dark barn and letting a Shift record itself clean.

Closing needs Shift Authority, so a Shift with nobody holding it needs #11's Acting Lead claim before it can close. And **a Shift nobody staffs never closes**, because ADR 0012's principle is that the app never closes what a person did not — consistent with a Shift that is never cancelled and stays visible and escalating.

# Late claims are accepted, and the close record stays true

ADR 0005 blocks close on Unsent work, but that block is **per client**. The Lead's phone has no way to know that a volunteer walking to their car has three unsent ticks in IndexedDB, and iOS will not drain them until that person opens the page again, possibly the following morning.

A claim arriving for a closed Shift is **accepted and marked late**. Rejecting it would throw away work that actually happened, which is the one thing this whole model refuses to do. The claim appends with its own timestamp, the item's outcome updates, and the close record remains a truthful snapshot of what was known at close — the item is an append-only series and the close is a point-in-time fact, and the two coexist without contradiction.

There is no reopen mechanism in v1. It would need its own authority question and its own audit story, and the late-claim path covers the case that actually occurs. A correction noticed afterwards is an Observation, or a note on the next Shift.

# Shift Notes

An ordered list of appended entries, each with an author, a time, and an optional Horse it concerns — not one free-text field, because a field is edited by overwriting and the second Lead of the day would silently erase the first. A handover log that loses handovers is worse than none.

Curated by whoever holds Shift Authority, per ADR 0010, and frozen at close. They surface to later Shifts **by Shift date rather than by a pointer**: #7 deliberately rejected a previous-Shift pointer, because the AM Shift's successor is Lunch for two horses and PM for the other nine. Recency sidesteps the problem — Lunch and PM both see the morning's note without anyone defining what follows what.

By date rather than by close, specifically, because a Shift nobody staffs never closes and its notes would otherwise never surface.

# Newness is global, derived, and ages out

The Leads' closing checklist ends with *check for any changes / new info needed on whiteboard* — the board maintaining itself. It is two things, and both survive.

The reading half is a **new marker**, global and derived from version history, with a window set per record type. ADR 0003 already committed to this for Feed Schedules at fourteen days, on the grounds that a derived marker is strictly better than the whiteboard's blue `NEW` underline, which went stale until somebody rubbed it out. It extends to everything in the versioned tier — weather thresholds, Task Assignments, instruction text — plus Alerts and newly added catalogue Tasks. Not the measurement series: a new weight is a reading, not an instruction to notice.

Global rather than per-viewer was the live question, and per-viewer lost for one reason. It is individually smarter and collectively useless: a Lead cannot say *there is a new instruction on Storm* and rely on anyone else seeing what they see, because every volunteer's board would differ. It would also need per-Volunteer last-seen state on every record, a second source of truth beside the version history that already answers the question. *Show me what changed since my last Shift* is served as a **filter over the same global marker**, which gives the per-viewer view without a second definition of new.

The writing half — *the board needs updating* — is an **Observation**, handed to #14. No new entity: an Observation is already something a volunteer noticed, recordable by anyone with no scope, escalated by the Lead to a Domain Scope, and *Storm's Feed Schedule does not match what we have actually been doing* fits that description exactly and is addressed to `horse_care`.

# Pop-ups author their list

A Pop-up generates nothing. Its creator composes the list, picking Tasks from the catalogue and naming subjects explicitly — which is what `CONTEXT.md` already implies when it says Pop-ups carry an explicit horse list. Everything downstream is identical: same item shape, same outcomes, same assignment-as-hint, same close.

A Pop-up may also carry a **free-text one-off item** with an optional subject and no priority, period or tolerance. *Walk the fence line after the storm* is a genuine one-off, and forcing it through the catalogue is how a catalogue fills with dead entries about a storm in June. This is a wart and is recorded as one: it is the only place an item exists with no Task behind it, and every query over items must tolerate that.

# The work surface is subject-first

One card per Horse carrying that horse's items — feed, medicate, groom, fly spray, sunscreen. One card per Space carrying its items — hay, water, muck, salt blocks. A short rescue-level list for sweeping and the closing items.

The reason is physical: a volunteer's loop runs by location and animal. You finish Field C and then Field D; you do not do all the water in the rescue and then all the hay. It also matches how the board is already laid out, in rows per horse, and it is what `CONTEXT.md` means by the shift prep queue being *the per-horse work list a volunteer actually works from*.

A Lead divides labour by task — *you take all the water* — and that is served by a **task-first filter over the same items**, not a second organization.

## What this changes elsewhere

**ADR 0003 gains three records in the versioned tier**: the Task Assignment (generalizing the grooming assignment already named there), generic instruction text on a Task, and subject-specific instruction text on a Task Assignment.

**A Feed Schedule line may carry an optional Condition.** This is an amendment to the model #10 resolved, forced by Storm's alfalfa pellets appearing only when horses stay in. Fourth optional field beside Product, amount and Route.

**#16 receives a contract rather than a constraint**: a Condition is a named predicate, evaluated per Shift against that Shift's window at materialization, and snapshotted. What the predicates are and what feeds them is untouched by anything here.

**#14 receives record-correction as a kind of Observation**, which is what the whiteboard's self-maintenance line becomes.

**`CONTEXT.md`'s Discretionary Work entry is refined**: the tolerance counts any outcome that is not Done rather than only skips, its unit follows the Task's period, and reaching it withdraws the Drop action.

## What this does not do

**No receptacle-level tracking.** Hay is one tick per Space and the model cannot say which hayhut was missed.

**No enforcement of ordering.** Before-the-meal medication, soak lead times and prep-before-consumption are all instruction. The app shows them and does not block on them.

**No reopen.** A closed Shift stays closed; late claims append and corrections go through Observations.

**No computed soak lead time.** Soak stays a flag with a free-text duration. The routing it would drive is already carried explicitly by prep-for-later's target Shift Type, and the only thing a structured duration would buy is a *you are prepping this too late* warning that nobody can act on at 6:15am in a feed room.

**No second notification.** Everything this ADR adds is surfaced, and the only thing the app sends about Shifts remains #11's evening digest.

## Consequences

**Ninety-odd items on a Feed Shift is the number to design the interface against.** Subject-first grouping is what makes that survivable, and any change that flattens it back to one list undoes the grain decision without appearing to.

**Materialization is a job that must run.** A daily process resolves versioned instructions and evaluates Conditions for every Shift on the day. If it fails, Shifts have a preview and no items, which is a visible failure rather than a silent one — but it is now a piece of infrastructure that ADR 0006's single VPS has to actually run on time.

**A per-Day item is nobody's failure until the day ends.** AM can close with muck × stall 4 blank and that is correct. The closing report must distinguish *blank and still satisfiable today* from *blank and the day is over*, and the second sentence has no natural moment to be said — it needs the end of the day, not the end of a Shift.

**The catalogue is a surface the rescue can damage.** Adding a Task with the wrong subject kind generates the wrong items for everyone. This is the accepted cost of not requiring a deploy per barn change, and it argues for the materialized list being reviewable before a Shift rather than only during it.

**The tri-state on Task Assignment will be tempted into a boolean** the first time somebody writes a query that treats *not yet decided* as *not assigned*. That is exactly how Mystery and Nora's blanks would become a rule the rescue never made.

## What would make this wrong

**If volunteers tick items in bulk at the end of a Shift.** The whole design assumes a tick is a claim made at the moment the work happened. Retrospective bulk ticking would make the timestamps fiction, the prep-owed panel useless, and the whole record no better than the paper — and it is the natural behaviour if the interface makes ticking during work at all awkward.

**If blank becomes the normal outcome.** Refusing N/A and refusing partial only works if the four states are actually used. If Shifts routinely close with forty unanswered items and the acknowledged count becomes a button people tap through, then blank has quietly become N/A and the refusal bought nothing.

**If the free-text Pop-up item spreads.** It exists for genuine one-offs. If it becomes how people avoid the catalogue, then items without Tasks are the norm, and every property this ADR hangs on a Task — priority, period, tolerance, gating — is absent from a growing share of the work.

**If the rescue asks which receptacle was missed.** That is the grain decision coming back, and the answer is to promote receptacles to Subjects rather than to add a sub-item concept beside items.

**If Conditions gate more than a handful of items.** Two mutually exclusive gated sets is comprehensible. A checklist where a third of the items are conditional is one nobody can predict the shape of, and the authoring hazard stops being theoretical.
