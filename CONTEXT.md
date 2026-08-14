# Caballus

Operations for a horse rescue: the daily care of horses and the coordination of the volunteers who deliver it. This file is the glossary — the words the app and the barn agree to use. It is not a spec; decisions live in the issue tracker, and implementation detail lives nowhere near here.

Terms are added only once settled with the rescue. The barn's own words win over ours.

## Language

### People

**Volunteer**:
A person who works at the rescue. Created by the Volunteer Coordinator from a name and an email address, and rosterable once they have an Orientation — before they have logged in, and possibly without ever doing so. Carries the date they enrolled, because that is when the insurer's cover begins. Shifts, ticks, observations and Attendance reference the Volunteer. The record outlives their leaving, because the work they did still happened.
_Avoid_: user, member, helper, staff

**Consent**:
The written permission of a parent or guardian for a Volunteer under 18 to work here. Maryland exempts unpaid minor volunteers from child-labour law only where it exists, so it is a hard gate on rostering anyone under 18, with no override — the same shape as an Orientation and for the same reason. Distinct from the liability release, which every Volunteer signs and which answers to a different question.
_Avoid_: permission slip, parental approval, sign-off

**Orientation**:
The date a Volunteer was oriented, and who recorded it. It is what makes a Volunteer rosterable at all: without one they can be created, hold an Account, hold Roles and read everything, but nobody may put them on a Shift and they may not Cover one. Never lapses and never revoked — leaving the rescue is the act that exists for that. Created-and-not-yet-oriented is a real state and the Coordinator's to-do list.
_Avoid_: onboarding, training, induction, sign-off

**Account**:
A Volunteer's means of signing in, claimed by verifying a code sent to their email address. A Volunteer may have none — someone who never onboards, or a child too young for one — and may have theirs revoked. Student volunteers are not that case: they take an Orientation and hold an Account like anyone else. Nothing in the care record ever references an Account.
_Avoid_: login, user account, profile, credentials

### Roles and permissions

**Role**:
A named position in the rescue, held by a Volunteer and carrying Domain Scopes — President, Board Member, Head of Horse Welfare, Head of Maintenance, Volunteer Coordinator, Treasurer, Event Coordinator. A Volunteer holds any number, including none. Roles attach to the Volunteer and never to the Account, because a report routed to a Head must reach them whether or not they have ever signed in. Feed Shift Lead is *not* a Role — see Shift Authority.
_Avoid_: permission, group, title, position

**Domain Scope**:
An area of the rescue's work that a Role grants authority over — `horse_care`, `maintenance`, `roster`, `supplies`, `grants`, and the dormant `financial` and `events`. Holding one means you may act in it; there is no read-only half. It is what a report is addressed to, resolved to its current holders at delivery rather than to a name and a number. Always said in full: *Scope* alone means which horses a piece of work applies to, which is the barn's sense and keeps the word.
_Avoid_: scope (unqualified), permission, area, department

**Shift Authority**:
Final say over one Shift, held by whoever is its Lead, Co-Lead or Acting Lead — setting the start time, assigning checklist items, dropping Discretionary Work, curating Shift Notes, escalating Observations and closing the Shift. It is authority to **deviate from a care instruction and be accountable for it**, not to rewrite one: changing a Feed Schedule is horse_care work and creates a version. It is held over a particular Shift and expires when that Shift closes; nobody holds it between Shifts.
_Avoid_: lead permission, shift admin, supervisor rights

**Acting Lead**:
A rostered volunteer who has claimed Shift Authority on a Shift that has no Lead or Co-Lead. Claimed explicitly, never derived — the app suggests who (Medication Authority first, then tenure) and any rostered volunteer may take it. Carries the full authority set, stays distinct from Lead in the record, and confers no Medication Authority.
_Avoid_: deputy, stand-in, temporary lead

### Reports

**Observation**:
Something a volunteer noticed and recorded on the Attendance they were working under — a lame horse, a leaning fence post, a bucket nearly empty, a record that no longer matches what the rescue actually does. Free text, with an optional subject taken from wherever it was recorded rather than chosen from a list: a Horse, a Space, a Product, or the record that is wrong. Recorded by anyone present and needing no Domain Scope, because a volunteer should never have to know who to tell; Shift Authority may record one on a rostered volunteer's behalf, naming them as the observer. Never edited or deleted once it reaches the server, and it goes no further until it is given a Disposition.
_Avoid_: report, issue, note, ticket

**Escalation**:
An Observation sent upward — the routed report itself, and a record of its own rather than a mark on the Observation. Carries the escalator's framing, is addressed to exactly one Domain Scope and resolved to its holders, and stays Open until a holder of that Scope closes it with a note. Made by whoever holds Shift Authority, or by a Scope holder adopting an Observation into a Scope they hold. One Observation may be escalated twice, because a report addressed to two audiences is a report neither owns. It carries an appended thread anyone may write to, which outlives the close and is how a thing that was not really fixed gets said.
_Avoid_: routing, forwarding, referral, hand-off

**Disposition**:
What became of an Observation, and a thing that is always decided rather than allowed to settle: Escalated, curated into Shift Notes, or noted with no action. A Shift will not close while one of its Observations has none — the same treatment as Unsent work — and every Disposition is shown to the whole Shift at close, which is where the loop back to the person who noticed actually closes. On a Visit there is no Lead, and the volunteer dispositions their own at sign-out.
_Avoid_: triage, outcome, resolution, verdict

**Contacts** _(provisional — the board just gives names and numbers to text)_:
Who to phone: a name, a number, the hours it is answered, and what it is for — the barn's posted numbers, the equine clinic's office and emergency lines, the property owner. Read-only, readable by everyone because five posted escalation numbers are not the same artifact as sixty volunteers' mobile numbers, and maintained under `roster`. It sits outside routing entirely: the app never resolves an Escalation to it, and the hours are there to be read by a person at 2am rather than acted on by the app.
_Avoid_: directory, phone book, escalation list, on-call

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
The Staffing Mode in which volunteers claim a place on a Shift themselves rather than being assigned to it. Used for Pop-ups and for Shifts that are short. The act of claiming is a Cover.
_Avoid_: registration, booking, volunteering

**Cover** _(provisional — confirm the barn's word)_:
A volunteer taking a place on a Shift they were not rostered on. It lands on the roster immediately, as a volunteer and never as a Lead, marked as having arrived by Cover rather than from the Standing Roster; there is no approval step. Open to anyone with an Account and an Orientation, and never refused for what the volunteer lacks — a Shift needing medication still takes someone who cannot give it, and says what it still needs.
_Avoid_: claim, sign up (the act), pick up, take

**Drop**:
A volunteer taking themselves off one dated Shift. Theirs to do, needing no Domain Scope, because saying you cannot come is not authority over the roster. It marks the roster row rather than removing it — rostered-and-dropped is not the same fact as never-rostered, nor as a no-show — carries an optional reason, and touches only that Shift and never the Shift Pattern behind it.
_Avoid_: cancel, withdraw, unassign, call off

**Target Headcount**:
The number of people a Shift is meant to have. At least three for a Feed Shift; one for Lunch.
_Avoid_: minimum staffing, required volunteers, capacity

**Short**:
Having fewer people than the Essential Work requires — not merely fewer than the Target Headcount. A Shift can be below headcount and still able to do everything that must be done. Because that is a judgement about the people rostered rather than a count, Short is **declared** by someone holding Shift Authority or `roster`, recorded with actor and time, and cleared the same way; the app neither declares it nor withdraws it when a Staffing Gap closes.
_Avoid_: understaffed, low manpower

**Staffing Gap**:
A shortfall the app can compute — Unstaffed, no Lead, below Target Headcount, or nobody rostered holding Medication Authority on a Shift whose feeding includes it. A fact, shown and never announced, and distinct from Short, which is a person's judgement. **Internal only: the phrase never appears on a screen** — screens show the concrete fact, *no Lead* or *nobody who can give medication*.
_Avoid_: shortfall, understaffing, alert

**Unstaffed**:
A Shift with nobody on it. It is never cancelled or removed, because the horses still need feeding; it stays visible and escalates — concretely, into the evening digest that holders of `roster` receive, which is the only thing the app sends about staffing.
_Avoid_: empty shift, cancelled shift

**Essential Work**:
Work that happens however short a Shift is: feeding, water, medication, turning in or out per the weather rules, hay in the fields, fly spray, sunscreen, and mucking stalls. Note that mucking stalls is required once per **day** rather than once per Shift — either Shift can satisfy it.
_Avoid_: mandatory tasks, must-dos, minimum service

**Discretionary Work**:
Work a Lead may drop when short: grooming, mucking paddocks and pasture, sweeping, baths. Droppable does not mean unimportant — each carries a tolerance for how long it may go undone, counted in whatever unit its Task's period uses, days or Shifts. A skip is any outcome that is not Done, blanks included, so that leaving an Item unanswered never scores better than dropping it honestly. At the tolerance the Item shows as overdue and the Drop action is withdrawn: it may still go undone, but only as a Not done with a reason.
_Avoid_: optional tasks, nice-to-haves, low priority

**Shift Notes**:
What a Shift is handed on with — curated by whoever holds Shift Authority, not written freely by everyone on it. Distinct from an Observation, which is a thing seen and recorded by anyone; Shift Notes are what the Lead decides the next Shift needs to know. Curating an Observation into them is one of its three Dispositions, and the one that says *this is tomorrow's problem, not a Head's*.
_Avoid_: handover, comments, log, remarks

### Checklists

**Task**:
A kind of work the rescue does — feeding, watering, mucking, grooming, checking the salt blocks. Catalogue data the rescue edits rather than a list in the app, because the whiteboard's list was already longer than the brief's. A Task fixes what the app acts on: what kind of thing it applies to, whether it is Essential or Discretionary, whether it is wanted once a Shift or once a day, whether it needs Medication Authority, what Condition it waits for, its tolerance, and what it says to do. The rescue chooses among those; it does not add to them.
_Avoid_: chore, job, activity, checklist type

**Item**:
One Task applied to one subject — Feed × Apollo, Water × Field D, Sweep × the rescue. It is the thing a volunteer ticks, and the reason completion was never a single box on a Shift. Quantities, exceptions and sub-procedures are what an Item *says*, not more Items: hay in Field C is one Item whose instruction carries every receptacle's target. An Item ends Done, Dropped, Not done, or blank, and blank is always shown as blank.
_Avoid_: task (for the instance), checkbox, step, todo

**Task Assignment**:
Which Shift Type normally does a Task for a particular horse or Space — the board's `GROOM` column and the AM-takes-stalls-6-to-10 split are one thing, not two. Versioned, and three-valued: assigned, deliberately assigned to none, or **not yet decided**, which is a real state and never to be read as no work. A default and not a division — a per-day Item belongs to the day, and the other Shift may still do it.
_Avoid_: rota, item assignment, ownership

**Condition**:
A named weather predicate an Item may wait on, evaluated once for each Shift against that Shift's own hours and then fixed. An alternate plan — the hay regime for a day the horses stay in — is not a mode the app switches to; it is a second set of Items gated the other way, and only one set is ever made. The plan does not change under a volunteer mid-Shift: weather that turns is a Lead deviating, recorded as such.
_Avoid_: weather rule, trigger, mode, override

**Prep**:
Work done on one Shift for a later one — the soak covered at morning feed for Dawson's lunch, feed cans filled, bedding carts loaded. It names the Shift Type it is owed to rather than the Item it feeds, because some Prep is owed to a whole Shift and some crosses midnight. The Shift it is owed to says on opening whether it happened, and a Prep still unmet when that Shift closes is recorded as a Not done rather than sent to anyone.
_Avoid_: prepare-ahead, handoff task, dependency

**New**:
The marker on a record changed recently enough that someone should notice — derived from version history rather than set by hand, and ageing out on its own, which is what the whiteboard's blue underline never did. The same for everyone, so that a Lead saying *there is a new instruction on Storm* means something; *what changed since I was last here* is a filter over it and not a second answer.
_Avoid_: unread, updated flag, badge

### Attendance

**Attendance** _(provisional — the barn says "sign in" and "sign out" and has no word for the record itself)_:
One record of a Volunteer being at the rescue: an arrival, a departure, the Shift it belongs to if it belongs to one, and what they came to do if it does not. It is what replaces the sign-in sheet, and it is per-visit rather than per-Shift, because the sheet's bottom section already records people who are here on no Shift at all. Queues like any other record of work. Never inferred from a tick and never closed by the app.
_Avoid_: check-in, timesheet, hours log, presence

**Visit**:
An Attendance with no Shift behind it — mowing, a repair, a welfare check by someone who came for that alone. Carries a description of the work in the volunteer's own words and a coarse category, which is the only thing about it that anyone totals.
_Avoid_: drop-in, casual shift, ad-hoc work

**Open**:
An Attendance signed in and not yet signed out. A fact, never a guess: the app will not invent a departure time, so an Open Attendance stays open, is visible on the item it belongs to, and **blocks its Shift from closing** — the same treatment as Unsent work, for the same reason. Whoever holds Shift Authority may close it on the Volunteer's behalf, which is what the Lead already does with the paper.
_Avoid_: dangling, unclosed, missing sign-out, pending

**Supervising Adult**:
Who was responsible for a Volunteer on a Shift, recorded separately from who was merely present with them. It matters for one reason: a student's service-learning hours may not be verified by their own parent, guardian or relative, and at this rescue the accompanying adult for an under-16 is usually exactly that person. Captured when the Shift closes, and carries a phone number a school can ring.
_Avoid_: chaperone, responsible adult, mentor

**Attestation** _(provisional)_:
The Supervising Adult's confirmation that a student did the hours recorded, made per visit at Shift close rather than reconstructed at the end of a term. It is what a school's verification form is asking for, and the app refuses it from anyone related to the student.
_Avoid_: sign-off, verification, approval, endorsement

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
Permission to prepare and administer medication — a qualification granted to a **Volunteer** under `horse_care`, not something conferred by leading a Shift. Someone may medicate on a Shift if they are rostered on it and hold the qualification; that the rescue grants it to Leads and Co-Leads is its policy for handing it out, not the definition. A Shift needs someone holding it only when that Shift's work actually includes medication — which is why Lunch, being grain and water, runs legally with one non-Lead. Preparing food carries no such requirement, despite the feed room sign saying otherwise.
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
