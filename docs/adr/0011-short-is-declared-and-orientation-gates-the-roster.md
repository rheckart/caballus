---
status: accepted
amends: 0005 (one carve-out, for commitments)
---

# Short is declared, Cover is claimed, and orientation is what makes a Volunteer rosterable

ADR 0009 took this problem's delivery mechanism away before it was designed. #11 was written to replace the Facebook group's second job — getting bodies to a short shift — and with no SMS the app cannot make that call. Email reaches phones, but not within the hour and without the urgency signal ADR 0004 spent its whole argument protecting.

So the group keeps the broadcast, in the same way ADR 0006 keeps the whiteboard in parallel, and Caballus takes the half the group has always been bad at: **knowing who actually committed**. A post that scrolls away is replaced by a roster row. Everything below is designed for an app that sends nothing to the roster.

# A Staffing Gap is computed; Short is declared

These are two different things and conflating them is the failure this ticket is most exposed to.

A **Staffing Gap** is a fact the app derives, and it is only ever displayed, never announced. Four of them, and no others:

- **Unstaffed** — nobody at all on the roster.
- **No Lead** — no `lead`, `co_lead` or `acting_lead`.
- **Below Target Headcount**.
- **No Medication Authority** — no rostered Volunteer holds it, on a Shift whose Feed Schedules include a Product given by a medication Route.

Computed across the full two-week generation horizon of ADR 0001 for holders of `roster`, because #7 requires answering *will this Shift have Medication Authority present* while a roster is being built a fortnight out. Prominent to everyone else only inside roughly the next 48 hours.

**Short is a person saying so** — recorded on the Shift with actor and time, declared by whoever holds Shift Authority, `roster`, or an officer's scopes. It is never derived and never auto-cleared. It is cleared by a human from the same set, and lapses when the Shift closes.

The reason is already in `CONTEXT.md`: Short means fewer people than the **Essential Work** requires, not fewer than Target Headcount. A Feed Shift at two of three can still feed, water, medicate and muck, and the app has no idea that Valerie is fast and the new volunteer is not. A derived Short would therefore fire on Shifts that are entirely fine, and a staffing state that cries wolf is ignored exactly the way a channel that carries everything is ignored — the ticket's own worry, pointed inward at the app instead of outward at the roster.

The symmetric rule matters as much: **arithmetic never undeclares Short either.** When a third volunteer Covers, the app says so loudly and makes clearing it one tap, and then stays out of the decision — the third person to claim might be someone who cannot carry hay, and the human who declared Short already weighed that.

`Staffing Gap` is an internal term. It never appears on a screen; screens show the concrete fact — *no Lead*, *nobody who can give medication*.

# Cover and Drop

**Cover** writes a roster row immediately — position `volunteer`, with its origin recorded as Cover rather than Standing Roster. There is no provisional state and no approval step. The Volunteer Coordinator's real interest is *noticing* who turns up outside their assignment, not gating it, and she may still remove anyone afterwards under `roster`.

Anyone may Cover who has an Account and a recorded Orientation. Nothing else gates it — in particular the app **never refuses a Cover because the person does not hold Medication Authority**. It shows what the Shift still lacks and takes the volunteer. Turning away someone who is offering to come is the worst thing this surface could do.

Covering never confers leadership. `acting_lead` remains the explicit claim of ADR 0010, and this ADR adds only that the claim may be made **any time after the Shift exists** rather than on the day — a Shift three days out with no Lead should be fixable three days out.

Sign-up stays open until the Shift **closes**, not until it starts. The call is for tonight; somebody arriving an hour in is the case this exists for.

**Drop** is a volunteer removing themselves from one dated Shift. It needs no Domain Scope, on the same principle that lets anyone record an Observation: a statement about your own availability is not authority over the roster, and an app that makes people ask permission to tell it the truth gets told less of it. ADR 0010's placement of *removal from a Shift* under `roster` governs removing **someone else**.

Three mechanics, each chosen against an obvious alternative:

- **It marks the roster row; it never deletes it.** *Beth was rostered and dropped* and *Beth was never on Thursday* are different facts, and #12's no-show is a third. Deleting the row collapses all three.
- **The reason is optional free text.** A required reason field collects the word "personal" sixty times and teaches people the app is paperwork.
- **It never touches the Shift Pattern.** ADR 0001 is emphatic that *"I've moved to Tuesdays"* is a Pattern edit and a different act; a Drop that quietly rewrote the Standing Roster would be that ADR's failure mode arriving through the back door.

A Drop notifies nobody — there is nothing to notify with — and recomputes the Staffing Gap, which is how the Lead and the Coordinator find out. **The app draws no inference from repeated Drops.** "Beth has dropped four Tuesdays" is a conversation the Coordinator has, not a flag the app raises.

# Cover and Drop do not queue

**This is a carve-out from ADR 0005, and the only one.**

That ADR makes every mutating request carry a client-minted idempotency key so the phone's retry queue is safe, and `CONTEXT.md`'s **Unsent** exists so queued work is never silently dropped. Applied here it would be actively harmful. Recording work is a **statement about the past** — it happened, and the queue is transport. A Cover is a **commitment about the future**, and an Unsent one is worse than a failed one: two volunteers each look at their own phone, each see that they have Thursday covered, and Thursday has nobody. A Drop fails the same way pointed backwards — one that never arrives leaves a roster still counting on someone who told the app they were out.

So both are **online-only writes**. If the write cannot reach the server the app says so plainly and the commitment does not exist. The failure mode of that is a mildly annoyed volunteer; the failure mode of the queue is an unfed horse.

The boundary is worth stating in one line, because it will need applying again: **work that happened queues; a promise about work that has not happened yet does not.**

# Orientation gates the roster

Orientation becomes a recorded fact on the **Volunteer** — a date and who recorded it, written under `roster`. It never lapses and is never revoked; removing someone from the rescue is the act that exists for that.

It is a **hard block on rosterability, with no override**, at both doors: adding someone to a Shift Pattern's Standing Roster, and adding them to a single dated Shift. It gates the Volunteer Coordinator exactly as it gates a self-Cover.

Gating the Coordinator was the sharpest choice in this session and it was deliberate. An override is how a gate becomes decorative: the shadowing case would use it every time, and within a year *assigned with override* is simply how newcomers get onto Saturdays. If shadowing an experienced volunteer **is** how this rescue orients people, then the correct model is that **orientation is recorded when the shadowing is arranged** — one tick, by the same person, at the same moment — rather than an exception carved into the rule.

Gating at generation time instead of assignment time was rejected outright: an assignment that silently evaporates a fortnight later is precisely the class of quiet wrongness ADR 0001 wrote its apply-to-upcoming prompt to prevent.

Orientation gates **nothing else**. Not Roles, not Medication Authority, not Shift Authority, not having an Account, and not the read-everything floor. `horse_care` granting Medication Authority to an un-oriented person is a mistake a human made, and not one the app should be in the business of catching.

Sixty existing volunteers are **backfilled wholesale at go-live**, dated as preceding Caballus rather than given a fabricated date.

**`CONTEXT.md`'s Volunteer entry changes.** It said a Volunteer is *"rosterable from that moment"* they are created; rosterability now begins at orientation. The new state between the two is not an edge case, it is the Coordinator's actual to-do list, so the people list shows it plainly and the tick is available from there.

# Who sees it, and the one thing the app sends

**Every Volunteer sees every Shift needing people.** No targeting, no opt-in, no ranking by history. The ticket asked how to choose an audience, but that question was about the cost of a blast — money, and the mute reflex. With nothing being sent, showing it to everyone costs nothing, ADR 0010 already put the floor at *every Volunteer reads everything*, and targeting logic here would exist mainly to silently exclude the person who would have said yes.

It lives as a **section on the home screen** below the volunteer's own work for today, covering roughly the next 48 hours, and is the destination a shared link resolves to. Not a tab: a tab is permanent furniture for something that is empty most of the time, and empty tabs teach people not to look.

An un-oriented Volunteer sees the same list with the Cover action **disabled and explained**, naming who to contact. A button that is not there is indistinguishable from a broken app, and someone keen enough to open Caballus looking for a shift to cover is exactly the person the rescue wants converting into an orientation booking.

The app sends **one** thing about staffing: a **daily evening digest to holders of `roster` and to officers**, covering tomorrow and the day after, Unstaffed and no-Lead first. It never mails the roster of sixty.

This is not a hole in ADR 0009's argument, it is that argument applied correctly. The dilution failure is about sixty people learning that mail from the app means nothing. A fixed handful whose actual job is the roster, receiving one predictable message at a known hour, is the opposite — and without it, ADR 0001's promise that an Unstaffed Shift *"stays visible and escalates"* has no mechanism behind it at all. Evening rather than morning because a Coordinator can still do something about tomorrow; a 6am digest arrives after the moment to act on the morning shift has passed.

# The Facebook hand-off

The Shift screen offers **Share**, using the phone's native share sheet with the text and the deep link prefilled. One tap into the Facebook app; a human taps Post.

The composed text carries: the rescue, the Shift type and date, the start time, how many more people are wanted, one plain-language line of what is missing, and the link. It carries **no horse names, no feed or medical detail, and no volunteer's name** — including who dropped and who is already on it. A Group at this rescue is not a closed room, and *"Debbie dropped, we need someone"* reads as pressure when it is a post rather than a text. The app should not be the thing that generates that sentence.

The one inclusion worth arguing about is the missing-Medication-Authority line, and it stays: it is the most useful sentence in the post, because it tells the three people who hold it that this one is theirs.

The link obeys ADR 0004 — it opens into login and continues to the Shift. No content before auth, because these links get forwarded.

**Automatic posting into a Facebook Group is not available and will not become available.** Meta deprecated the Groups API on 22 April 2024, removing `publish_to_groups` and `groups_access_member_info`; no application can publish into a Group, which is why every scheduling tool dropped the feature at the same time. The only route to automatic posting is the rescue moving its broadcast from a Group to a **Page**, which the Pages API can still publish to — and that price is not code. It means telling a rescue to move its community off a place where members reply to each other and onto one that broadcasts at them, and then getting sixty people to follow it. Recorded here as the known path, to be taken only if the Group itself stops working.

# Pop-ups

A Pop-up is a Shift with no Shift Pattern behind it and Staffing Mode = Sign-up from birth. Identical Cover flow, identical screen, nothing bespoke.

Creating one requires `roster` or `horse_care`. This is #7's restriction — Volunteer Coordinator, Head of Horse Welfare, President and Board, explicitly not a Lead — restated in the scope terms ADR 0010 requires, and it grants nobody anything new. Both scopes are needed rather than `roster` alone: making the Head of Horse Welfare phone the Coordinator to have a Shift created, so that she can then ask for volunteers on it, inserts a person into the one Shift type that is inherently urgent and buys no authorization safety, since officers hold both regardless.

# What is recorded, and where

Cover, Drop and a Short declaration are **domain records** — on the roster row and on the Shift — and none of them touch the audit log.

ADR 0010 sorts these by who reads them, and here nobody is reading the audit log: the Lead needs to see who dropped, on the Shift screen, at 5am. It also keeps the audit table derived and losable, which is the property ADR 0006's restore story depends on.

## Consequences

**The in-app surface only reaches people who already open the app.** With no push and no SMS, the volunteer who sees a Covering opportunity is mostly a volunteer working a shift that day. That is worth something — the person standing in the barn on Tuesday is a plausible Wednesday — but it means the list is a **convenience for people already here**, and the thing that actually gets bodies to a shift is still the Facebook post. Stating it plainly is the point; a design that quietly assumed otherwise would be the fabricated-completion failure the map forbids.

**ADR 0005 is no longer universal**, and its blanket phrasing — *"a rule of the data layer... every endpoint"* — needs reading alongside the boundary above. One carve-out is a decision; a second one without an equally sharp argument is the rule dissolving.

**A stale Short is possible.** Nothing clears it but a person or the Shift closing, so a Shift can sit marked Short after enough people have Covered. Accepted deliberately: the alternative overrides the human with the arithmetic they already rejected, and the Shift closing bounds the staleness at hours.

**The digest is the first non-transactional mail Caballus sends.** ADR 0009's daily cap and kill switch apply to it, for the reason given there — a bug that mails people repeatedly is its own kind of damage.

**Created-but-not-oriented is a new Volunteer state**, and `CONTEXT.md`'s Volunteer entry is amended accordingly. The Coordinator gains a queue she did not have.

**The claiming surface is not POC work.** ADR 0006 runs the POC with no volunteer accounts, so there is nobody to Cover anything. What gets built now is the model, the Staffing Gap computation that #7 and #13 read, and the vocabulary; the Cover screen is a couple of days whenever accounts arrive.

**"Cover" is provisional.** It is the sentence Facebook groups are full of, but nobody has confirmed it is the sentence *this* barn uses, and `CONTEXT.md`'s rule is that terms are added only once settled with the rescue. It is marked as such in the glossary and needs one conversation in the barn to settle or replace.

## What would make this wrong

**If volunteers get ticked as oriented in order to unblock a roster.** That is the orientation gate being routed around rather than obeyed, and the hard block will have bought nothing except a field nobody trusts. The fix at that point is the recorded override rejected above — as a deliberate reversal, not as a habit that grew.

**If Cover is never used.** If the list sits there and every additional body still arrives through a Facebook reply that somebody types into the app by hand, then the in-app surface is decoration and this ticket was always the SMS ticket. ADR 0009 names *#11 being genuinely needed* as one of the three conditions that reopen SMS, and this is what that looks like when it happens.

**If the un-oriented start Covering by proxy** — signing up through someone else's account, or a Lead adding them on arrival — the gate is in the wrong place and belongs at the door of the barn rather than the door of the roster.
