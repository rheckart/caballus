---
status: accepted
amends: 0010 (a fourth scope-free write; an Observation attaches to an Attendance rather than to a Shift; a Scope holder may escalate)
---

# Every Observation is dispositioned at close, and the Escalation is the report

The ticket named its own make-or-break detail: _an app that swallows reports silently will be abandoned for the group chat._ The Facebook group shows you the replies for free, and nothing else it does matters as much as that.

ADR 0010 had already taken most of this ticket. Routing is a Domain Scope resolved to its holders, not a name and a number. The Lead is the single point of upward communication, so filing and routing are two acts by two people. Everyone reads everything. There is no emergency bypass, because a real emergency is a phone call. What that ADR could not discharge, and handed here as an obligation rather than a suggestion, is this: **an Observation recorded and never escalated is invisible above the Shift.** Most of what follows is the answer to that, and the answer turned out to live at Shift close rather than in a queue somebody was supposed to read.

# Two entities, and the Escalation is the report

An **Observation** is free text with an optional subject, recorded by whoever noticed. An **Escalation** is a separate record: the Lead's act, carrying the Lead's own framing, addressed to exactly one Domain Scope, holding the states and the thread.

The cheaper model was a flag on the Observation — `escalated_to: 'horse_care'` — and it loses on three counts that all point the same way.

The **authors differ**. ADR 0010 was emphatic that filing and routing are distinct acts by distinct people, and a model that stores the second as a property of the first quietly denies it.

The **framing has nowhere else to live**. _"Third time this week, and she left half the bucket"_ is curation — the job ADR 0010 says the app was about to lose — and writing it onto the volunteer's Observation puts words in their mouth.

The **lifecycle belongs to the report, not the sighting**. An Observation is finished the moment it is written. An Escalation has somewhere to go, someone who owns it, and a thread hanging off it.

No third noun enters the vocabulary. `CONTEXT.md` already lists _report_ as a word to avoid for an Observation, and the Escalation **is** the routed report ADR 0010 named. Two entities carry this whole ticket.

# The subject is captured from context, and it is what derives the route

An Observation carries free text and an **optional** subject, taken from wherever the volunteer was standing in the app rather than chosen from a picker. Opened from Storm's card, the subject is Storm. Opened from Field C, it is Field C. Opened from the Shift screen, there is no subject, and that is legal.

The subject is what makes routing derivable without a volunteer ever seeing the org chart:

| Subject                | Suggested Scope                  |
| ---------------------- | -------------------------------- |
| Horse                  | `horse_care`                     |
| Space                  | `maintenance`                    |
| Product                | `supplies`                       |
| a record that is wrong | whichever Scope owns that record |
| none                   | the Lead picks unaided           |

The app **suggests** and whoever escalates **confirms**. That ordering is the whole point: the volunteer says what they saw, and the one person in the loop who does know the org chart is the one asked to name a destination.

A required category was the obvious third option and it is the org chart wearing a hat. ADR 0010's floor is that a volunteer should never have to know who to tell; a dropdown of Domain Scopes at the moment of noticing is exactly that knowledge, demanded at the worst time.

#13 handed this ticket **record-correction** as a kind of Observation — the writing half of the whiteboard's _check for any changes / new info needed on whiteboard_. It needs no machinery at all: the subject is the record, and _"Storm's Feed Schedule does not match what we have actually been doing"_ routes to `horse_care` like a lame horse does.

The subject is a pointer and never a substitute for the words. _T-post on post in A paddock leaning_ says what it means; a Space reference does not.

# Photos are allowed, and downscaled before they enter the queue

The board's maintenance panel is text, but a leaning T-post is a photograph begging to exist, and the brief already attaches photos to care events.

The cost is real and specific. ADR 0005 queues every write on the phone, and iOS has no Background Sync, so the queue drains only while the page is open. A 4MB photo in IndexedDB is a different animal from a 200-byte tick.

So a photo is **downscaled on the client to a long edge of ~1600px and roughly 200KB before it ever enters the queue**, the Observation's text queues independently of the image, and an un-uploaded photo is **Unsent** work like everything else and blocks the Shift from closing.

That last clause is the contested one, and it is deliberate. One rule about Unsent work is worth more than an exception carved for images, and ADR 0005's argument holds identically here: a record that looks complete and is not is the lie the paper system already tells. If photos strand Leads at close, that is evidence to revisit, not a thing to pre-solve.

# No urgency, anywhere

There is no priority, severity or urgency field — not on the Observation, not on the Escalation.

ADR 0010 refused an emergency bypass on the grounds that a real emergency is a phone call and a second path worse than a phone call mostly guarantees somebody uses it instead. ADR 0009 then removed SMS entirely. Between them, an urgency flag changes **nothing about when anyone finds out** — it is a field whose only function is to make one report look more important than the one above it, and once it exists everything is urgent.

What conveys urgency in this app is the Contacts screen and a phone.

# Disposition is the gate at Shift close

Every Observation on a Shift has exactly one **Disposition**, and the Shift cannot close until each has one:

- **Escalated** to a Domain Scope
- **Curated into Shift Notes** — ADR 0012's second exit
- **Noted, no action**

This is the answer to ADR 0010's handoff, and it is a gate rather than a queue for one reason: **close is the only moment when the person who can act on it is standing there holding the phone.** A surfacing queue read later is read by nobody, which is how the paper system already fails.

The gate is also the treatment the app already gives Unsent work (ADR 0005) and an Open Attendance (ADR 0012), for the same stated reason each time. An Observation nobody decided about is the same shape of untruth.

The third exit is what keeps the gate honest. Without an explicit _noted, no action_, a Lead who needs to leave manufactures escalations to get past the door, and a Head starts receiving things nobody meant to send. With it, the dismissal is **recorded**, which converts ADR 0010's invisible failure into a **countable** one: _Leads dismissed 40 of 51 Observations last month_ is the evidence that ADR's reversal clause asks for and could not previously have had. A queue-based design cannot produce that number, because nothing in it forces the decision to be made.

**Each disposition is shown to the whole Shift on the close screen.** That is where the loop back to whoever noticed actually closes — in the room, immediately, including the dismissals, which is the case that would otherwise be the silent swallow. The Facebook group's _you see the replies_ property, recreated without sending anything.

# An Observation attaches to an Attendance, not to a Shift

`CONTEXT.md` defined an Observation as recorded on a **Shift** by someone **rostered**. ADR 0012 then created the **Visit** — an Attendance with no Shift behind it, someone who came to mow, to fix something, or to check on a horse alone. Under the old definition, that person sees the leaning T-post and has nowhere to put it, and the single-upward-path rule has no Lead to route through.

An Observation therefore attaches to an **Attendance**, which is either a Shift or a Visit. On a Visit, **the volunteer dispositions their own Observation at sign-out**.

This is the one place the two-step model collapses to one step, and it is a widening of ADR 0010 rather than a reading of it. It is justified narrowly: that ADR's rule exists so a Head does not receive eleven volunteers' unfiltered output from a Shift, and a Visit is one person with no Lead to defer to. The symmetry holds — disposition happens at close in both cases, and ADR 0012 already made sign-out the Visit's close. The alternative is telling the person who drove out on a Tuesday to go and post in the Facebook group, which is the outcome this entire ticket exists to prevent.

# Shift Authority may record on someone else's behalf

A volunteer with a dead phone, no Account, or gloves and one bar of signal tells the Lead _"the trough in D is cracked"_ out loud. Without a path for that, it either dies in the air or is recorded as the Lead's own sighting, which is a small lie in the record.

So whoever holds Shift Authority may record an Observation **naming another rostered volunteer as the observer**, with actor and observer stored as two separate fields. The record then reads _recorded by Kate, observed by Joy_, which is more truthful than either alternative.

ADR 0012 set this precedent exactly — the Lead may close an Attendance on a volunteer's behalf, because that is what the Lead already does with the paper. It is a small integrity hole, in that words can be attributed to someone who did not say them, and it is accepted for the same reason 0012 accepted its version: the failure it prevents is the one that actually happens.

# Two states, closed with a note, and no reopen

An Escalation is **Open** or **Closed**. Closing requires a note and belongs to holders of the **destination Scope** — not to the Lead who escalated it, and not to the reporter. ADR 0010 has no authorship axis, so having sent something is not authority over it.

**Acknowledged was rejected**, and it is the state everyone expects. It exists to make the reporter feel heard, and a comment does that better and more honestly: _"I've booked the farrier for Tuesday"_ is an acknowledgement carrying information, where a bare **Acknowledged** tap is a read receipt that costs you the reporter's trust the second time it leads nowhere. _Won't do_ is a closing note that says so; a state whose only difference is tone does not need to be a state.

**There is no reopen**, and the thread staying writable forever is what makes that affordable. A comment on a closed Escalation mails its Scope holders, so _"still leaning"_ reaches the Head without the record changing state. A genuine recurrence is a new Observation on the Shift where it was noticed, which is where it belongs anyway.

ADR 0013 refused a reopen for Shifts on the grounds that it needs its own authority question and its own audit story, and both are still true here. The honest cost is stated: **Closed means the Scope holder said their piece**, not that the world is fixed.

# The thread is floor-writable, and that is a fourth scope-free write

Anyone may append to an Escalation's thread. The reporter adding _"it's worse this morning"_ is the highest-value follow-up in the system, and requiring a Domain Scope to say it would be absurd.

This is stated plainly rather than left to accumulate: it is the **fourth scope-free write** in ADR 0010, after recording work on a Shift you are rostered on, recording an Observation, and ADR 0012's recording your own presence. It is the right fourth one — a report nobody may reply to is a noticeboard, not a loop, and ADR 0010's own reversal clause is about people drifting back to the group chat.

Closing still needs the Scope. Commenting does not.

# What the app sends

Three messages, all email, because ADR 0009 left exactly one channel.

**To the destination Scope's holders, one email per Escalation**, sent when the write lands, **coalesced per recipient over roughly ten minutes**. The coalescing exists for a specific artifact of the close gate: a Lead disposing of five Observations fires five queued writes within seconds, and five separate emails at 6:40am is how a Head learns to filter mail from the app. One email listing five reports is the same information and survives.

**To the reporter, one email when the Escalation closes**, carrying the closing note **in full**. Never _"your report was updated, sign in to see"_ — that teaser pattern trains sixty people to ignore the app's mail, and it is useless to a Volunteer who has no Account. This is the highest-signal message the app can send: a direct answer to something a person did, once, to one person.

**On a thread comment, to the destination Scope's holders and the reporter.** Two parties with standing, coalesced the same way, and no subscription model.

**Nothing is sent on escalation itself.** The close screen already told the whole Shift, in the room, at the time. Adding an email would be the same information arriving worse.

The **escalating Lead is deliberately not subscribed** to the thread, and this will read as a bug. ADR 0010 makes the Lead the single point of upward _communication_, not the owner of the outcome; their job ended at the handoff. Subscribing them would put a Lead who works two Shifts a week on the receiving end of every conversation they ever forwarded, which is how a Lead learns to escalate less.

Email reaches Volunteers who have never signed in, because ADR 0009 made an email address required at invite. ADR 0004's daily cap and kill switch apply unchanged.

# Escalations queue, and their email carries the Shift date

ADR 0005 has one carve-out — Cover and Drop never queue — drawn on the line _work that happened queues; a promise about work that has not happened yet does not_. An Escalation is neither, and it goes on the queueing side.

Disposition happens at Shift close, in a barn, on the worst bar of signal of the day. An online-only Escalation would make **connectivity a precondition for closing a Shift**, which is intolerable and would push Leads straight back to texting — the exact failure ADR 0010 says to watch for.

Two consequences follow. The email must carry the **Shift date** rather than implying _just now_, because it may land hours after the fact. And the close gate is satisfied by **recording** the disposition, not by its arrival: the Lead is never held hostage to the network.

# A Scope holder may adopt an Observation

Everyone reads everything, so the Head of Horse Welfare can already see every Observation on every Shift, including the ones a Lead marked _noted, no action_. A holder of a Domain Scope may **escalate any Observation to a Scope they hold**, recorded as an ordinary Escalation with themselves as the escalating actor.

This is not a bypass. Nothing is routed past anyone, because the Head is the top of the route. What it buys is that the dismissal exit stops being final — the safety valve on precisely the failure ADR 0010 named, where Leads dismiss things that mattered. It costs one relaxed check and no new entity. It mildly undercuts the Lead's curation, but a Head reading raw Observations is opt-in and nothing pushes them there.

# Closing writes words, and nothing else

The Head of Horse Welfare receives _"Storm is off her left fore"_, rings the farrier, and closes the report. That closing creates **no** farrier record, no scheduled visit, and no care event.

None of those entities exist in v1, and building one here is #14 quietly growing into a veterinary module. What does exist is nearly free and is the part the rescue will actually use: **an Escalation is linked from its subject's record and shows on the horse's page in every state**, so _three reports about this horse's feet since April_ answers off the reports themselves.

When a scheduling or medical ticket lands, it can consume an Escalation as its trigger rather than replacing this decision. The same holds for `maintenance`, and for `supplies` — where the reorder process is modelled properly on its own ticket rather than pretending a closed report is a purchase order.

# Where reports are read

**A home-screen section that exists only if you hold a Domain Scope with open Escalations addressed to it.** No tab: ADR 0011 was firm that a tab is permanent furniture for something empty most of the time, which is true for fifty-five volunteers here and false for the four people whose job this is. The section is absent for the floor, absent for a Head with an empty queue, and carries a count when it is not — the same discipline as showing the concrete fact rather than announcing a Staffing Gap.

**One browsable Reports screen** that everyone can reach and nothing promotes, because everyone reads everything and it has to live somewhere.

Closed drops off the home section immediately, the browse screen defaults to open with a filter for closed, nothing is ever deleted, and the horse's page shows every report naming her regardless of state.

# The Contacts screen

The board routes by name and number, with hours: _Horse Care Questions on Feed Shifts: text Lori, Joy M., Kate S._ Maintenance is Terry H. Barn supplies is Cathy H. Wolf Creek Equine Clinic's office is marked _9am–5pm M–F_, with a separate emergency line and the property owner beneath it.

ADR 0010 refused to store any of that as **routing**, and that refusal stands — a routing table of people is the fact that outlives its truth. But refusing to route to a number is not refusing to show it.

So there is a flat, **read-only Contacts screen**: name, number, optional hours, optional note. Readable by everyone, since ADR 0010 already distinguishes five posted escalation numbers from sixty volunteers' mobile numbers, and maintained under `roster`. It sits **entirely outside the routing model** — the app never resolves, dials, or escalates to it.

**Business hours are display text, not a modelled availability window.** Nothing in the app makes a decision from them; the human reading the screen at 2am does. Modelling them would be building a scheduling constraint for a system that does nothing but print a phone number.

# The supplies path splits out

_"We're low on Senior"_ is an Observation with a Product subject, escalated to `supplies`, with no special mechanism. That much lives here.

Everything else the board does with supplies does not, and the seam is clean. The **Medicines & Supplements** panel is a product → supplier → prescription catalogue: SmartPaks from smartpaks.com, Previcox and Prascend from Allivet and both prescription, Cosequin and Elevate SE and MQ from Amazon, Cypro and Bute and Banamine from Chewy, Ventipulmin and Betamethasone and Ponazuril and Gabapentin from the vet. The **reorder log** records _"Storm — out of Glucosamine 8/5, Joy notified 7/29"_ — a notification date preceding the out-of-stock date, which means it tracks a **process, not an event**. And the **days-of-supply table** (Outlast 20, Topline 20, Senior 14.5, Pellets 20, Rice Bran 13) is quantitative forecasting done by hand.

A process with a catalogue behind it and a forecast in front of it is not a report, and pretending it is would give the rescue a `supplies` queue full of closed reports and no idea when the grain runs out. It becomes its own issue, depending on #10's `Product`.

# The log book stays, and gets no entity

River's stall card reads: _"On cold rainy days if congested, give 5 mL Ventipulmin. Text Lori — note in Log book."_ One instruction, three actions, one of them a trip to a second physical artifact.

The app models **no log book**. Whatever is written in it is already either a care event on the horse under ADR 0003's tiers, or an Observation. A third container is where things go to not be read.

What the app does do is collapse River's ending: _text Lori and note in the log book_ becomes **one filed Observation**, escalated to `horse_care`. #10 named that as the clearest case on the whole board of the app removing work rather than adding it, and it is met.

V1 does not claim to have replaced the book. It stays in parallel exactly like the whiteboard, under ADR 0006's tripwire, and the printed instruction card gets rewritten when that tripwire fires rather than on launch day.

## Considered options

**One-step filing with the Lead copied** is ADR 0010's own named reversal, and it was not adopted here. It remains the fix if the evidence appears, and the close gate above is what will produce that evidence.

**Auto-escalating an unmet Prep** was #13's explicit invitation to argue an exception to the single upward path, and it is declined. The false-positive argument is decisive on its own — every lunch volunteer who opens the app before the AM shift has finished would trip it, and a channel that cries wolf twice a week gets filtered. Underneath that is a better reason: every escalation in this system has an accountable author, and an app-generated one would not. A Lead looking at the prep-owed panel can escalate deliberately, which is the path already.

**A surfacing queue for unescalated Observations**, instead of a close gate, was the shape the ticket implied. It loses twice: a queue read later is read by nobody, and it cannot produce the dismissal count that makes ADR 0010's reversal decidable.

**A multi-Scope Escalation** for the cracked trough that is honestly both `maintenance` and `horse_care` was rejected. A report addressed to two audiences is a report neither owns, and ownership is the entire thing being bought over a Facebook post — where everything was addressed to everyone and therefore to no one. Two Escalations from one Observation is the accepted duplication.

**A thread subscription model** — everyone who has ever commented — was rejected as a real feature with real cost, for a barn where two people will be on any given thread.

**Editing an Observation** was rejected on ADR 0010's refusal of an authorship axis and ADR 0003's append-only records. A still-**Unsent** Observation may be discarded from the queue, because nobody has seen it and its idempotency key has never been used; discard rather than edit-in-place, so there is never a question of which text the key committed to.

## What this changes elsewhere

**ADR 0010 gains a fourth scope-free write** — appending to an Escalation's thread.

**ADR 0010's Observation widens from a Shift to an Attendance**, which brings Visits in and creates the one-step path described above.

**ADR 0010's escalation authority widens**: whoever holds Shift Authority, _or_ a holder of the destination Scope adopting an Observation.

**`CONTEXT.md`** rewrites **Observation** and **Escalation**, and gains **Disposition** and **Contacts**.

**A new issue owns the supplies process** — catalogue, reorder log, days-of-supply — depending on #10's `Product`.

**#20 keeps the log-book question closed** and inherits the Visit Observation, which bears directly on whether it needs a third exit.

## Consequences

**The close gate is friction at the moment the Lead most wants to go home.** Each disposition is one tap with a derived destination prefilled, and that had better stay true; a two-screen disposition flow would undo this decision without appearing to.

**The dismissal rate is now the number to watch**, and it is the only quantitative tripwire in the whole v1 design.

**The app's entire outbound surface is four emails**: escalation to Scope holders, close to the reporter, comment to both, and ADR 0011's evening staffing digest. That is where ADR 0009's accepted dilution risk lands, and it is small enough to keep an eye on by hand.

**Duplicate Escalations off one Observation are not linked as a pair.** Terry closing the trough report says nothing about the Head's. That is the price of ownership and it is deliberate.

**"Closed" is a weaker claim than it looks**, since the thread outlives it and the world may disagree.

## What would make this wrong

**If Leads dismiss most of what volunteers record.** That is ADR 0010's two-step model failing, the fix is one-step filing with the Lead copied, and that ADR already says to take it quickly rather than argue with it.

**If comments on closed reports become the normal way work gets chased.** Then two states were too few and the reopen this ADR refused is real.

**If on-behalf recording becomes the common path.** It exists for the dead phone and the volunteer with no Account. If most Observations arrive through a Lead's thumbs, volunteers are not using the app themselves, which is a bigger failure than this decision can fix.

**If the Contacts screen starts being edited to change who gets told things.** That would mean it is a routing table after all, and ADR 0010's argument about facts outliving their truth applies to it in full.

**If reports pile up Open.** Nothing in this design chases a Head, by choice — no due dates, no reminders, no escalation of the escalation. A `horse_care` queue thirty deep in March would mean the loop needs a nag, and a nag is a fifth email nobody has yet argued for.
