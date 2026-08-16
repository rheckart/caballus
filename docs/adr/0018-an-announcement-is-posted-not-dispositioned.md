---
status: accepted
amends: 0011 (the queueing boundary restated; a second carve-out from 0005), 0014 (the Contacts screen also carries the standing rules)
---

# An Announcement is posted rather than dispositioned, it expires by default, and the app queues only when it is the ledger

The ticket came from one sentence in #12: *"there has been no place to write in additional notes that don't necessarily relate to a shift, in the book or on any sheets anywhere."* Two candidates for what that meant were already on the table, and both are now closed.

**The log book is not it.** ADR 0014 declined to model it — whatever is written there is already a care event under ADR 0003's tiers or an Observation.

**The Reminders panel is not it either, and it turns out not to need a home at all.** That is the first decision below and the one that shrinks this ticket.

What is left is a third thing, and the rescue confirmed it: **news about the rescue.** The hay comes Thursday. The water in the tack room is off until Saturday. The vet is here Tuesday. Forward-looking, true for about a week, belonging to no Shift because it is not about anyone's work. It is called an **Announcement**.

# The Reminders panel dissolves

The board's Reminders box carries rules belonging to no horse and no area: *take turns wide, no scissors in fields, scrub fly masks when dirty, check for wet spots when mucking.*

Read as a list of notes it looks like this ticket's problem. Read against ADR 0013 it mostly is not one:

- *check for wet spots when mucking* is **generic instruction text on the Muck Task** — a versioned slot that ADR already built, rendered on the item.
- *scrub fly masks when dirty* is **a Task**, Discretionary, with a tolerance.
- *no scissors in fields* and *take turns wide* attach to no Task at all. They are safety rules about being on the property, and they are the genuine residue.

The panel exists on the wall because **a whiteboard cannot put a sentence next to the mucking item on ninety different cards, and the app can.** It is a display artifact of the medium, not a category of content — which is why modelling it as a panel would be copying the whiteboard's limitation into a system that does not have it.

The residue joins the **Contacts** screen as its own named section, read-only and maintained under `roster`. ADR 0014 built that screen as the app's only rescue-wide, Shift-less, standing content and said out loud that whatever this ticket built should look at it before inventing a second shape. Four sentences do not deserve a screen; they deserve a place on the one that already exists. The screen keeps the name **Contacts**, because that is what the barn calls the thing and a widened entry is more honest than a new word absorbing an old one.

**This closes #1's *barn-wide standing rules*, and the closure is softer than it reads.** The decomposition rests on four examples transcribed onto the map; the panel itself was photographed during #2 and never committed to the repo, so nobody has read it since. If it turns out to run to twenty sentences with most attaching to no Task, this decision is the one that breaks, and the fix is the panel-shaped model rejected here.

# An Announcement has no subject, and that is the definition

Rescue-wide, or it is not an Announcement.

The moment a note is about a horse, the model already has three better homes for it: a versioned care instruction, a measurement, or an Observation with a subject. A fourth way to say something about a horse would compete with all of them and win none.

The cost is real and small: *Storm goes to the clinic on Tuesday* is posted as a rescue-wide sentence that names her in prose, and it will not appear on her record. If that turns out to be the common case rather than the edge, the subject question reopens — but the first instinct, that everything should attach to everything, is how the app ends up with four half-populated inboxes on a horse's page.

# Expiry is mandatory

The ticket wrote its own argument: *a transient note with no expiry is a standing rule that nobody decided to make one.* The failure it prevents is a wall of stale text nobody reads, which the paper avoided only by having no room.

So an Announcement carries a **required expiry, defaulting to fourteen days**. At expiry it leaves every surface. It is never deleted, because nothing here is.

An optional field would have been the same as no field — nobody sets an optional expiry, and every Announcement would quietly become permanent. A fixed auto-hide would have hidden the decision in a constant instead of asking the one person who knows how long the water is off.

**It cannot be post-dated.** Post it when it is true and give it a long expiry. A start date buys the ability to schedule a wall, which is a feature for an organisation with a communications calendar, and it introduces a *written but invisible* state that is precisely the trap the online-only decision below exists to avoid.

**Expired Announcements are kept and surfaced nowhere.** ADR 0014 gave Escalations a browse screen because everyone reads everything and a report has a lifecycle somebody chases. Nobody has ever asked what the whiteboard said in March.

# Any Scope holder posts, and this is a new check shape

Writing an Announcement requires **holding any Domain Scope**; the author or any Scope holder may take one down.

ADR 0010 permits scope-free writes in four named cases, and this is not a fifth. Posting to a wall sixty people read is not *telling the app the truth about yourself*, which is the property the other four share.

**Any scope, rather than an enumerated pair.** ADR 0011's Pop-up rule names `roster` or `horse_care` and argues for both, and enumerating here gets it wrong immediately: the **Treasurer** — whose scope guards nothing in v1 — is exactly who says *the board meeting moved to the 12th*, and the Head of Horse Welfare says *the vet is here Tuesday*. Naming scopes would produce a list that has to be edited every time the rescue announces a different kind of thing.

This is a **new shape of check** — *holds any scope*, where every existing check names one — and it is recorded as such rather than left to look like an ordinary scope test that somebody later "fixes" into an enumeration.

**It is edited in place**, by the author or any Scope holder, carrying last-edited-by and last-edited-at, with no version history. ADR 0014 refused editing for an Observation because an Observation is somebody's testimony; a wall notice is edited by wiping a word and writing another, which is ADR 0003's current-state-plus-who-changed-it tier exactly. Requiring a repost when the delivery moves to Friday would leave the old one up beside the new one for whatever remained of its expiry — the stale wall arriving through the front door.

**Domain record, no audit entries.** ADR 0010 sorts by who reads a thing, and the only reader here is a person standing at the wall wondering who said the water was off — which the author and edit fields answer directly. Writing these to the audit log would fill the table `roster` consults when something has actually gone wrong with the least consequential writes in the system.

# It is read in two places, and it sends nothing

**A home-screen section that exists only when there are unexpired Announcements**, below the volunteer's own work for today. The pattern is ADR 0014's for Escalations and ADR 0011's rule about tabs: permanent furniture for something empty most of the time teaches people not to look. It is **not** on the Shift work surface, which ADR 0013 designed around ninety items on a phone held in a glove.

**And on the Board tablet**, which is the point. ADR 0004 put a read-only Board in the barn and this content is the whiteboard's missing panel — the thing that had nowhere to go on the wall. It takes no unlock and no login, a volunteer walking past reads it exactly as they read the board today, and it is the cheapest surface in this ticket. Nothing about an Announcement is sensitive: no volunteer names are required, and the Board already displays every horse's feed and medication.

**Nothing is sent, ever.** Not on posting, not on expiry, not in ADR 0011's evening digest. ADR 0014 counted the app's entire outbound surface at four emails and named that as where ADR 0009's dilution risk lands. *The hay comes Thursday* is the precise message that teaches sixty people that mail from this app can be ignored. The rescue's channel for telling everyone something today is the Facebook group, which ADR 0011 deliberately kept in service, and an Announcement is what the app has instead of pretending to be a second broadcast channel that reaches fewer people more slowly.

# There is no fourth Disposition

ADR 0014 gave an Observation three exits — Escalated, curated into Shift Notes, noted with no action — and handed this ticket the question of whether *this belongs on the wall* is a fourth.

It is not. **An Announcement is authored; a Disposition is decided.** Someone chooses to tell the rescue something, in their own words, under their own name. A Disposition is a judgement about something already seen, made by a Lead at close about somebody else's sighting — and a fourth exit would put a volunteer's words on a wall sixty people read, which is the exact problem ADR 0014 solved by making the Escalation a separate record carrying the Lead's own framing.

If a sighting deserves the wall, the Lead posts an Announcement saying so in their own voice, and the Observation still takes one of its three exits. Two acts, because they are two acts.

# The app queues when it is the ledger, and not when it is the medium

This is the largest decision in the ticket and it reaches past it.

**An Announcement is an online-only write** — the second carve-out from ADR 0005, after ADR 0011's Cover and Drop. That ADR warned that a second carve-out without an equally sharp argument is the rule dissolving, so here is the argument, and it is sharp enough to replace the original line rather than sit beside it.

ADR 0011 drew the boundary as *work that happened queues; a promise about work that has not happened yet does not*. That was correct about Cover and Drop and it does not decide this case, because an Announcement is neither work nor a promise. The line underneath it is:

> **The app queues when it is the ledger, and does not queue when it is the medium.**

A tick, an Attendance, an Observation are **true whether or not the app knows** — the work happened, the person was there, the fence post is leaning — and the queue is transport for a fact that already exists in the world. A Cover, a Drop and an Announcement are **not true until they arrive**, because the app is the thing doing the communicating. An Unsent Announcement has Cover's exact failure shape: the author looks at their own phone, sees that the rescue has been told, and the rescue has been told nothing.

The restatement re-derives every existing call unchanged. Ticks, Attendance, Observations and **Escalations** queue; Cover, Drop and Announcements do not. Note that Escalations sit on the queueing side under both formulations and for the reason ADR 0014 gave — disposition happens at Shift close in a barn on the worst signal of the day, and making connectivity a precondition for closing a Shift is intolerable. There is no equivalent constraint here: an Announcement is written by an officer who is not standing in a barn at 6am, and the cost of telling them plainly that it did not send is close to nothing.

What the restatement changes is what the **next** ticket reasons from. The old line requires each new write to be classified as work-or-promise, and things that are neither — an Announcement, a preference, a correction — fall through it. The new one asks a question that always has an answer.

## What this changes elsewhere

**ADR 0011's boundary is restated**, and ADR 0005 gains its second carve-out under the restated rule.

**ADR 0014's Contacts screen gains a section**, and the term is unchanged.

**`CONTEXT.md` gains Announcement** and widens **Contacts** by a line.

**#1 loses *barn-wide standing rules* from Not yet specified**, resolved by decomposition rather than by being built.

## Consequences

**A new authorization shape exists: holds any scope.** One check, one place, and the first thing that will happen to it is somebody replacing it with an enumeration in the belief they are tightening something.

**The Board tablet is now a communication surface.** It was a read-only display of care state; it now carries sentences a person wrote for other people to read. That is a small widening of ADR 0008's device token — still crediting no actor, still read-only — and it is the surface most likely to be read and least likely to be noticed in a review.

**Volunteers with no Account see no Announcements**, except by walking past the tablet. ADR 0010 keeps grants on the Volunteer precisely because a person may never sign in, and this is a place where that person is genuinely worse off. It is acceptable only because nothing here is load-bearing: the Facebook group still carries anything that actually has to reach everyone.

**The wall can go stale for up to fourteen days.** Expiry defaults rather than being computed, and a fortnight of *the water is off in the tack room* after it came back on is possible. That is the price of not asking the app to know when things end.

## What would make this wrong

**If the Reminders panel turns out to be long.** The decomposition rests on four examples from a panel nobody has read since #2. Twenty sentences attaching to no Task means the residue is not a section on Contacts, and the panel-shaped model rejected here was right.

**If Announcements are how work gets assigned.** *Can someone please check the far gate* is an Observation that never got made, or a Pop-up Shift that never got created, arriving as a sentence on a wall that nobody owns and nothing tracks. If the wall fills with requests rather than news, this feature has become a worse version of the Facebook group with fewer readers.

**If every Announcement gets a fourteen-day expiry.** That would mean the default is being tapped through rather than chosen, the mandatory field bought nothing, and the wall is stale on a fixed lag.

**If people ask why it did not send.** The whole design assumes the rescue understands that this is a wall and not a broadcast. If officers post something urgent and are surprised that nobody saw it, the honest fix is not a notification — it is telling them to post on Facebook, and if that conversation has to happen repeatedly then the app should not have this feature at all.

**If the restated boundary starts justifying online-only writes generally.** *The app is the medium* is a broader-sounding phrase than *a promise about the future*, and a third and fourth carve-out arriving under it would be the rule dissolving after all — just with better wording.
