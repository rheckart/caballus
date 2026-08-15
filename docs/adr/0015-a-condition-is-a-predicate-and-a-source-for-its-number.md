---
status: accepted
amends: 0013 (the Condition snapshot is a set, the window belongs to the Condition, and manual resolution is an exception to materialize-once); 0003 (a rescue-level default threshold joins the versioned tier); 0011 (the evening digest carries tomorrow's heat Condition)
---

# A Condition is a predicate and a source for its number

The Sheets and Blankets panel is not "a threshold per horse", and reading it as one is how this ticket would have gone wrong. It is a default with three named overrides, two tiers of garment at two different temperatures, a hedge that is judgement rather than a number, an escalation that requires somebody's say-so, and a heat rule keyed to the *shape* of the forecast rather than to a value. Every decision below is what falls out of taking that panel literally.

ADR 0013 was formally blocked on this ticket and defined the interface instead of waiting, in one sentence: a Condition is *a named predicate, evaluated per Shift against that Shift's own hours at materialization, and snapshotted onto the Shift*. That sentence survives in its intent and is wrong in two of its particulars, both corrected here.

# The predicate resolves per subject when its number comes from the subject

ADR 0013's sentence reads as one boolean per Shift. The board's sheet rule cannot be one boolean: at 38 °F, Dawson and Apollo get sheets, the rest of the horses get sheets, and Storm gets nothing. One predicate, one hour, three answers, because the number comes from the horse.

So a Condition is a named predicate **plus a source for its number**. Rescue-wide Conditions take a fixed value; per-horse ones take the subject's own threshold. The snapshot on the Shift is a **set of (Condition, subject) booleans** rather than a scalar.

The alternative — leaving Conditions rescue-wide and giving sheets and blankets their own separate gating mechanism — was rejected because it puts the single largest weather rule on the board outside the concept invented to express it, which is the outcome ADR 0013's contract existed to prevent. Both kinds genuinely occur and the model needs both: *Staying In* is one answer for the whole barn, *Sheet Weather* is twelve answers.

# The vocabulary is closed

A Condition's **kind** is code; its numbers are data. Three kinds cover every rule on the whiteboard:

- **threshold crossing** over a window — sheets, blankets, fans
- **time of crossing** — *85 °F Real Feel starts at noon or before*
- **precipitation presence** over a window — the fly sheet rule, and Cold and Wet

The rescue edits numbers, metrics and which horses. It cannot author a fourth kind; that is a deploy. This is the same fence ADR 0013 put around the Task catalogue and for the same reason: a rule builder in a barn app is a feature nobody will use correctly and everybody can break. Three kinds were enough for a whiteboard the rescue has been refining for years, which is decent evidence the fence sits in the right place.

# Cold is air temperature and heat is apparent temperature

The board writes heat as Real Feel explicitly — *85° Real Feel* — and cold as bare degrees — *Sheets under 50°*. Per the #6 research these are not interchangeable. Open-Meteo's apparent temperature subtracts a wind term at **all** temperatures, running 8.5–11.7 °F below air temperature on cold mornings. Read *under 50* as apparent and the sheet rule starts firing on a breezy 58 °F afternoon, which silently re-calibrates a number the rescue set against something else.

So cold thresholds are **air temperature**, heat thresholds are **apparent temperature**, and every threshold stores its **metric and provider** beside the number. #6's warning is the reason: measured divergence between Open-Meteo and NWS apparent temperature at the same coordinates was mean +1.8 °F with a range of −11.5 to +9.6 °F, so a threshold is calibrated to one provider's scale and is **not portable**. A provider swap without the stamp re-calibrates every horse in the barn and nobody notices.

The metric enum carries `air_temp`, `apparent_temp`, `temp_plus_humidity_sum` and `wbgt` from the first migration, though only the first two are used. That is not speculative generality; it is the cheapest possible accommodation of a real disagreement described below.

## What the equine literature says, and why the board's numbers stand anyway

#6 found that the equine world does not use "feels like" at all, and that its two authorities contradict each other. US Equestrian, crediting AAEP, publishes a scale of air temperature in °F **plus relative humidity in %** — under 130 normal, 130–150 begin monitoring, 150–180 critical, over 180 potentially fatal under stress — and explicitly warns it is not the NWS heat index. The FEI's 2018 guidance says that scale "should never be used… as it has previously been demonstrated to be extremely unreliable" and holds that **the only validated heat index for equestrian sport is WBGT**. THI, which appears in equine papers, is an unmodified cattle index; the 2023 Kang review concludes there is "a lack of any standardized method or validated interpretation of heat stress in horses". For cold there is no index at all, only lower critical temperature, whose published values span thirty degrees — from −15 °C for a cold-adapted Quarter Horse to about **+5 °C** for a horse stabled at night and not winter-acclimatised.

Both authorities are describing *exercising* horses at competition. A rescue paddock is not that, and neither offers a translation for the number this barn actually uses. So the board's numbers stand as written.

Two things in that literature are worth keeping anyway, because they explain the model rather than contradict it. First, this rescue's thresholds — sheets under 50, blankets under 30 — sit far above every published LCT, and that is not the barn being wrong: LCT describes a healthy acclimated horse, and a rescue blankets the thin, the senior, the unacclimated and the wet. The literature is the explanation for **why thresholds are per-horse in the first place**. Second, the evidence is consistent that wind and wet matter more than air temperature, that there is no equine wind-chill formula, and that the widely repeated *"20 mph lowers effective temperature 15–20 °F for a horse"* traces to magazine content rather than research. Which means the board's throwaway hedge, *especially if windy/Rainy*, is the best-evidenced sentence on the panel — and it stays as advice, for reasons given below.

## The 85 has no provenance

The rescue's Real Feel number was not read off one app. It varies with whoever is looking and what they have installed, which means two volunteers can stand in the same paddock today and disagree about whether the rule fired. Precision about *which* scale would be false precision.

It also means the app becomes the arbiter, which is an improvement on the current state rather than a risk introduced. But Open-Meteo's formula includes a **solar radiation term**, so on a clear afternoon it runs hotter than a heat-index-style "feels like" — and since the rule is *only if 85 starts at noon or before*, a hotter curve crosses earlier and keeps horses in on days the barn would have turned them out. The metric choice moves the answer to a yes/no question about turnout, which is why a calibration comparison is owed before the first summer.

# The window belongs to the Condition, not the Shift

ADR 0013 said per Shift against *that Shift's own hours*. Both halves need correcting.

**Some Conditions are day-shaped.** *Staying In* changes the hay plan, Storm's alfalfa, turnout and fans; if AM and PM evaluated it separately, PM could feed an alternate hay regime to horses that went out this morning. Day-scoped Conditions are evaluated **once when the day materializes** and every Shift that day snapshots the same value. The daily job already runs for all of the day's Shifts, so this costs nothing.

**And *that Shift's own hours* is the wrong window for the rest.** A blanket put on at PM feed is worn all night; the hours the volunteers are present are not the hours the horse is wearing it. Shift-scoped Conditions read **from this Shift's start until the next Shift begins** — the period the horse spends dressed as this Shift left it.

So the window is a property of the **Condition kind**. ADR 0013's underlying point survives intact: a day that starts at 30 ° and reaches 85 ° is one day and two entirely different Shifts, and nothing here evaluates a shift-scoped Condition once for the day.

# A default with named overrides, and a third state that is neither

The board names three horses and puts everyone else under *Rest of Horses*. That default is a **real record** in ADR 0003's versioned tier, not the absence of one, with per-horse override rows existing only for the horses that have them. Copying the default onto twelve horses would give eight rows of identical numbers that drift apart the first time somebody edits one — which is precisely the duplication failure ADR 0003 already caught the whiteboard committing with halter colour.

The override is **three-valued**, exactly as ADR 0013 kept for Task Assignment: overridden, deliberately the same as the default, or **not yet decided**. The third state is load-bearing for the reason ADR 0010 gave about Mystery and Nora's blank `GROOM` cells — a new intake with no thresholds set is an unanswered question, not a horse that follows the default, and rendering one as the other converts a gap into a rule nobody made.

At materialization a horse with undecided thresholds **gets its item using the rescue default**, with the card stating that its thresholds are not set, and the horse appearing on a `horse_care` list of decisions owed. The app does the safe thing, says visibly that it did, and a person resolves it — the same treatment ADR 0013 gave the horse that departs at noon. The horse gets its sheet either way, which is what matters at 38 °.

Thresholds are edited under `horse_care`, versioned per ADR 0003, and carry the derived **New** marker per ADR 0013. **A change to the default marks New on every horse that follows it.** That is noisy — one edit can light up nine of twelve horses — and it is correct: it is exactly the change everyone needs to notice, and ADR 0013 made New global so that a Lead saying *there is a new instruction* can rely on others seeing it. Marking only the default record and trusting people to read it is what the whiteboard did, and its blue `NEW` underline went stale until somebody rubbed it out.

# The set, in full

Per-horse, shift-scoped:

| Condition | Predicate |
|---|---|
| **Blanket Weather** | air temperature below the horse's blanket threshold |
| **Sheet Weather** | below the sheet threshold **and at or above the blanket threshold** |

Rescue-wide:

| Condition | Predicate | Scope |
|---|---|---|
| **Staying In** | apparent temperature reaches 85 °F at or before noon | day |
| **Fly Sheet Weather** | no precipitation **and** apparent temperature not over 90 °F | shift |
| **Cold and Wet** | below a temperature the rescue sets, with precipitation | shift |

Sheet and Blanket are made **mutually exclusive by construction** rather than by convention, so a cold night generates exactly one garment item per horse instead of two items for one horse and a volunteer deciding which the barn meant.

Fly Sheet Weather is rescue-wide rather than per-horse. Only Badger and Storm have fly sheets, but that is a **Task Assignment** — which horses have the Task — and not a threshold difference. The numbers are the same for both.

Three things are deliberately **absent**. There is **no fans threshold**: the brief calls for fans in heat, but 85-at-noon is the only heat number the barn has ever written down, and inventing a second one puts a number in their mouth — so fans ride on Staying In. There is **no Freezing Condition**, because the water heaters turn out to be thermostatic. And there is **no wind or rain modifier** on sheets and blankets.

# The hedge stays advice, and River's does not

*Especially if windy/Rainy* and *on cold rainy days* are the same hedge, and they do different jobs.

On the Sheets and Blankets panel the hedge **softens a threshold that already exists**: the sheet item is generated anyway at 38 °, and the sentence tells a volunteer to lean toward yes. Turning it into a predicate would require inventing a wind speed and a rainfall amount the rescue has never stated, which is putting words in the barn's mouth about a judgement the volunteer is already making well. It stays **instruction text on the item**.

On River's cell it is the **entire trigger** — *On cold rainy days, if congested, give 5 mL Ventipulmin. Text Lori — note in log book.* With no predicate, that guidance either appears every single day, where it becomes wallpaper, or never. So **Cold and Wet** is a real Condition with numbers the rescue supplies once and owns.

This is the split ADR 0013 anticipated when it said the engine must surface *arbitrary* per-horse guidance rather than select from a fixed action set. It does, and it needs nothing new: the guidance is instruction text on a Task Assignment, gated on a Condition. The app still cannot judge whether River is congested. It guarantees the question is asked on the right morning, which was always the value.

# Two things read yesterday rather than the forecast

Nothing on the board says when a sheet comes **off**, but somebody does it every morning. And the fly sheet rule is *ON AM, OFF PM* — the removal is conditional on the fitting having happened, which is an item-to-item dependency ADR 0013 refused outright.

Both are solved by reading **the previous Shift's snapshot** instead of the forecast. The booleans are already frozen there and already readable; no edge between items appears.

**Unrug fires only on the break** — the previous Shift's rug condition held and this Shift's does not. Firing whenever the previous condition held would generate twelve *take it off* items every morning and twelve *put it on* items every evening straight through a January cold spell during which the sheets never actually come off.

**Fly Sheet Off is gated on AM's snapshotted Condition**, not on AM's item outcome. The failure mode is a PM volunteer finding a horse with no fly sheet and recording **Not done — "wasn't on"**, which is a true record of a real miss and strictly better than the item silently not existing.

# Authority is not modelled, and the phone call is an Observation

*If horse is soaked or shivering, please dry off best as possible with towels and put sheet on if instructed to do so by Barn Manager / Horse Healthcare Lead.*

No weather predicate can fire this: soaked and shivering are observations about a horse, not readings. The towel-off is **generic instruction text on the Sheet and Blanket Tasks**, so it is read on exactly the cold days it applies to.

The *if instructed* half is **not modelled as a permission**. ADR 0010 settled on two authorization axes and warned against smuggling in a third; this would be the only approval mechanism in the entire system, built for one sentence. The volunteer phones whoever the Contacts entry names and records what they were told as an **Observation** with the horse as its subject.

**Barn Manager** and **Horse Healthcare Lead** are the barn's everyday words for people holding `horse_care`, and no new Role joins ADR 0010. Instruction text names the **Domain Scope's current holders** rather than a person — the same resolve-at-delivery move Escalation already makes, and for the same reason: the sentence should still be right when the person changes.

# When the forecast does not arrive

Materialization is a job that must run, and it now depends on an external HTTP call at 4am. If Open-Meteo does not answer, every weather-gated item on every Shift that day is unresolved, including which of the two hay sets exists. Defaulting to false would mean a 90 ° day on which the horses go out and get the normal hay.

Three steps, in order:

1. **Reuse the most recent successful forecast for that day**, marked stale.
2. Failing that, materialize everything ungated, generate **neither** gated set, and show an unresolved-weather panel.
3. Whoever holds **Shift Authority resolves each open Condition by hand**, recorded as a manual evaluation with an actor and a time. The gated items materialize on that act.

**This is the one sanctioned exception to ADR 0013's materialize-once-and-never-regenerate**, and it is named here rather than left to be discovered. Items appearing under a volunteer mid-shift is the hostile interface ADR 0013 rejected; the difference is that this is a person deliberately answering a question the app could not, at the start of the Shift, rather than the app rewriting a list under someone's hands.

**No NWS fallback in v1.** It is a second parser — raw gridpoints, run-length-encoded `validTime`, no daily aggregates, Celsius only — a second scale, and a second set of thresholds to calibrate. The metric-and-provider stamp keeps the door open, and #6 leaves NWS documented as the one free source of forecast WBGT if a heat rule ever wants the metric FEI calls validated.

# What is stored, and what is shown

Per Shift: the **resolved booleans** per subject, the **raw hourly series** the evaluation read for its window, the **provider and metric**, the **fetch time**, and a **stale flag** if the fallback path was used. #6's implementation note is unambiguous — persist the raw fields, not just the derived recommendation — because *why was this horse blanketed* needs the conditions as read at the time, and a re-fetch tomorrow answers a different question.

Shown in three places, and the labelling matters more than usual because the rescue has no single authoritative source today:

- the **Board** carries the day's reading and the resolved Conditions, with the provider named
- each **item card** states the reading and the threshold that produced it — *Sheet — Dawson: 38 °F, sheets under 50°* — so the item explains itself instead of looking arbitrary
- the **Shift** shows its snapshot time, so a Lead can see the plan was fixed at 4am and that the afternoon has since diverged

A volunteer whose phone says 89 while the Board says 96 will distrust the Board. The label is the mitigation and it is only a partial one.

# Heat does not create a Pop-up, and heaters are thermostatic

Both the brief and #6 say heat triggers summer midday pop-ups — hosing horses down, welfare checks — and the app will know tomorrow's curve at 4am. It still **neither creates nor announces one**. ADR 0011 settled that the only thing the app sends about staffing is the evening digest, and ADR 0013 refused a second notification path.

Instead the resolved heat Condition **rides in that existing digest** to `roster` holders, alongside tomorrow's staffing. No new channel, no new entity, and the person who would create the Pop-up learns the fact the evening before, while they can still staff it. Creating it stays a human act, and ADR 0013 already has Pop-ups authoring their own lists.

The water heaters turn on by themselves below a set temperature, so there is **no switching action anywhere in the app** and no Freezing Condition. What remains is a check, and it needs no item of its own: the board's water procedure already tells volunteers to fill small troughs high enough to cover the heat element, so they are looking at the thing regardless. It is cold-months text on the **Water** Task. A heater that is not working is an **Observation** with the Space as its subject, routed to **`maintenance`** — the first weather-adjacent thing in this ticket that leaves horse care.

## What this changes elsewhere

**ADR 0013's Condition contract widens in three places.** The snapshot is a set of (Condition, subject) booleans rather than a scalar. The window is a property of the Condition kind — day-scoped or shift-scoped — and the shift-scoped window runs to the **next Shift**, not to the end of this Shift's hours. And manual resolution after a forecast failure is a named exception to materialize-once.

**ADR 0003 gains the rescue-level default threshold record** in the versioned tier, beside the per-horse thresholds already named there.

**ADR 0011's evening digest gains a payload** — tomorrow's resolved heat Condition — without gaining a channel.

**`CONTEXT.md`'s Condition entry is rewritten**, since its current wording says *against that Shift's own hours*. **Threshold** and **Reading** are added.

**The catalogue gains Tasks**: Sheet, Blanket, Unrug, Fly Sheet On, Fly Sheet Off, Fans, and the alternate per-horse hay set. **Unrug is our word and not the barn's** — `CONTEXT.md`'s rule is that the barn's word wins, so it is provisional until somebody tells us what they actually say.

## What this does not do

**No wind or wet as a real input**, despite that being the best-evidenced part of the literature. If anything is ever promoted from advice to a predicate, this is the one, and it needs numbers the rescue does not currently have.

**No equine metric.** Neither the USEF sum nor FEI's WBGT is used, because neither offers a translation for the number this barn actually acts on. The enum makes adding one a data change rather than a migration.

**No approval mechanism.** The *only if instructed* gate is instruction text and an Observation, not authorization.

**No item-to-item dependencies.** Removal items read the previous Shift's snapshot, never its outcomes.

**No second provider, and no automatic re-evaluation.** Weather that turns mid-shift is a Lead deviating, recorded as a Not done with a reason — ADR 0013's position, unchanged.

## Consequences

**A cold night puts up to twelve garment items on a ninety-item Feed Shift.** ADR 0013 warned that a checklist where a third of the items are conditional has a shape nobody can predict. This survives that warning — the shape is seasonal and entirely expected by anyone who has worked a January morning, and each item is per-horse because each horse's threshold differs and the volunteer needs to know *which* horses. But the winter Feed Shift is materially longer than the summer one, and the subject-first work surface has to hold up under it.

**Materialization now depends on a third party.** ADR 0013 already made the daily job infrastructure the single VPS must run on time; it is now infrastructure with an external dependency and a documented degraded path.

**The app becomes the arbiter of what the weather is.** Today volunteers consult whichever app they have. That is a genuine improvement and it transfers the calibration risk onto us: if the Board's number is wrong or distrusted, the rules built on it are wrong or ignored.

**Three things are owed and none of them block.** The rescue sets the **Cold and Wet numbers**, as it sets ADR 0013's tolerances. Somebody compares **Open-Meteo's hourly apparent temperature against AccuWeather and Apple Weather** at the barn's coordinates across a few clear summer afternoons, to see how far the noon crossing moves. And an **email to info@open-meteo.com** confirms that a 501(c)(3)'s internal operations tool is acceptable under their non-commercial line — the data licence is CC BY 4.0 and carries no such restriction, but the terms are ambiguous enough to want in writing.

## What would make this wrong

**If nearly every horse ends up with an override.** The default exists to stop eight rows of identical numbers drifting apart. If the override becomes the norm, the default is fiction and the drift is back with an extra record to maintain.

**If the manual-resolution path becomes routine.** It is an exception justified by being rare. If Open-Meteo is unreliable enough that Leads resolve Conditions by hand most weeks, then materialize-once is dead and nobody decided that — it eroded.

**If volunteers keep reading their own phones.** The whole labelling design assumes the Board becomes the source everyone trusts. If people keep consulting their own apps and disagreeing with it, the app has added a fourth opinion rather than settled the question.

**If 85 is badly calibrated against Open-Meteo's solar term.** Horses stay in on days they should have gone out, and the failure is invisible — nobody notices a turnout that did not happen. This is what the comparison is for, and it should happen before the first hot week rather than after.

**If Conditions multiply.** Five predicates and two back-references is a set a Lead can hold in their head. The pressure to add will come from real cases, each individually reasonable, and ADR 0013's warning applies to their sum rather than to any one of them.
