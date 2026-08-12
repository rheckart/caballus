# Caballus

Operations for a horse rescue: the daily care of horses and the coordination of the volunteers who deliver it. This file is the glossary — the words the app and the barn agree to use. It is not a spec; decisions live in the issue tracker, and implementation detail lives nowhere near here.

Terms are added only once settled with the rescue. The barn's own words win over ours.

## Language

### People

**Volunteer**:
A person who works at the rescue. Created by the Volunteer Coordinator from a name and a mobile number, and rosterable from that moment — before they have logged in, and possibly without ever doing so. Shifts, ticks and observations reference the Volunteer. The record outlives their leaving, because the work they did still happened.
_Avoid_: user, member, helper, staff

**Account**:
A Volunteer's means of signing in, claimed by verifying a code sent to their mobile number. A Volunteer may have none — a minor, or the second person on a shared number — and may have theirs revoked. Nothing in the care record ever references an Account.
_Avoid_: login, user account, profile, credentials

### Shifts

**Shift Pattern**:
A recurring commitment to work — a day of week, a time of day and a type, from which dated Shifts are generated.
_Avoid_: schedule, template, recurring shift, shift definition

**Shift**:
One dated occurrence of work at the rescue. The thing that has a roster, a start time, a checklist and a completion, and the thing volunteers mean when they say a shift was short or that Thursday's shift missed something.
_Avoid_: shift instance, occurrence, event

**Shift Type**:
What kind of work a Shift is. Currently Feed AM, Feed PM, Lunch, and Pop-up.
_Avoid_: category, kind

**Lunch**:
A midday feeding that is a Shift in its own right, feeding only the horses that have a lunch feeding scheduled — today Dawson and Apollo — and involving no grooming. Distinct from a Feed Shift by type, not by nature.
_Avoid_: midday shift, noon feed

**Scope**:
Which horses a piece of work applies to. Scope belongs to the work, not to the Shift: a Feed Shift feeds every horse but grooms only the horses assigned to it, and Lunch feeds two and grooms none. There is no single set of horses that a Shift "covers".
_Avoid_: coverage, shift horses, assigned horses

**Pop-up**:
A Shift created ad hoc for a specific need — cooling horses in heat, welfare checks in adverse weather, special feeding. A Shift like any other; what differs is that it is created on demand and staffed by sign-up.
_Avoid_: ad-hoc shift, emergency shift, extra shift

**Staffing Mode**:
How a Shift gets its people: from a Standing Roster, or by Sign-up. A property of the Shift, not a consequence of its Shift Type — a regular Feed Shift that comes up short can be opened to Sign-up.
_Avoid_: assignment mode, staffing type

**Standing Roster**:
The set of volunteers normally expected on a Shift Pattern, assigned by the Volunteer Coordinator. The norm at this rescue; Sign-up is the exception path.
_Avoid_: rota, schedule, the regulars

**Sign-up**:
Volunteers claiming a place on a Shift themselves, rather than being assigned to it. Used for Pop-ups and for Shifts that are short.
_Avoid_: registration, booking, volunteering

**Target Headcount**:
The number of people a Shift is meant to have. At least three for a Feed Shift; one for Lunch.
_Avoid_: minimum staffing, required volunteers, capacity

**Short**:
Having fewer people than the Essential Work requires — not merely fewer than the Target Headcount. A Shift can be below headcount and still able to do everything that must be done.
_Avoid_: understaffed, low manpower

**Unstaffed**:
A Shift with nobody on it. It is never cancelled or removed, because the horses still need feeding; it stays visible and escalates.
_Avoid_: empty shift, cancelled shift

**Essential Work**:
Work that happens however short a Shift is: feeding, water, medication, turning in or out per the weather rules, hay in the fields, fly spray, sunscreen, and mucking stalls. Note that mucking stalls is required once per **day** rather than once per Shift — either Shift can satisfy it.
_Avoid_: mandatory tasks, must-dos, minimum service

**Discretionary Work**:
Work a Lead may drop when short: grooming, mucking paddocks and pasture, sweeping, baths. Droppable does not mean unimportant — each carries a tolerance for how long it may go undone, counted in consecutive Shifts skipped, after which it stops being discretionary.
_Avoid_: optional tasks, nice-to-haves, low priority

### Places

**Space**:
A physical area a horse occupies or uses, of one kind — stall, field or barn — composed of one or more named units that may be physically joined. Stalls 2 and 3 are one Space because the partition between them was removed; "all of C and D" is one Space because the gate between those fields is open. A horse is assigned exactly one Space of each kind.
_Avoid_: location, area, pen, enclosure

**Field**:
A Space of kind *field* — a turnout area named by letter. Paddock and pasture mean the same thing in the barn; use Field.
_Avoid_: paddock, pasture, turnout group

**Stall**:
A Space of kind *stall* — an indoor space a horse is housed in. A Stall may stand empty and still exist; the feed board keeps a row for stall 7, which is OPEN.
_Avoid_: box, bay

**Small Barn**:
A second barn housing horses without numbered stalls, kept as its own section of the feed board. Covered by the same Shift as the main barn.
_Avoid_: annex, second barn

### Horses

**Departed**:
The status of a horse no longer at the rescue, carrying a departure date. The record is never deleted — shifts, feed history and weights all reference it.
_Avoid_: inactive, archived, removed, deleted

**Alert**:
A standing warning on a horse that a volunteer must read before working with it — a care alert, a prohibition ("no treats"), or an allergy. Not a medical condition; those are out of scope.
_Avoid_: flag, note, warning, caution

### Feed and medication

**Product**:
Something the rescue buys and gives to a horse — a feed, a supplement or a medication. Its kind is a property of the Product, not of where it was written down: whether Bute is a medication is a fact about Bute.
_Avoid_: item, feed type, med, supply

**Feed Schedule**:
The versioned set of lines describing what a horse is given at one Shift Type. Each line names a Product, an amount and a Route.
_Avoid_: diet, ration, feed plan, meal plan

**Route**:
How a Product reaches the horse — in feed, orally by syringe or paste, topically, or otherwise. Medication is not always given in feed.
_Avoid_: method, delivery, administration

**Medication Authority**:
Permission to prepare and administer medication, held by a Feed Shift Lead or Co-Lead. A Shift needs someone holding it only when that Shift's work actually includes medication — which is why Lunch, being grain and water, runs legally with one non-Lead. Preparing food carries no such requirement, despite the feed room sign saying otherwise.
_Avoid_: lead permission, med rights

### The app

**Board**:
The read-only feed board, shown on a rescue-owned tablet in the barn, doing the whiteboard's glance-at job. It records nothing and therefore credits no actor. Distinct from the shift prep queue, which is the per-horse work list a volunteer actually works from on a phone.
_Avoid_: dashboard, whiteboard screen, kiosk

**Work Surface**:
The phone screens a volunteer records work on during a Shift. Distinct from the Board, which only shows, and from the desktop admin screens, which nobody uses in a barn. The Work Surface is the only place an actor is credited.
_Avoid_: the app, mobile view, shift screen

**Unsent**:
Work a volunteer has recorded on their phone that has not yet reached the server. Visible on the item it belongs to, never silently dropped, and blocks a Shift from closing — because a record that looks complete and isn't is the lie the paper system already tells.
_Avoid_: pending, queued, unsynced, offline
