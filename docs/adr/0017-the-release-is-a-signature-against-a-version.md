---
status: accepted
amends: 0012 (the under-16 flag becomes a date of birth; a third gate on the roster)
---

# The release is a signature against a version, a failing gate never empties a roster, and the Volunteer carries a date of birth

The rescue has a signed equine liability release — a purchased template marked _Updated 2020_, with a Parent/Guardian block for under-18s. Every volunteer signs one and every visitor signs one before they tour. What does not exist anywhere is a record of **who signed which version, when**, and whether it still stands.

Maryland is unusual twice over here, and both ways favour the rescue before one new statute cuts back. **There is no Maryland equine activity liability act at all** — no statutory sign to post, no prescribed language, no safe harbour, and anyone advising otherwise is quoting another state. **Maryland enforces parental pre-injury waivers** — _BJ's Wholesale Club v. Rosen_, 435 Md. 714 (2013), the minority rule nationally — so the parent signature line does real work here that it would not do in most states. Against that, **Md. CJP § 5-401.2** (effective 1 October 2024) voids exculpatory clauses at a _commercial_ recreational facility; "commercial" probably excludes a no-fee 501(c)(3), it is untested, UMD's agricultural law programme has flagged equine facilities, and the 2020 release predates it entirely. And if the carrier is **Markel**, its application carries the hardest record obligation found anywhere in this research as an underwriting representation: _is the signed release kept on file for a minimum of 5 years?_ The carrier is unconfirmed; this ADR designs as though it is, because under the decisions below that costs nothing.

Detail and citations in `docs/research/maryland-volunteer-records.md`. **The § 5-401.2 question is deferred to counsel and nothing here depends on its answer** — the design has to be right under either reading, and it is.

# The record is a signature against a version

A **Release Version** is an entity on ADR 0003's **versioned** tier: immutable, a valid-from date, the current one is the latest. A signature references one. Publishing a version carries a flag saying whether it **obsoletes prior signatures**.

That flag is the whole reason versions are entities rather than a free-text label on the signature. The one foreseeable event in this area is the rescue re-papering after § 5-401.2, and that day needs to sweep sixty people back through a signature — answerable as a query if versions are real, and a spreadsheet if they are a string. The flag is what makes it livable the rest of the time: a typo fix publishes without invalidating anyone.

This is ADR 0003's rule applied slightly outside its stated domain. That ADR said versioning is for _care instructions_ — things a volunteer executes, where _what were we doing then_ explains an outcome later. A release is not a care instruction, but it has the identical property: _what did she actually agree to_ is a question asked years later by someone defending the answer, and an audit log replayed to reconstruct it would be exactly the awkward, unreliable reconstruction the rescue rejected in #10.

**The app records the fact, not the executed artifact.** Who signed, when, which version. The signed paper stays in the cabinet as the original.

This was chosen over holding a scan and over in-app signing, on a fact about our own stack rather than a principle: **ADR 0006 keeps backups on 30-day retention.** An application presenting itself as the five-year home of a legal document, on a stack whose restore window is thirty days, would be worse than the filing cabinet _and_ look better than it — the combination this map keeps refusing. The record is shaped so a scan can attach later without a migration, and true e-signature is a separate decision with a lawyer in it.

**The version does carry the blank template**, though — one file per version, uploaded under `roster`. The asymmetry is deliberate and it is the point: the _executed_ copies are sixty pieces of paper and stay paper; the _unexecuted_ text is one document, and storing it is what makes "which text did she sign" answerable in 2031 when 2020 is three revisions back and the last copy of it is in a folder nobody opens. The consequence is worth stating plainly: **this feature puts no signature image and no personal data into object storage at all.**

# It gates the roster at two doors, and never at the third

A missing release is a **hard block on rosterability with no override**, at ADR 0011's two doors: adding someone to a Shift Pattern's Standing Roster, and adding them to a single dated Shift, self-Cover included. That ADR's argument is adopted whole — an override is how a gate becomes decorative, and _assigned with override_ becomes simply how people get onto Saturdays within a year.

It is a **sibling of the Orientation gate and not a twin**. Orientation "never lapses and is never revoked." This one versions and revokes. That difference is the source of nearly every remaining decision below.

**It does not gate sign-in.** A volunteer with no release who walks into the barn and taps sign-in is recorded like anyone else. Gating there would mean the app refusing to record that a person was present — and the person _is_ present either way, so what a block buys is not safety but a hole in the record, on the one document a carrier would actually read. An unreleased Attendance is strictly better evidence than an absent one. This is the map's _never fabricate a completion_ pointed at an omission rather than an invention.

# Consent and the release are two records, written by one interaction

`CONTEXT.md` already held them distinct, and this ADR confirms it against the temptation to collapse them, since on paper they are frequently two signature lines on one form.

They agree on nothing else. **Consent** is a _parent's_ statement satisfying Md. Labor & Employment § 3-203(4)(ix), a statutory condition on the child-labour exemption, and it is meaningless the day the volunteer turns 18. **The release** is the _participant's_ waiver of their own tort claim, it rides versions, and for a minor it is additionally signed by the parent under _BJ's_. One row cannot expire on two clocks. One screen at orientation writes both.

# Revocation is one field

A release stays effective until expressly revoked in writing. Nobody here has ever done it.

So: a nullable **revoked-at** on the signature, plus who recorded it. No status enum, no reason field, no workflow, no notification. Setting it fails the gate, and that is the entire feature.

The argument against not modelling it at all is what makes the column worth its weight: when it does happen, the alternative is somebody editing a signature row so that a true past fact disappears, which is precisely what the audit log exists to prevent. One column is cheaper than that conversation.

# Retention is the cabinet's problem, and the app never computes a shred date

The clock splits in two and only one half is ours.

**The app's own rows are kept indefinitely**, on ADR 0012's precedent for Attendance: pruning is the only mechanism by which someone who needs this two years later gets told no.

**The paper is the cabinet's**, and _which of these may be shredded_ is the question the five-year representation is really asking. The app answers it in one direction only: a `roster` view listing releases by age and by the volunteer's last Attendance, so the cabinet is legible. **It never marks anything eligible for destruction.**

That restraint is not squeamishness. The ticket asked whether the clock runs from signature or from last shift, and the framing has a third answer that breaks both: **minors' claims toll.** A release a parent signed for a fourteen-year-old defends a claim that does not begin running until she reaches majority, so a five-year clock from signature would authorise destroying the paper years before the claim it answers can be filed. _(Confidence, marked in the house style: Md. CJP § 5-201 was not read in this session — this is asserted from general knowledge and is the weakest sentence in this ADR.)_ A screen that printed "eligible for destruction" would be the app making a legal call it cannot make, and this is exactly how it would make it wrong. **The shred question joins the counsel hour** already booked for § 5-401.2.

# Recorded under `roster`, never self-recorded, and it queues

A signature is written under `roster`, by the same hand and in the same minute as the Orientation tick.

**It is never self-recorded.** Unlike Attendance — where self-report is the norm and ADR 0012's attribution is what makes it safe — this is a statement about a piece of paper that only the person holding the paper can see. A volunteer asserting their own release exists is evidence of nothing.

It is an **ordinary ADR 0005 queued write**, and not a second carve-out. ADR 0011's boundary governs: _work that happened queues; a promise about work that has not happened yet does not._ A signature is a statement about the past. The wrinkle is that it is also a gate input, so an Unsent one leaves a volunteer who genuinely signed briefly un-rosterable — a Coordinator at a desk on wifi, momentarily blocked, which is nothing like two volunteers each believing they have Thursday. ADR 0011 said a second carve-out without an equally sharp argument is the rule dissolving, and this is not that argument.

# The backfill is real dates, and a human arms the gate

The rescue holds signed releases on paper for its current volunteers. They are **backfilled in full, with the real dates read off the paper, before the gate is armed.**

This deliberately differs from ADR 0011's Orientation backfill, which dated sixty people as _preceding Caballus_ rather than fabricating dates. There the date did not matter. Here it is the retention clock and the version binding, so a sentinel would look like data and answer nothing on the one day — a re-papering — when the question gets asked. Sixty dates is an afternoon, once, and it is the only moment the cabinet and the app will ever be knowably in agreement.

**The gate is armed by one deliberate human act when the backfill is declared complete** — not by a config flag that lingers. An un-armed gate is a status that expires silently, which is the failure ADR 0006 named a tripwire to prevent.

The gap surfaces on the **people list ADR 0011 already built** as the Coordinator's to-do. Three gates now, one list, showing which one a person fails; the disabled-and-explained Cover action gains a second and third reason string. No new queue and no new surface — ADR 0012 predicted the second queue when Consent arrived, and predicting a queue is not a licence to build a third screen.

# The Volunteer carries a date of birth

**ADR 0012's under-16 flag is deleted**, not deprecated, and both thresholds derive from a date.

That ADR chose the flag on an explicit principle — _the app needs the answer and not the data_ — and the principle was sound given one consumer. There are two. **The rescue celebrates volunteers' birthdays**, so this is not data the app is hoarding to run a gate; it is a fact the barn already keeps, which the gate gets for free. And the rescue **requires photo ID showing a date of birth** from every volunteer and candidate before they start, so there is no unknown-date state to design around: the desk process produces a date for everyone. For a minor without ID, the parent provides it.

Keeping the flag alongside the date would be ADR 0003's cautionary tale repeating — the whiteboard records halter colour on the name plate _and_ in a separate panel, "and the two already disagree."

**Who sees it is where the care goes.** ADR 0010's floor is that every Volunteer reads everything, with exactly two carve-outs behind `roster`: contact details and the audit log. ADR 0012 refused a third for a student's school, naming the cost as "a minor's school affiliation visible to sixty adults." A minor's full date of birth is that objection with more teeth — but note what the celebration actually needs, which is **the day and the month**. The year is the entire sensitive part and the entire gate input.

So: **the full date sits behind `roster` with contact details; day-and-month sit on the floor; the year and the derived age do not.** This is not a third carve-out — it is the existing one gaining a field, and the floor gaining a genuinely public fact it did not have. Under-18 is shown to whoever needs it, including every Lead, **as a state rather than as an age**: a Lead needs to know a minor is a minor, not that she is fifteen.

**The date carries its provenance** — photo ID sighted, or parent-provided — with who recorded it and when. This is how the identity check the rescue already performs enters the model, and it enters as a property of the date it produced rather than as an entity or a fourth gate. It is a **precondition of the Orientation tick**: the person who sights the ID is the person who ticks orientation, at the same desk, in the same minute, which is ADR 0011's own argument for recording shadowing as orientation rather than carving an exception around it. A fourth gate would ask the Coordinator to record two facts about one moment and then chase herself for the second.

**The app never holds the identity document.** No image, no number, no issuing state, nothing beyond the coarse provenance above. Sixty driver's licence scans would be the highest-value target in the entire system and would protect nothing the sighting record does not already assert. Recorded as a decision so that nobody later discovers it as an omission.

One asymmetry, recorded rather than fixed: **the date driving both statutory gates is the least-verified one.** An adult's comes off a licence; a minor's comes from the parent whose Consent that same date makes necessary. Demanding a birth certificate from a fourteen-year-old who wants to muck stalls on a Saturday would be the app inventing a stricter policy than the rescue's, and the incentive points the harmless way — a parent shading a minor's age upward manufactures paperwork rather than escaping it.

**This ADR stores the date; it does not build a birthdays feature.** The celebration is why holding the data is acceptable, not a screen v1 ships.

# Turning eighteen obsoletes a parent's signature

The eighteenth birthday is the only gate failure in this design that arrives on schedule, and it fires two things.

**Consent becomes historical** — kept, never deleted, because it was true — and stops gating anything.

**The release obsoletes**, reusing the same flag a version bump sets rather than inventing a second staleness mechanism. The parent's waiver under _BJ's_ waived a minor's claim; the adult signs in her own name. Without this, the app would happily roster a nineteen-year-old on her mother's signature.

# A failing gate never empties a roster

Three things now cause a rostered person to stop being rosterable: an eighteenth birthday, a revocation, and a new version that obsoletes prior signatures.

In every case, **existing roster rows stand and are flagged. Nothing is auto-removed, and the gate blocks new rostering only.** Uniformly — no special case for revocation.

Auto-removal was rejected on ADR 0011's own words: gating at generation time was "rejected outright" because "an assignment that silently evaporates a fortnight later is precisely the class of quiet wrongness." A re-papering would fire that failure across every roster in the system on a single morning, which is the day the rescue is least able to absorb it. Differentiating revocation from the other two was rejected for a smaller reason that matters more over time: one mechanism with two behaviours means somebody eventually has to remember which is which, on the day it is least convenient.

The cost is stated rather than buried. **Between obsolescence and re-signature, a person can work a Shift they could not have been added to.** The mitigation is a flag on the Shift screen where the Lead is already looking, not arithmetic that removed them.

# Thirty days' notice, in the mail that already exists

A coming eighteenth birthday is announced **thirty days ahead in ADR 0011's evening digest** to holders of `roster`. No new channel, no new surface, and nothing to the volunteer or the parent — the rescue asks for a signature in person, the way it asked for the first one.

Letting the only predictable gate failure in the system fire silently and then flagging it afterwards would waste the one advantage it has.

# What this does not do

**No re-papering campaign, and no ticket for one.** If counsel says replace the 2020 text, the obsoletes flag plus the people list already answer _who must sign_, and nothing gets auto-unrostered. What is missing is only a way to chase sixty people, and ADR 0009's dilution argument governs that: mail to sixty volunteers about paperwork is exactly the message that teaches people mail from this app means nothing. The rescue's channel for _everyone please sign this_ is the Facebook group and the barn door. The Coordinator works the list. Named here so a later reader can tell deferred from forgotten.

**No in-app signing.** The parent/guardian block is the hard part — the parent of a fifteen-year-old may hold no Account at all — and it is ESIGN territory rather than a UI decision.

**No background checks.** Md. Family Law § 5-551 makes them mandatory only at listed facilities and permissive elsewhere; a general nonprofit is elsewhere. The identity check above is the rescue's own policy and is not a check of anything but the date.

**Visitors and contractors stay on paper.** This is a live process, not an oversight: **visitors sign a release before they tour the facilities**, on paper, today. The vet, the farrier, an adopter viewing a horse, a scout troop at a badge day, a family at an open house. Modelling it means a person who is not a Volunteer, and the domain that needs it is `events` — a scope ADR 0010 declared and left dormant. It lands there, with the volume it actually has, rather than here as a half-entity built to satisfy a domain with no other feature in it. Recorded as a known gap and not discovered as one.

## Consequences

**The Volunteer Coordinator has three gates and one list.** Orientation, Consent, and the release. ADR 0011 gave her a queue and ADR 0012 gave her a second reason; this gives a third, and holds the line that they share one surface.

**The app now reverses an ADR on a point that ADR argued explicitly.** ADR 0012 chose the under-16 flag over a date of birth deliberately and gave its reasoning. That reasoning was not wrong; it was made without knowing the date has a second consumer at the barn and a mandatory source at the desk. This is the shape a good amendment takes, and the frontmatter says so.

**Something on ADR 0010's floor is now personal.** Day-and-month of birth is readable by sixty people. That is a smaller disclosure than the volunteer's phone number, which sits behind `roster` — an inversion worth noticing, and defensible only because the birthday is already public at the barn in the most literal sense: they have a party.

**A gate can now be armed, and until it is, it is decoration.** The backfill is real work by a real person before the release gate means anything. Like ADR 0012's attendance, this feature is not finished when the schema is right.

**Signatures are recorded but nothing is verified.** The app knows a piece of paper was reported to exist. If the cabinet is missing a form the app says is there, the app is confidently wrong, and only the cabinet can settle it. That is the honest cost of Q2's record-only choice, and it is why the retention view lists rather than concludes.

## What would make this wrong

**If counsel says § 5-401.2 reaches a no-fee 501(c)(3).** The release itself becomes void as to the rescue's own negligence, the 2020 text has to be replaced, and everything here still works — the version obsoletes, sixty people re-sign, no roster empties. That is the scenario this design was built against, and if it arrives and the machinery does _not_ absorb it, the versioning was theatre.

**If the carrier is not Markel.** The five-year clock is Markel's application language. A different carrier and the retention half of this ticket loses its only external anchor — the record is still worth keeping, but it should be justified by the rescue's own reasons rather than attributed to a carrier who never asked. ADR 0012 made exactly this mistake in the opposite direction and corrected it.

**If someone gets ticked as released to unblock a roster.** ADR 0011's failure mode, inherited whole. The gate would have bought a field nobody trusts, and the fix at that point is a recorded override adopted deliberately rather than a habit that grew.

**If a flagged-but-rostered volunteer works a Shift and is injured.** The accepted cost of never auto-removing, arriving in the worst way. The record will honestly show that the rescue rostered her before her release lapsed and that nobody acted on the flag — which is a better record than one where the app silently removed her and somebody put her back. But if it happens, auto-removal on revocation specifically is the first thing to reconsider, and this ADR's uniformity is what gets traded away.

**If visitor releases turn out to be the larger problem.** Volunteers sign once; an open house signs a hundred people in an afternoon. If the events domain arrives and this design does not generalise to a signer who is not a Volunteer, the generalisation should have happened here.
