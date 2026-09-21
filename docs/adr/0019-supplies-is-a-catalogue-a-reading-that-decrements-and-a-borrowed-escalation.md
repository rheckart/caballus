---
status: accepted
amends: 0010 (Barn Manager is a Role and `supplies` has a holder; a Product is editable from either of two Scopes), 0011 (the evening digest gains a supplies section), 0014 (a `supplies` Escalation may be consumed as a Reorder's trigger)
---

# The catalogue hangs off Product, the forecast is a reading that decrements, and the Reorder borrows the Escalation

ADR 0014 kept the thin half of supplies and named the rest as somebody else's problem: _"we're low on Senior"_ is an Observation with a Product subject, escalated to `supplies`, with no special mechanism. What it refused was everything else the whiteboard does — a product → supplier → prescription catalogue, a reorder log that records a process rather than an event, and a days-of-supply table doing quantitative forecasting by hand. Its reason was exact and still holds: _a process with a catalogue behind it and a forecast in front of it is not a report_, and modelling it as one leaves the rescue with a `supplies` queue full of closed reports and no idea when the grain runs out.

ADR 0010 had already drawn the boundary this ticket fills in. Its scope table reads `supplies | Products, the reorder log, days-of-supply` — three things, named eighteen months before anything existed to name them.

**The headline is how little is new.** The catalogue is fields on a `Product` #10 already created. The forecast is ADR 0003's measurement series with ADR 0007's day arithmetic pointed at it. The reorder log's most process-shaped field dissolves into an email the app already sends. One genuinely new record survives, and it borrows its states, its thread and its closing rule from the Escalation rather than inventing any.

That last point is not aesthetics. ADR 0010's own reversal clause names this ticket: _"if baths, grooming, recurring care, **the reorder log** and attendance each end up hand-rolling an append-only table with its own replay logic, the domain is saying it is event-shaped, and the result will be an event store built badly and by accident… The tripwire is the third one that gets hand-rolled."_ The reorder log was on that list. It does not become the third.

# The catalogue is `Product`, and `Product` does not stretch

Supplier, prescription flag, reorder point and ordering note are **fields on `Product`**. There is no separate catalogue entity and no second list.

This confirms rather than decides — #10's own answer handed it forward: _"It is the same entity #14 needs for reordering — the board's Medicines & Supplements panel is already a catalogue with suppliers and prescription flags."_ The ticket asked for confirmation rather than assumption, and the confirmation is that every row of that panel and every row of the days-of-supply table is already a Product under `CONTEXT.md`'s definition — something the rescue buys and gives to a horse. SmartPaks, Previcox, Cosequin, Bute, Ventipulmin, Senior, Rice Bran, hay. Fly spray and sunscreen arrive through a topical Route.

The payoff is the one the ticket named: _"we're low on Senior"_ is connectable to _"these nine horses eat Senior"_ with nothing to maintain, because it is one record.

**`Product` is not widened to cover what the rescue buys and does not feed a horse.** Shavings, gloves, muck rakes, light bulbs. Widening earns a class of Product that can never legally appear on a Feed Schedule line, which is a distinction the app then has to enforce everywhere and explain to itself forever, and it invites a wheelbarrow onto Storm's diet. Those things already have a working path, and it is the one ADR 0014 built for the leaning T-post: an Observation with no subject, escalated to `supplies`, which is legal and routed by a human who picks unaided.

The cost is stated because it is the likeliest thing to be wrong: **bedding**. Shavings are a real bulk purchase with real days-of-supply pressure and they get no catalogue row and no forecast. The whiteboard's days-of-supply table lists five feeds and no bedding, which is the evidence available, and widening later is a definition change plus a backfill rather than a migration — so this is the cheap direction to be wrong in.

**`Product` sits in ADR 0003's current-state-plus-audit tier.** Not versioned. _We used to get Previcox from Allivet_ answers no question this rescue asks, and ADR 0003 already dismissed the parallel case: _"a version history of a horse's height answers no question anyone has."_ Versioning is for care instructions, and the supplier of a thing is not part of reconstructing what a horse was eating.

**A new Product gets no `New` marker.** ADR 0013 extended the marker to the versioned tier plus Alerts and newly added catalogue Tasks, and excluded readings on the grounds that _"a new weight is a reading, not an instruction to notice."_ A Product a volunteer never encounters is invisible to them; the moment they do encounter it is a Feed Schedule line, which is versioned and marked already. Marking both would show Gabapentin as new twice for one change. A Product added and given to nobody is the Barn Manager doing paperwork, which is not a thing to put in front of sixty people.

# Supplier is a record, and prescription is a boolean

**Supplier** is a small record — name, optional URL, optional note — referenced by many Products. Five names carry fourteen products on the board, and the entire value of that panel to whoever orders is _these three are one Chewy cart_. A string cannot group reliably the first time someone types `chewy.com`.

**Prescription is a boolean** that does exactly one thing: says so on the screen. No prescriber, no date, no expiry, no refill count. ADR 0014 drew this line when it refused to let a closing Escalation create a farrier record, and the argument transfers without modification — a modelled prescription is a veterinary module arriving through a side door.

_"From the vet"_ is a Supplier like any other, despite being a channel rather than a retailer. **A Supplier never points at a Contact.** ADR 0014 put the Contacts screen deliberately outside every reference the app resolves — _"the app never resolves, dials, or escalates to it"_ — and the first pointer into it is how it quietly becomes the routing table ADR 0010 refused.

# Days of supply is a reading that decrements

A **days-of-supply reading** is a date, an actor, and a number of days against one Product. ADR 0003's **measurement series** tier: append-only, never edited, no reason field. The same shape as a weight, for the same reason, at the cost of one table and no new concept.

It is **not derived**, and the case against deriving is not close. Derivation needs three things that do not exist: a stock count in comparable units, Feed Schedule amounts as structured quantities, and a maintained receipt of every delivery. On the second — there is **no unit field anywhere** in the settled model. The line is `Product, amount, Route` plus ADR 0013's optional Condition, `amount`'s shape was never specified, and the prototype renders it as `"1/2 sc"`, `"2 wells"`, `"6 cups water"`. A sack of grain does not divide by _two wells_. #10 had already measured this: _"a schema of amounts and products captures maybe a third of that board."_

**No stock level is tracked.** A stock count nobody maintains is worse than no stock count, and there is no second number here to reconcile against.

The board's own table is the argument for hand entry rather than against it. _Outlast 20, Topline 20, Senior 14.5, Pellets 20, Rice Bran 13_ — the **14.5** is the tell. Somebody already did the division, standing in the feed room, with better inputs than the app will ever have.

**What the app adds is time.** ADR 0007 already committed the pieces: days-of-supply is _"day arithmetic, and a day has no meaning without a timezone"_, computed server-side in the org's IANA timezone, and pg-boss already carries days-of-supply checks. So a reading is not the static number the whiteboard held. _Senior 14.5_ written on 8/4 reads 9.5 on 8/9 and 0 on 8/18. The whiteboard physically cannot do that, and it is the whole win of this half of the ticket — obtained with no derivation anywhere in it.

**A reading floors at zero and then reads as stale.** _"Senior — out (last counted 8/4)"_, never a negative number. A negative number is the app asserting knowledge it does not have, which is the untruth ADR 0012 refused when it declined to invent a departure time.

**Readings are written by holders of `supplies` or by Shift Authority**, and are not scope-free. The board's practice is one person counting, and `supplies` alone was the tidier answer; it loses to the fact that decides it, which is that the person standing in the feed room looking at the sacks twice a day is the Lead, and a forecast refreshed at the rate of one person's barn visits is decoration. Shift Authority is already authority to deviate from a care instruction and be accountable for it, and already writes on others' behalf; a stock reading is a smaller act than either. **Scope-free was refused**: this is arithmetic by someone who knows what a full sack looks like, not something to ask of anyone who happens to be present, and ADR 0010 counts its scope-free writes one at a time.

Any Product may carry readings and none is required to. The rescue keeps the five it keeps today.

# The Reorder borrows the Escalation

A **Reorder** is **Open** or **Closed**, its subject is a **Product**, it is closed with a note by a holder of `supplies`, and it carries an **append-only thread on the Escalation's mechanism**.

The obvious alternative was the state machine the ticket itself proposed — needed → notified → ordered → arrived. It loses on the board's own evidence. The three rows are three different shapes: _"Storm — out of Glucosamine 8/5, Joy notified 7/29"_ (two dates, a person, and an outcome, with the notification **preceding** the stockout — a record of the process failing), _"8/4 notified low grain"_ (one date, no product detail), _"8/4 grain order next week"_ (a plan). No discipline of ordering is visible in those, and two of the four proposed states are the problem: _notified_ is written down precisely because telling is not ordering, and _arrived_ is a state nobody will ever advance. A state nobody advances is worse than no state, because the app then reports it as an outstanding order forever.

ADR 0014 has already litigated this exact trade and its reasoning is imported wholesale. It rejected an **Acknowledged** state because _"a comment does that better and more honestly"_ and _"a state whose only difference is tone does not need to be a state."_ Two states plus words is the same answer.

Two states buy the one derived fact worth having: **on order**. That is what the board is doing when it writes _"grain order next week"_ on the wall next to the forecast table, and it is the difference between a Lead reporting low grain a fourth time and trusting that it is handled.

**"[Name] notified 7/29" is not modelled, because the app already sends it.** ADR 0014 mails `supplies` holders when an Escalation lands, timestamped and coalesced per recipient. That line exists on the whiteboard because a text message leaves no trace. What made the reorder log look like a workflow was mostly this one field, and against an app that logs its own outbound mail it simply evaporates.

**No quantity and no horse reference.** The board has never written a quantity in any row, there is no pack size and no unit anywhere in the model, and a field that is always blank teaches people the form is optional. On the horse: _"Storm —"_ appears because the glucosamine is his SmartPak, and #10 already ruled on this shape when it kept horse-specific supply instances — _"only use the yellow bottle by his stall labelled with his name"_ — as free text, _"since nothing acts on them."_ Nothing acts on this either, and a horse reference makes _is glucosamine on order?_ ambiguous across eleven horses for a question with one answer. Both go in the note, where the board already puts them.

**The thread is writable by `supplies` holders only.** This is the one place the Escalation's mechanism is borrowed without its permissions, and the asymmetry is deliberate. ADR 0014 opened that thread to the floor on grounds of standing — _"the reporter adding 'it's worse this morning' is the highest-value follow-up in the system, and requiring a Domain Scope to say it would be absurd."_ Nobody reports a Reorder; it is created by the person acting on one, and it has no reporter. The volunteer who noticed still has a voice on the **linked Escalation**, whose thread is floor-writable and outlives its close by design, so _"still no Senior"_ reaches the Barn Manager without a fifth scope-free write. The accepted cost: a Reorder created cold, with no Escalation behind it, has no surface the floor can write to at all.

# An Escalation may become a Reorder, and their states stay independent

ADR 0014 left this door open by name — _"if a report should be able to become a reorder, that is this ticket's decision to make"_ — and it is taken.

A holder of `supplies` may create a Reorder **from** an Escalation. The Reorder keeps a permanent link back to it. **Creating one neither closes the Escalation nor is required to close it**, and the two states never couple.

Coupling was the tempting simplification and it makes one of the two records lie, because their lifetimes are genuinely different. The Escalation closes when the Barn Manager has said their piece — _"ordered it, thanks"_ — which under ADR 0014 mails the reporter that note in full, and that is the loop closing correctly, on the day. The Reorder closes when the feed actually arrives, which may be three weeks later. One act for both forces a choice between leaving the reporter hanging for three weeks and marking the order complete the day it was placed.

The link earns its keep read backwards as well: _this reorder exists because a volunteer noticed something_, which is the only evidence the rescue will ever have that the Observation loop does anything.

# Barn Manager

`supplies` gets a holder. ADR 0010 said adding the role would be _"one row in the constant and one grant"_ once the rescue named the position, and the rescue's name for it is **Barn Manager**.

**President and Board Member keep `supplies` in their enumeration.** The supplies contact is one person, and a rescue where the only human who can close a supplies report is on holiday is a rescue that goes back to texting. The added mail volume is real and it is not new — Board Members already receive every `horse_care` and `maintenance` Escalation through the same enumeration, and nothing about supplies makes it the one worth carving out. ADR 0010 refused a President wildcard exactly so that this row stays deliberate rather than inherited silently, and here the enumeration is doing its job.

The admin screen's standing prompt — _no non-officer holds `supplies`_ — stops firing, having done what it was built to do.

**A Product may be edited by holders of either `horse_care` or `supplies`.** The precise description of reality is a field split: name and kind are horse-care facts, supplier and prescription and reorder point are supply facts, and when the vet prescribes Gabapentin a Head adds it and the Barn Manager records where it comes from. That split is refused anyway. ADR 0010 was explicit that authorization has two axes and warned against solving an awkward case by adding a third, and field-level scoping on a single record is that third axis arriving quietly. Choosing one Scope instead blocks somebody obviously entitled — a Head who cannot mark Prascend as prescription, or a Barn Manager who cannot add the product they are ordering. Either-may-edit costs nothing real: the record is readable by everyone under ADR 0010 already, both holders are small board-adjacent roles, and every change is audited. Two people disagreeing about a Product shows up in the audit log, which beats one of them being unable to work.

This is the case ADR 0013 anticipated when it put the Task catalogue under `horse_care` and noted it _"will need revisiting the first time a genuinely maintenance-side task wants a catalogue entry."_ That revisit is not taken here — this is the Product catalogue, not the Task catalogue — but the same pressure is now visible in two places.

# Where it is read, and the one thing the app sends

**A Supplies screen**, readable by everyone. ADR 0010 put supplies inside the read floor explicitly — _"every Volunteer reads everything… horses, feed schedules, Shifts, checklists, reports, supplies."_

**A home-screen section that exists only for holders of `supplies` with open Reorders**, carrying a count. ADR 0014's pattern exactly, including the refusal of a tab.

**A panel on the Board** carrying the days-of-supply table and open Reorders, so a row reads _Senior — 6 days, on order_. The Board's stated job is the whiteboard's glance-at job, the whiteboard puts this table where someone in the feed room will see it, and the Board records nothing and credits no actor, so a read-only decrementing table costs it nothing. It is also where the Lead who writes the next reading is standing. **Closed Reorders are not shown there** — history on a glance-at surface is how the whiteboard ran out of room and started erasing weights.

**The evening digest gains a supplies section**, visible to `supplies` holders, carrying **crossings only, on the day they cross**: Products whose projected days remaining fell below their reorder point today.

This is the one message, and it stays inside ADR 0014's stated budget of four emails rather than becoming a fifth, because ADR 0011's digest already exists and already runs in the evening. That it should send _anything_ rests on what separates it from everything else the app mails: **all four existing messages are about something a human just did.** This one is about something nobody did — a number quietly reaching six while the Barn Manager is not in the barn. A wall that decrements is no better than a wall that does not if nobody walks past it.

**The reorder point is per-Product, optional, and expressed in days**, matching the reading's unit. Allivet ships in days, the vet is a visit, and hay is a delivery you book. Optional matters more than per-Product: giving a Product a reorder point is how the rescue opts it into the forecast, rather than the app forming opinions about all forty.

**Open Reorders are not in the digest.** A nightly email listing your own outstanding to-do items is a nag, and ADR 0014 refused nags by name — _"no due dates, no reminders, no escalation of the escalation"_ — because the message nobody argued for is how people learn to filter the app's mail. A crossing is news; an open Reorder is a thing you already know about, sitting on the home screen you see when you open the app.

# Go-live

**The catalogue is typed in whole.** Thirteen products on the Medicines & Supplements panel, five feeds on the days-of-supply table, five suppliers, two prescription flags. An hour, and worthless if partial — half a supplier list means somebody keeps checking the wall.

**The readings are not migrated.** Fresh counts on day one instead. The board's five numbers carry no date, and a design that decrements from a date cannot accept them without either inventing one or starting the countdown in the wrong place — the app lying in its first hour, in precisely the way the negative-number case above refuses. It is one walk through the feed room.

**Only reorder rows still in flight are migrated**, seeded as Reorders with the board's own words in the thread. The closed rows are history the whiteboard already discarded for space, and nobody will query them.

## Considered options

**A four-state reorder machine** — needed → notified → ordered → arrived — is the shape the ticket proposed and the board does not support it. Argued above.

**Deriving days of supply** from Feed Schedules and a stock count. Refused on three missing inputs, the decisive one being that `amount` is free text and _"2 wells"_ does not divide.

**Tracking stock level** alongside or instead of days of supply. A second number to maintain, reconcile and disbelieve.

**Widening `Product`** to everything the rescue buys. Refused; bedding is the named cost.

**Field-level scoping on `Product`** — `horse_care` for identity, `supplies` for supply attributes. The most accurate description of who does what, and refused as ADR 0010's forbidden third axis.

**A fifth email** on a days-of-supply crossing. Not needed; ADR 0011's digest already exists and takes a section.

**Coupling the Escalation's close to the Reorder's creation.** One act instead of two, and it makes one of the two records lie about a three-week gap.

**A horse reference on a Reorder**, following the board's _"Storm — out of Glucosamine"_. Refused on #10's ruling that horse-specific supply instances stay free text because nothing acts on them.

**A floor-writable Reorder thread**, symmetrical with the Escalation's. Refused for want of a reporter with standing; the linked Escalation's thread already serves that purpose and outlives its close.

## Amendment: a Product is Retired with a date, and never deleted

A Product goes off the shelf: the rescue stops buying Senior, the vet changes a medication, a fly spray is replaced by another. Nothing above said what happens to the row, and the only thing anybody actually asked for — _delete it_ — is the one answer the rest of this ADR forbids: three tables reference `products`, and two of them (`feed_schedule_lines`, `days_of_supply_readings`) exist precisely so that _what was she eating_ and _how fast did we go through it_ stay answerable years later.

So a Product carries **`retired_on`**, a nullable date, set and cleared through `/products/retirement` by the same two Scopes that edit one — splitting the door would mean whoever may rename Bute may not stop it. It is current state with an audit entry, ADR 0003's first tier, exactly as the rest of the Product record is. It is the third instance of an act this application already had two of: a Space retires (ADR 0002), a horse Departs, and neither is a delete either.

**The rule that is not obvious is the block.** Retirement is refused — `product_in_use` — while any **non-Departed** horse's **current** Feed Schedule version names it. Two alternatives were live. Retiring anyway and letting the schedules stand is the cheapest, and it is wrong: the checklist materializes a Feed Item off those lines every morning, so the app would go on asking a volunteer to feed a thing the barn has stopped buying, which is the class of quiet wrongness ADR 0001 wrote its own prompt against. Retiring anyway and _flagging_ the horses still naming it is defensible, and it wants a screen nobody has asked for; it stays available if the block turns out to be the annoying half. The Departed exclusion is the other half of the same judgement: Storm's last schedule still names Senior, and holding a Product open on the paperwork of a horse who is no longer here is the check being pedantic rather than useful.

**The block is two-sided**, because a one-sided one leaks the following morning: a Retired Product may be named on no new Feed Schedule version, no new Days of Supply reading and no new Reorder (`product_retired`). An **already-open Reorder is untouched** and closes normally — the sack is still on its way, and refusing to log its arrival would be the app losing a fact it was built to keep.

`horsesByProductOnCurrentSchedules` is the one place _in use_ is decided. `retireProduct` refuses against it and the catalogue read counts against it, so the sentence the desk reads before it clicks — _on 9 horses' Feed Schedules_ — and the refusal it would otherwise hit cannot disagree. That is the reason the count rides on `/products` at all: the refusal nobody hits beats the refusal that explains itself, and `Refusal` is a bare string union that carries no names.

**Retired is a state the reads disagree about, deliberately.** `/products` carries it, marked, because the catalogue is where the history stays. `/supplies` drops it, because with no reading and no Reorder possible there is nothing that screen can offer about it. Every picker hides it. A Whiteboard Read still skips it as already-held — additive-only never means duplicate — and says so in the report, because a Product that silently never appeared reads as a failed read.

**Materialization is not changed.** A Retired Product sitting on a current schedule can only be data written before this, and it still generates its Feed Item: a horse not fed is worse than a stale catalogue row. That is not the unknown-`kind` case in `ITEM_FOR_PRODUCT_KIND`, which generates nothing because the app genuinely does not know what the work _is_.

## What this changes elsewhere

**ADR 0010 gains a Role.** `Barn Manager | supplies` is one row in the role→scope constant. President and Board Member are unchanged. The `supplies` scope now has a non-officer holder, and the admin screen's standing prompt retires.

**ADR 0010's editing authority admits a two-Scope record.** A Product is writable from `horse_care` or `supplies`. This is the first record in the app with two writing Scopes and it is not a precedent to reach for.

**ADR 0011's evening digest gains a section**, recipients and cadence unchanged.

**ADR 0014's open door is used.** A `supplies` Escalation may be consumed as a Reorder's trigger. Closing an Escalation still writes words and nothing else; creation is a separate, deliberate act by a `supplies` holder.

**ADR 0007's pg-boss job acquires its subject.** The days-of-supply check computes projected days remaining from the latest reading and today's date in the org timezone, and emits crossings into the digest.

**`CONTEXT.md`** rewrites **Product**, gains a **Supplies** section holding **Supplier**, **Days of Supply** and **Reorder**, and adds Barn Manager to **Role**'s enumeration. Barn Manager gets no entry of its own, because no role has one — the enumeration is where roles live.

## Consequences

**One new entity.** The Reorder. Everything else is fields on an existing record, an existing persistence tier, an existing scheduled job and an existing email.

**ADR 0010's event-store tripwire does not fire.** The reorder log was named on its list of five and it did not become the third hand-rolled append-only table, because it reuses the Escalation's thread rather than resembling it.

**The forecast is only as good as the counting.** Nothing in the app produces a reading; a person does. The decrement makes a stale reading visibly stale rather than silently wrong, which is the most the design can honestly offer.

**Bedding has no forecast**, and neither does anything else the rescue buys and does not feed to a horse.

**Three records in this ticket sit in three different persistence tiers** — Product in current-state-plus-audit, readings in the measurement series, the Reorder as a process record with a thread. That is ADR 0003's discipline applied rather than a default taken, and the third one is the one to keep an eye on.

**Nobody chases an open Reorder.** By choice, and it is the same cost ADR 0014 accepted for open Escalations.

## What would make this wrong

**If the readings go stale.** If neither the Barn Manager nor Leads actually count, the forecast is decoration with a decrementing animation, and hand entry was the wrong call. The fix is not derivation — the inputs still will not exist — it is a Task on the closing checklist, which ADR 0013's catalogue can already express without a deploy.

**If Reorders pile up Open.** That is the nag question deferred above coming back with evidence, and the cheapest answer is an age threshold in the digest rather than a new state.

**If bedding is the thing the rescue runs out of.** Then `Product` was drawn too narrowly, and widening it is a definition change plus a backfill.

**If the two-Scope Product produces a fight.** Two people editing one record from different jobs is fine until they disagree about what a Product _is_. The audit log will show it before anyone complains.

**If the Barn Manager stops reading the digest.** The single message this ticket adds is the only thing standing between a decrementing wall and nobody walking past it. If it gets filtered, the forecast reverts to something you have to remember to go and look at, which is what the whiteboard already was.
