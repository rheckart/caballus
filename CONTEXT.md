# Caballus

Operations for a horse rescue: the daily care of horses and the coordination of the volunteers who deliver it. This file is the glossary — the words the app and the barn agree to use. It is not a spec; decisions live in the issue tracker, and implementation detail lives nowhere near here.

Terms are added only once settled with the rescue. The barn's own words win over ours.

A term here is what the **model** calls a thing, not what a **screen** calls it. A screen may say _Core Details_ where the model says Attributes, or _Change her feed_ where the model says publish a Feed Schedule version, because the reader is a volunteer and not a reader of this file. The glossary does not follow the label; the label may not contradict the glossary.

## Language

### People

**Volunteer**:
A person who works at the rescue. Created by the Volunteer Coordinator from a name and an email address, and rosterable once they hold an Orientation, a Release and — if under 18 — a Consent, before they have logged in and possibly without ever doing so. Carries the date they enrolled, because that is when the insurer's cover begins, and a date of birth, because the rescue checks photo ID and celebrates birthdays. Shifts, ticks, observations and Attendance reference the Volunteer. The record outlives their leaving, because the work they did still happened.
_Avoid_: user, member, helper, staff

**Contact Details**:
A Volunteer's name, mobile number and email address — the three facts a person is the best authority on, and the only three they may change about themselves. Everything else on the record is a statement somebody _else_ has to make: an Orientation is a Coordinator saying they oriented you, a Release records a piece of paper, a date of birth is checked against photo ID, a Role is a grant. The email is also the credential, so moving it takes a code at the new address first; the name and the mobile take effect at once. All three are audited and none carries a reason, because nobody asks why you changed your own phone number.
_Avoid_: profile, my details, personal info, account settings

**Candidate**:
A Volunteer who has not yet been oriented — someone the rescue is still deciding about. It is the Coordinator's to-do list, and it is a state and not a separate kind of person: a Candidate holds a Volunteer record, may hold an Account and Roles, and reads everything. The word stops at Orientation. A volunteer of ten years whose Release has been obsoleted is not a Candidate; they are a Volunteer with a gap.
_Avoid_: applicant, prospect, trainee, new volunteer

**Date of Birth**:
Verified against photo ID at intake for anyone who has one, and provided by the parent for a minor who does not — so the record carries **how it was established** as well as the date. The rescue requires the ID; the app never stores it, in any form. Its day and month are readable by everyone, because that is what a birthday is; the year, and the age, sit behind `roster` with contact details. Under-18 is shown as a state rather than as a number: a Lead needs to know a minor is a minor.
_Avoid_: DOB, age, birthday

**Consent**:
The written permission of a parent or guardian for a Volunteer under 18 to work here. Maryland exempts unpaid minor volunteers from child-labour law only where it exists, so it is a hard gate on rostering anyone under 18, with no override — the same shape as an Orientation and for the same reason. It becomes historical on the volunteer's eighteenth birthday and is kept, because it was true. Distinct from the Release, which every Volunteer signs and which answers a different question.
_Avoid_: permission slip, parental approval, sign-off

**Release**:
A Volunteer's signature against one Release Version, with the date it was given and who recorded it. The signed paper is the original and stays in the rescue's filing cabinet; this is the record that it exists. It is a hard gate on rostering with no override, at the same two doors as an Orientation and never at sign-in — the app will not refuse to record that someone was present. Unlike an Orientation it can go stale: a new Version may obsolete it, an eighteenth birthday obsoletes a parent's signature, and it may be revoked in writing. Never self-recorded, because it is a statement about a piece of paper only the recorder can see.
_Avoid_: waiver, liability form, hold harmless, sign-off

**Release Version**:
One issue of the release text — a valid-from date, the blank document itself, and whether publishing it obsoletes the signatures that came before. Versions are immutable and the current one is the latest, so _which text did she actually sign_ stays answerable years later. The rescue's current version is marked _Updated 2020_.
_Avoid_: template, revision, form version

**Orientation**:
The date a Volunteer was oriented, and who recorded it. It is the first of the three things that make a Volunteer rosterable, and the one the barn treats as the moment someone joins: the ID is sighted and the Release is signed at the same desk, in the same minute. Never lapses and never revoked — leaving the rescue is the act that exists for that. Not yet oriented is a real state, and its name is Candidate.
_Avoid_: onboarding, training, induction, sign-off

**Account**:
A Volunteer's means of signing in, claimed by verifying a code sent to their email address. A Volunteer may have none — someone who never onboards, or a child too young for one — and may have theirs revoked. Student volunteers are not that case: they take an Orientation and hold an Account like anyone else. Nothing in the care record ever references an Account.
_Avoid_: login, user account, profile, credentials

### Roles and permissions

**Role**:
A named position in the rescue, held by a Volunteer and carrying Domain Scopes — President, Board Member, Head of Horse Welfare, Head of Maintenance, Volunteer Coordinator, Barn Manager, Treasurer, Event Coordinator. A Volunteer holds any number, including none. Roles attach to the Volunteer and never to the Account, because a report routed to a Head must reach them whether or not they have ever signed in. Feed Shift Lead is _not_ a Role — see Shift Authority.
_Avoid_: permission, group, title, position

**Domain Scope**:
An area of the rescue's work that a Role grants authority over — `horse_care`, `maintenance`, `roster`, `supplies`, `grants`, and the dormant `financial` and `events`. Holding one means you may act in it; there is no read-only half. It is what a report is addressed to, resolved to its current holders at delivery rather than to a name and a number. Always said in full: _Scope_ alone means which horses a piece of work applies to, which is the barn's sense and keeps the word.
_Avoid_: scope (unqualified), permission, area, department

**Shift Authority**:
Final say over one Shift, held by whoever is its Lead, Co-Lead or Acting Lead — setting the start time, assigning checklist items, dropping Discretionary Work, curating Shift Notes, escalating Observations and closing the Shift. It is authority to **deviate from a care instruction and be accountable for it**, not to rewrite one: changing a Feed Schedule is horse_care work and creates a version. It is held over a particular Shift and expires when that Shift closes; nobody holds it between Shifts.
_Avoid_: lead permission, shift admin, supervisor rights

**Acting Lead**:
A rostered volunteer who has claimed Shift Authority on a Shift that has no Lead or Co-Lead. Claimed explicitly, never derived — the app suggests who (Medication Authority first, then tenure) and any rostered volunteer may take it. Carries the full authority set, stays distinct from Lead in the record, and confers no Medication Authority.
_Avoid_: deputy, stand-in, temporary lead

### Getting around

**Destination**:
A place in the app a person can be sent to, and the Domain Scopes that make it worth sending them there. Every screen is one. A Destination is offered when the person may **act** there, which is not the same question as whether they may read it — most of the rescue's records are readable by everyone. It is never a security boundary: the server refuses on its own, and hiding a Destination only answers _is there anything here for me_.
_Avoid_: link, page, route, menu item, nav item

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
Who to phone: a name, a number, the hours it is answered, and what it is for — the barn's posted numbers, the equine clinic's office and emergency lines, the property owner. Read-only, readable by everyone because five posted escalation numbers are not the same artifact as sixty volunteers' mobile numbers, and maintained under `roster`. It sits outside routing entirely: the app never resolves an Escalation to it, and the hours are there to be read by a person at 2am rather than acted on by the app. The same screen carries the rescue's **standing rules** — take turns wide, no scissors in fields — the handful of the board's Reminders that belong to no Task and so have nowhere better to be.
_Avoid_: directory, phone book, escalation list, on-call

**Announcement**:
News about the rescue, posted to everyone and belonging to no Shift: the hay comes Thursday, the water in the tack room is off until Saturday, the vet is here on Tuesday. It carries no subject — anything about one horse is a care instruction, a measurement or an Observation — and it **expires**, by a date the writer sets rather than one the app assumes, because a note that never expires is a standing rule nobody decided to make. Posted by anyone holding a Domain Scope, edited in place, and read on the home screen and on the Board. It is authored, never a Disposition: if a Lead thinks a volunteer's Observation belongs on the wall, they say so in their own words. **The app sends nothing about it** — this is a wall, not a broadcast, and what has to reach everyone today still goes to the Facebook group.
_Avoid_: notice, bulletin, post, memo, broadcast

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
A shortfall the app can compute — Unstaffed, no Lead, below Target Headcount, or nobody rostered holding Medication Authority on a Shift whose feeding includes it. A fact, shown and never announced, and distinct from Short, which is a person's judgement. **Internal only: the phrase never appears on a screen** — screens show the concrete fact, _no Lead_ or _nobody who can give medication_.
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
What a Shift is handed on with — curated by whoever holds Shift Authority, not written freely by everyone on it. Distinct from an Observation, which is a thing seen and recorded by anyone; Shift Notes are what the Lead decides the next Shift needs to know. Curating an Observation into them is one of its three Dispositions, and the one that says _this is tomorrow's problem, not a Head's_.
_Avoid_: handover, comments, log, remarks

### Checklists

**Task**:
A kind of work the rescue does — feeding, watering, mucking, grooming, checking the salt blocks. Catalogue data the rescue edits rather than a list in the app, because the whiteboard's list was already longer than the brief's. A Task fixes what the app acts on: what kind of thing it applies to, whether it is Essential or Discretionary, whether it is wanted once a Shift or once a day, whether it needs Medication Authority, what Condition it waits for, its tolerance, and what it says to do. The rescue chooses among those; it does not add to them. A standing fact about a horse that generates no work is not a Task; it is an Alert.
_Avoid_: chore, job, activity, checklist type

**Item**:
One Task applied to one subject — Feed × Apollo, Water × Field D, Sweep × the rescue. It is the thing a volunteer ticks, and the reason completion was never a single box on a Shift. Quantities, exceptions and sub-procedures are what an Item _says_, not more Items: hay in Field C is one Item whose instruction carries every receptacle's target. An Item ends Done, Dropped, Not done, or blank, and blank is always shown as blank.
_Avoid_: task (for the instance), checkbox, step, todo

**Task Assignment**:
Which Shift Type normally does a Task for a particular horse or Space — the board's `GROOM` column and the AM-takes-stalls-6-to-10 split are one thing, not two. Versioned, and three-valued: assigned, deliberately assigned to none, or **not yet decided**, which is a real state and never to be read as no work. A default and not a division — a per-day Item belongs to the day, and the other Shift may still do it.
_Avoid_: rota, item assignment, ownership

**Condition**:
A named weather predicate an Item may wait on — a predicate and a **source for its number**, which is a fixed value for the rescue-wide ones and the horse's own Threshold for the per-horse ones, so _Staying In_ is one answer for the barn and _Sheet Weather_ is twelve. Evaluated at materialization and then fixed, over a window the Condition itself declares: day-scoped ones once for the day and shared by every Shift in it, shift-scoped ones from a Shift's start until the next Shift begins, because a blanket put on at evening feed is worn all night. An alternate plan — the hay regime for a day the horses stay in — is not a mode the app switches to; it is a second set of Items gated the other way, and only one set is ever made. The plan does not change under a volunteer mid-Shift: weather that turns is a Lead deviating, recorded as such.
_Avoid_: weather rule, trigger, mode, override

**Prep**:
Work done on one Shift for a later one — the soak covered at morning feed for Dawson's lunch, feed cans filled, bedding carts loaded. It names the Shift Type it is owed to rather than the Item it feeds, because some Prep is owed to a whole Shift and some crosses midnight. The Shift it is owed to says on opening whether it happened, and a Prep still unmet when that Shift closes is recorded as a Not done rather than sent to anyone.
_Avoid_: prepare-ahead, handoff task, dependency

**New**:
The marker on a record changed recently enough that someone should notice — derived from version history rather than set by hand, and ageing out on its own, which is what the whiteboard's blue underline never did. The same for everyone, so that a Lead saying _there is a new instruction on Storm_ means something; _what changed since I was last here_ is a filter over it and not a second answer.
_Avoid_: unread, updated flag, badge

### Weather

**Threshold**:
A temperature at which a Condition turns, held as a rescue-wide default with named per-horse overrides — the board's three named horses against its _rest of horses_. Carries the **metric** it is measured in and the provider it was calibrated against, because cold is written in air temperature and heat in real feel, and the two are not the same number. Versioned, edited under `horse_care`, and three-valued per horse like a Task Assignment: overridden, deliberately the same as the default, or **not yet decided** — which is an unanswered question rather than agreement with the default, and which still gets the horse its sheet.
_Avoid_: limit, cutoff, trigger point, setting

**Reading**:
The weather as it stood when a Shift's list was fixed, kept on the Shift — the resolved Conditions, the hours the evaluation actually read, the provider and metric, the time it was fetched, and whether it was stale. Kept whole rather than as the decision it produced, because _why was this horse blanketed_ is answered by the conditions as read at the time and not by a fresh forecast tomorrow. It is what the Board shows and what each weather-driven Item cites, so a tick never looks arbitrary later.
_Avoid_: snapshot, forecast, weather data, conditions

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
A physical area a horse occupies or uses, of one kind — stall, pasture, paddock or barn — composed of one or more named units that may be physically joined. Stalls 2 and 3 are one Space because the partition between them was removed; "all of C and D" is one Space because the gate between those fields is open. A horse is assigned exactly one Space of each kind, so a horse turned out holds a Pasture and the Paddock attached to it at the same time.
_Avoid_: location, area, pen, enclosure

**Pasture**:
A Space of kind _pasture_ — a turnout area named by letter, where a horse grazes. Larger than the Paddock it connects to, and a different place: a horse may hold one of each at once.
_Avoid_: field, turnout group, grazing

**Paddock**:
A Space of kind _paddock_ — a smaller enclosure attached to a Pasture, and the unit the board's hay amounts are counted against. The two are often connected, and a horse assigned one is frequently assigned the other.
_Avoid_: field, pen, corral, dry lot

**Stall**:
A Space of kind _stall_ — an indoor space a horse is housed in. A Stall may stand empty and still exist; the feed board keeps a row for stall 7, which is OPEN.
_Avoid_: box, bay

**Small Barn**:
A second barn housing horses without numbered stalls, kept as its own section of the feed board. Covered by the same Shift as the main barn.
_Avoid_: annex, second barn

### Horses

**Departed**:
The status of a horse no longer at the rescue, carrying a departure date. The record is never deleted — shifts, feed history and weights all reference it.
_Avoid_: inactive, archived, removed, deleted

**Alert**:
A standing warning on a horse that a volunteer must read before working with it, and one of exactly three kinds: a prohibition ("no treats"), a care alert, or an allergy. Not a medical condition; those are out of scope. It stands until a person ends it and never expires on its own, because an Alert that quietly lapsed is a horse that bites and nobody was told. It is its own record rather than an Observation grown up — an Observation is frozen the moment it lands and says what somebody saw once, where an Alert says what is always true and has to be endable. Read wherever a volunteer meets the horse, not only where somebody goes looking for it. The line against a Task is whether it generates work: an Alert has nothing to tick, where "fly spray daily" is a Task carrying an instruction. Raised and ended by holders of `horse_care` alone — the floor's door for a horse that has started biting is the Observation it already has, because an Alert anybody may post is a wall nobody reads. Ending one carries a reason and never deletes it, and a horse leaving the rescue ends nothing: she is gone, not cured.
_Avoid_: flag, note, warning, caution

### Feed and medication

**Product**:
Something the rescue buys and gives to a horse — a feed, a supplement, a medication or a Topical. Its kind is a property of the Product, not of where it was written down: whether Bute is a medication is a fact about Bute. It is also the catalogue: a Supplier, whether it needs a prescription, an optional reorder point in days and a free-text ordering note hang off the same record, which is what makes _we're low on Senior_ connectable to _these nine horses eat Senior_ with no second list to maintain. Edited by holders of `horse_care` or `supplies`, and current state with an audit entry rather than versioned — what a Product used to cost or come from answers no question here. Deliberately does not stretch to what the rescue buys and never puts in or on a horse: shavings and light bulbs are an Observation, not a catalogue row. A Product the rescue has stopped using is **Retired** — a date and never a delete, the same act a Space retires by and a horse Departs by, because feed history, days-of-supply readings and Reorders all reference it. Retirement is refused while a horse still here has it on a current Feed Schedule, since a Product retired out from under nine horses is the app asking for a thing the barn cannot do; a Departed horse's schedule holds nothing back, because she is gone. Once Retired it is named on no new schedule line, no new reading and no new Reorder, and it stays on the catalogue marked, where the history is.
_Avoid_: item, feed type, med, supply, deleted, discontinued

**Feed Schedule**:
The versioned set of lines describing what a horse is given at one Shift Type. Each line names a Product, an amount and a Route.
_Avoid_: diet, ration, feed plan, meal plan

**Topical**:
A Product of kind _topical_ — something put on a horse's body rather than fed to it: fly spray, sunblock, zinc oxide. It is a Product so that Days of Supply can count it, and it is deliberately not a medication, because making it one would mean only a holder of Medication Authority could fly-spray a horse. A topical line on a Feed Schedule generates no Item; the work is a Task carrying an instruction, which is where fly spray and sunscreen already live.
_Avoid_: ointment, cream, spray, horse care product

**Route**:
How a Product reaches the horse — in feed, orally by syringe or paste, topically, or otherwise. Medication is not always given in feed.
_Avoid_: method, delivery, administration

**Medication Authority**:
Permission to prepare and administer medication — a qualification granted to a **Volunteer** under `horse_care`, not something conferred by leading a Shift. Someone may medicate on a Shift if they are rostered on it and hold the qualification; that the rescue grants it to Leads and Co-Leads is its policy for handing it out, not the definition. A Shift needs someone holding it only when that Shift's work actually includes medication — which is why Lunch, being grain and water, runs legally with one non-Lead. Preparing food carries no such requirement, despite the feed room sign saying otherwise.
_Avoid_: lead permission, med rights

### Supplies

**Supplier**:
Where a Product comes from — a name, an optional web address and an optional note, referenced by many Products. Five names carry the whole board, and the reason it is a record rather than a word on the Product is that whoever orders needs to see that three of them are one Chewy cart. The vet is a Supplier like any other, despite being a channel rather than a shop. It never points at a Contact: the app resolves nothing to that screen, by design.
_Avoid_: vendor, source, shop, merchant

**Days of Supply**:
How many days of a Product are left, as counted by a person and written down with the date they counted. A measurement series like a weight — appended, never edited, no reason — and the app's only addition is arithmetic: a reading of 14.5 on the 4th reads 9.5 on the 9th, which is the thing the whiteboard could never do. It floors at zero and then says _out, last counted the 4th_, because a negative number is the app claiming to know something it does not. Written by holders of `supplies` or by Shift Authority, since the person looking at the sacks twice a day is the Lead. Nothing derives it from Feed Schedules — the amounts there are written as _2 wells_ and _1/2 sc_, and a sack does not divide by those.
_Avoid_: stock, inventory, on hand, level

**Reorder**:
One cycle of getting more of a Product: Open until a holder of `supplies` closes it with a note, with an appended thread they write the dates into — ordered, chased, arrived. It borrows the Escalation's shape deliberately rather than growing states of its own, and _notified_ is not among them, because the Escalation's email already is the notification. Carries no quantity and names no horse; _Storm's glucosamine_ is words in the note. May be created from an Escalation and keeps a link back to it, but never shares its state — the report is answered the day it is answered, and the feed arrives three weeks later.
_Avoid_: order, purchase order, restock, requisition

**Board**:
The read-only feed board, shown on a rescue-owned tablet in the barn, doing the whiteboard's glance-at job. It records nothing and therefore credits no actor. Distinct from the shift prep queue, which is the per-horse work list a volunteer actually works from on a phone.
_Avoid_: dashboard, whiteboard screen, kiosk

**Work Surface**:
The phone screens a volunteer records work on during a Shift. Distinct from the Board, which only shows, and from the desktop admin screens, which nobody uses in a barn. The Work Surface is the only place an actor is credited.
_Avoid_: the app, mobile view, shift screen

**Unsent**:
Work a volunteer has recorded on their phone that has not yet reached the server. Visible on the item it belongs to, never silently dropped, and blocks a Shift from closing — because a record that looks complete and isn't is the lie the paper system already tells.
_Avoid_: pending, queued, unsynced, offline

### Setting up

**Whiteboard Read**:
One photograph of one panel of a rescue's whiteboard, turned into records when a barn is first set up. The person holding the phone says which panel it is; the app writes what it can read clearly, leaves what it cannot read blank, and answers with what it created, what it skipped as already held, and what it could not place. Additive only — it never edits a record that already exists, so running it twice is safe and a correction somebody made by hand is never overwritten. Distinct from the Board, which is the tablet in the barn and reads nothing.
_Avoid_: Board Read, import, migration, scan, OCR, ingest
