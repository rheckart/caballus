---
status: accepted
---

# Attendance is one per-visit record, a sign-out is never invented, and the adult who attests is never a relative

The paper sign-in sheet is four artifacts stapled together: an AM attendance block, a PM block, a bottom section for volunteers who are not on a feed shift — who write down what job they came to do, and where the Lunch shift is also currently filed — and two free-text description panels that the next shift reads. Only the first two are what #12 is nominally about.

It is also, unlike most paper this app replaces, **a live artifact with two readers**. Grace pulls the sheets and tabulates volunteer hours, producing reports for the Board and letters of time for students. The next shift reads the description panels to find out what happened. The Feed Shift Lead chases missing sign-outs, so unlike every clipboard of this shape the world has ever produced, the sign-out column is actually filled in.

This ADR settles the two attendance blocks and the bottom section. The description panels are `CONTEXT.md`'s **Shift Notes** and are governed here only where they touch authorization; notes belonging to no Shift are a separate ticket.

# Why it exists, and the one purpose that does not get to shape the design

The rescue keeps the sheet for volunteer hours, for emergency headcount, and for knowing who actually turned up. Those three do not agree at the write path.

Hours and accountability are **statements about the past**. They queue safely under ADR 0005, and a record that arrives ten minutes late is not wrong. Emergency headcount is a statement about *now*, and an Unsent sign-in is a person standing in the barn who is invisible to the count.

**Hours and accountability drive the design; headcount is a derived read.** Attendance queues. Separately there is a *who is here now* view any volunteer can open, and the ADR says out loud that it is best-effort and can under-report someone whose phone has not synced. The alternative — online-only writes on ADR 0011's Cover reasoning — would mean a volunteer arriving with no signal **cannot sign in at all**, losing the two purposes with demonstrated readers to protect one that has never been exercised. The paper sheet, it is worth noting, lives inside the barn, so in the scenario headcount exists for, the headcount is in the fire.

The rationale that is *not* available is compliance. **MOSH does not reach this organisation** — Md. Labor & Employment § 5-101 defines an employer as one who employs at least one paid person, and the rescue has none — so no evacuation-accounting duty attaches. No Maryland or federal law requires a volunteer roster, sign-in sheet, or hours log at all. What is real is evidentiary: at claim time the insurer requires the coordinator to verify that the claimant was a volunteer, on assignment, at that date and time, and reconstructing that fourteen months later from memory is the problem this solves. Detail in `docs/research/maryland-volunteer-records.md`.

# One record, not two

**A person, an arrival, a departure, an optional Shift, and an optional job description with a coarse category.** A feed-shift sign-in is the case with a Shift and no description. Mowing the fields is the case with a description and no Shift. Attendance is therefore **per-visit, with the Shift as an attribute** — which answers #12's per-shift-or-per-visit question without a special case, and matches what the paper already does.

The bottom section is the reason. A volunteer who comes to mow is at the rescue, doing its work, on no Shift, and every entity in `CONTEXT.md` hangs off a Shift. Two rejected alternatives:

- **Making each such visit a Pop-up Shift.** ADR 0011 requires `roster` or `horse_care` to create one, so a volunteer turning up to mow would need an officer to create a Shift first — and it would flood the staffing surfaces that ADR built with work nobody is being asked to cover.
- **Leaving it on paper.** It is a third of the sheet and it is where the students' non-shift hours would land.

The job is **free text plus a coarse category**. Free text because the paper is free text and the range is open-ended; a fixed list grows an "Other" within a month and then whoever tabulates is reading free text anyway. The category exists because it has two consumers: Grace's Board report, and a **school-eligible flag** set once in admin so that work Maryland excludes from service learning — fundraising, collecting donations — never silently inflates a student's total. The flag is derived from the category and **the volunteer is never asked whether their work counts for school**, because they cannot know and the question invites the wrong answer.

**Lunch stays a Shift.** The paper files it with the mowers because the sheet only has two shift columns; the whiteboard has a named weekday lunch roster, and #7 made it a Shift Type. That is a layout artifact, not a domain fact.

# It queues, and a sign-out is never invented

Attendance is an ordinary ADR 0005 write with a client-minted idempotency key. This is the third time ADR 0011's boundary has been applied — *work that happened queues; a promise about work that has not happened yet does not* — and it lands on **queues**. A sign-in is a statement about the present that is a statement about the past a second later; nobody else is relying on it the way two volunteers rely on each believing they have Thursday covered.

**A missing sign-out never auto-closes.** Not at four hours, not at midnight, not at all. An invented departure time is a fabricated completion, which this map forbids by name, and it would quietly corrupt the two numbers that leave the building — Grace's totals and a student's hours. Instead an open sign-in behaves exactly like Unsent work: visible on the Shift, warned about, and **blocking the Shift from closing**, with whoever holds Shift Authority able to close it on the volunteer's behalf. That is what the Lead already does on paper, and the app should surface the problem to them rather than replace them with arithmetic.

An open sign-in on a Visit has no Shift to block, so it surfaces to holders of `roster` in the evening digest ADR 0011 already built. No new notification channel.

# Recording for someone else is attributed, never anonymous

Anyone may record another volunteer's arrival or departure, in both directions, and **the record always carries who asserted it**. *Beth signed herself in* and *the Lead recorded Beth's arrival* are different facts and are stored as different facts.

Attribution is what makes this safe rather than a forgery surface, and it is strictly better evidence than the paper sheet, where every row is unattributed self-report. It is also what answers #12's no-phone question without a kiosk.

**The Board tablet does not become a sign-in surface.** ADR 0008 made it an org-scoped read-only device token that credits no actor, and sign-in is the one act that must credit an actor; the alternative is a shared permanent session on a tablet in a barn, which is the worst credential story available. The cost is stated rather than hidden: a clipboard by the door takes no unlock and no login, and we are replacing it with unlock-open-tap at the moment a volunteer walks in with their hands full. **If sign-in adoption is bad at go-live, this is the first decision to revisit.**

# Attendance is not the roster

There is **no swap**. Someone at the barn who does Lunch instead of the rostered volunteer, having phoned them, is expressible as ADR 0011's Drop plus Cover — and in practice neither act will be performed, because the phone call already happened.

So attendance is modelled as **a fact independent of the roster**, and the mismatch is shown without being interpreted. ADR 0011 named three facts the roster row must distinguish: rostered-and-dropped, never-rostered, and #12's no-show. **There is a fourth** — rostered, absent, no Drop, because it was sorted out between two people — and the app cannot tell it from the third.

Therefore *rostered, absent, no Drop* is a **displayed fact, annotatable by whoever holds Shift Authority, and never a label the app applies to a person.** The app does not compute no-shows, does not count them, and draws no inference from a pattern of them — the same restraint ADR 0011 chose for repeated Drops, for the same reason: that is a conversation the Coordinator has.

# The floor holds, and corrections are audited

**Attendance sits on ADR 0010's floor.** Every Volunteer reads it, including their own running total. The clipboard hangs in a barn every volunteer walks into, and hiding it in the app would be the regression that ADR refused to make.

One honest caveat, recorded as a decision rather than discovered later: **attendance is a pattern-of-life record in a way the whiteboard is not.** A year of it yields *she is at the barn alone every Tuesday at six* — inferable from a database, not from a clipboard you must stand in the barn to read, one day at a time. That is the real argument for putting it behind `roster` alongside contact details and the audit log. It does not win among sixty people who already see each other's cars in the drive, and the two carve-outs stay at two.

**Corrections are audit entries** — deliberately the opposite of ADR 0011's call for Cover and Drop. That ADR filed those as domain records because the audit log had no reader for them: the Lead needs to see who dropped, on the Shift screen, at five in the morning. Attendance edits are the reverse. They change a number that **leaves the building**, onto a Board report and a school's desk, and the reader for *who changed these hours, when, and why* is a person defending that number to an outsider. That is what ADR 0010's audit log is for, and it is the clearest illustration yet of that ADR sorting by who reads a thing rather than by category.

A volunteer may correct their own record until the Shift closes; after that it takes `roster`, **with a required reason**. This cuts against ADR 0011's argument that mandatory reason fields collect the word "personal" sixty times — the difference is that a Drop is routine and a post-close attendance edit is rare and consequential, so the friction is proportionate rather than performative.

**Hours are exact.** Durations come from the timestamps, nothing is rounded in storage, and Calvert's cap of eight service-learning hours per twenty-four is **flagged on the report, never truncated in the record**. Writing eight when someone worked ten is a small fabrication on a document backing a graduation requirement.

**Attendance is kept indefinitely.** A few thousand rows a year is the cheapest data in the system, and pruning is the only mechanism by which a student needing verification two years after graduating gets told no. The sentence that makes "indefinitely" true or false is elsewhere: **ADR 0006 keeps backups on 30-day retention**, so a deletion or corruption noticed on day 31 is gone whatever this ADR says.

# The adult who attests is never a relative

Maryland requires 75 hours of student service learning to graduate — COMAR 13A.03.02.05.D — so for a student volunteer this record is not a convenience. And MSDE's guidelines say, statewide and without qualification, that **a student's parent, guardian or relative may not supervise or verify their service learning.**

Set that beside the rescue's own policy that under-16s must be accompanied by a parent or guardian at every feed shift, and **the adult standing next to the student is frequently the one person who cannot sign for them.**

So the model separates **who was present with** a volunteer from **who supervised** them, stores the relationship, and **refuses an attestation by a parent, guardian or relative**. The supervising adult is captured **at Shift close**, alongside the sign-out that already happens there — one interaction, not two — and carries a reachable phone number, because Calvert's project description form asks for one. The attestor defaults to whoever holds Shift Authority, falling back to the Farm Manager.

The software half is the easy half. **This requires the Lead to actually supervise that student**, not merely to be rostered on the same Shift, and that is a conversation with the rescue rather than a field.

Two things deliberately not built. **No reflection workflow** — MSDE requires preparation, action and reflection, and reflection is verified by school personnel; the rescue supplies dates, hours, description and supervision, and building the school's half would be building the wrong half. **No pre-approval tracking** — Calvert's preapproval form is signed by the student, the parent and the SSL Coordinator, and carries no agency line at all, so tracking it would be the app keeping someone else's record and then owning a gate it cannot verify.

Worth telling a student in September rather than in May: MSDE holds that **volunteering alone is not service learning**. Sixty barn hours nobody structured are sixty volunteer hours and zero SSL hours. This record is necessary and it is not sufficient.

# Consent is a gate

Md. Labor & Employment § 3-203(4)(ix) exempts unpaid minor volunteers at a nonprofit from the child-labour subtitle **only if a parent or guardian consents in writing.** That is a statutory condition, not paperwork, and without it the exemption the rescue relies on does not hold.

So written parental consent is a **hard gate on rostering anyone under 18, with no override** — the same shape ADR 0011 gave Orientation, and for the same reason it gave there: an override is how a gate becomes decorative.

The same statute conditions on the service being *outside the school hours set for that minor*. The app cannot know a given student's timetable, so that is a **soft flag** on weekday-daytime shifts for under-18s, not a block.

The rescue's own under-16 accompaniment rule is **shown, not enforced**. Orientation is a gate the app can enforce because it rests on one fact the app owns; this rests on two, and the second — *is the parent actually here right now* — is only knowable if the parent has signed in, so a block would fire on a technicality at five in the morning while both of them stand in the barn. The Volunteer carries an **under-16 flag rather than a date of birth**, because the app needs the answer and not the data. The accompanying parent goes through Orientation and signs in like anyone else, which is what makes the accompaniment checkable rather than assumed.

**A student's school is not recorded.** The 75 hours is statewide, so a progress view needs nothing; only the merit-certificate threshold varies by county, and that is a once-in-a-career edge case. What storing it would buy is automating a single click Grace makes at generation time, and what it would cost is a minor's school affiliation visible to sixty adults, or a third carve-out from a floor that ADR 0010 was right to keep at two.

# Reports are generated, not templated

Grace produces two things: reports for the Board, and letters of time for students. **The app generates both from the ledger; a human signs; nothing is ever sent automatically.** The point is to make her job five minutes instead of an evening, not to remove her from it — and a school's trust is in an authorised representative asserting something, which no amount of PDF polish substitutes for.

There is no single letter, because the two feeder counties want opposite documents. **Calvert** wants one row per visit — date, hours, description of service, supervisor — with a signature on each row. **Anne Arundel** wants dates and a total with no line items and four signatures across a three-phase agreement. Prince George's, if a student ever comes from one, wants rows *and* a printed supervisor title *and* fixed deadlines. Same ledger, three renderings. **Rows compose upward into totals; totals do not decompose into rows**, so the record is per-visit and the summaries are derived.

**This is deferred but required**, and the distinction matters: the screen ships later, and the schema carries **per-date line items, the work description, and the self-versus-attested distinction from day one**, because a letter generated later from a record that only stored totals would be a fabrication.

Whether the in-app per-visit attestation satisfies Calvert's per-row signature is the highest-value open question in the ticket, and it is one phone call to the county SSL coordinator. A free win at Anne Arundel: their preparation requirement is satisfied by attending an orientation run by the community organisation, with proof of attendance — so **the rescue's Orientation record needs to be printable.**

# The insurance roster

The Volunteer gains an **enrolment date**, because CIMA's terms make coverage effective "at the time of your formal enrollment in the volunteer program," and there is a **monthly roster export** — name, phone, ID, dates worked this month, total hours this month — which is CIMA's own published form and their stated obligation to maintain a roster of all volunteers.

Every column is data this ADR already stores, so this is a report and not a model change. It is recorded here because an earlier research pass asserted that the insurer required a roster carrying initial-service and termination dates as a **condition of coverage**, and that was wrong on both counts: the roster is a service commitment to the broker plus a claims-verification mechanism, and no termination-date field exists on their form. Volunteer end dates may still be worth having for the Coordinator's own purposes. They are not insurance-mandated, and should not be justified internally as though they were.

# What this changes elsewhere

**ADR 0010 gains a third scope-free write.** That ADR permits writes with no Domain Scope in exactly two cases — recording work on a Shift you are rostered on, and recording an Observation. **Recording your own presence** is the third, on identical reasoning: requiring a scope to say *I am here* is making someone ask permission to tell the app the truth.

**ADR 0010 is amended on Shift Notes.** It holds that Shift Authority expires when a Shift closes and nobody holds it between Shifts. That stays literally true — the Lead's *curation* window closes with the Shift. Alongside it, **`horse_care` carries the right to write into a Shift's description, including after close, with post-close entries marked as such.** The President reading Thursday's notes on Friday and adding *I called the vet, he's coming Tuesday* is a real act, and a system that refuses it sends that sentence to the Facebook group instead. No new Domain Scope: role-to-scope is a constant in code, and a new scope would mean editing every mapping to grant two officers something they already hold.

**An Observation has two exits, not one.** ADR 0010 gave it escalation to a Domain Scope. It also has curation into Shift Notes, and the Lead chooses. The alternative — a separate "note" entity beside Observation — would ask the volunteer to decide at the moment of noticing whether the fence post is a thing to tell the Head of Horse Welfare or a thing to tell tomorrow's shift, which is exactly the judgement ADR 0010 says they should never have to make.

**`CONTEXT.md`'s Account entry changes.** It offers *a minor* as its example of someone who may hold no Account. Student volunteers here go through Orientation and hold Accounts like anyone else, so the example is false at this rescue. The Volunteer gains an enrolment date and, for anyone under 18, a consent record.

# What this does not do

The **waiver** is its own ticket. Two independent research passes put it ahead of attendance in consequence, and if the rescue is Markel-insured it carries a **five-year retention clock** as an underwriting representation. It should eventually gate rostering the way Orientation does — built as a sibling of that gate rather than bolted on. Note that the rescue's release is marked *Updated 2020* and predates Md. CJP § 5-401.2, which since October 2024 voids exculpatory clauses at commercial recreational facilities; whether that reaches a no-fee 501(c)(3) is the one question in this area that wants a lawyer.

**Notes belonging to no Shift** are their own ticket. There is no place on the paper for them, which makes them genuinely new. Check first whether they are the whiteboard's Reminders panel, already listed unspecified on the map; if not, the distinguishing question is lifetime — a Reminder is a standing rule, and what the rescue describes sounds transient.

**Visitors and contractors stay on paper.** The vet, the farrier, an adopter viewing a horse. Introducing a second kind of person to hold the farrier's name for four hours would be the largest thing this ticket added and the least used. Recorded as a known gap rather than discovered as one.

## Consequences

**Attendance gates itself on the rollout.** The sheet is diligently maintained because two people depend on it, so it cannot half-migrate: a partially-adopted sign-in gives Grace two sources to reconcile and gives a student a hole in the hours their diploma depends on. **Attendance goes live only when every active volunteer holds an Account**, and the paper sheet runs unchanged until that day. That is a different go-live shape from the feed board, which can run beside the whiteboard indefinitely — and it makes attendance the first feature blocked on the rollout question #1 still lists as unspecified. Like ADR 0011's Cover screen, what gets built now is the model; the surfaces come with accounts.

**Somebody at the rescue has to change how student shifts are run.** The attestor rule is not satisfiable by software alone. If a parent brings their under-16 and the two of them work together all morning, no eligible person supervised that student, and the honest record says so.

**The app now holds a legal gate it did not have.** Parental consent joins Orientation as a hard block, which means the Volunteer Coordinator gains a second reason a willing volunteer cannot be rostered, and a second queue.

**Grace stays in the loop by design.** Nothing generates a signed document unattended. This is deliberate, and it means the feature is not finished when the ledger is right.

**A stale open sign-in is possible.** Nothing closes one but a person or the Shift closing, so a volunteer who left at noon can sit signed-in until evening. Accepted for the same reason ADR 0011 accepted a stale Short: the alternative overrides a human with arithmetic, and the Shift closing bounds it at hours.

## What would make this wrong

**If the rescue starts relying on headcount.** Everything above ranks it third. A rescue that begins using *who is here now* as a real safety mechanism — during a barn fire drill, in a storm — has changed the requirement to one the queue cannot meet, and the write path would need revisiting, not the display.

**If Calvert rejects an in-app attestation.** The per-visit signature is the assumption this design rests on for the student half. If the county wants a wet signature on every row, generation stays but the workflow gains a print-and-sign step, and the attestor's convenience argument evaporates.

**If sign-in adoption is poor.** The kiosk decision is the deliberate first thing to reopen, and the honest measure is not how many people sign in but whether Grace's totals still reconcile against what she knows happened.

**If a second organisation arrives.** Everything about students here is Maryland law and two Calvert-area school systems. The rendering-per-county design absorbs new counties; it does not absorb a state with a different statute, and #1's multi-tenancy note means that day is contemplated.

**If a volunteer end date turns out to matter.** This ADR declines to model one on the strength of the insurer not asking for it. If the Coordinator finds she needs *who was a volunteer in 2027*, that is a small addition and not a contradiction — but it should be made for her reason, not attributed to a carrier.
