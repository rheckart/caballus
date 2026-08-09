# Caballus

Operations for a horse rescue: the daily care of horses and the coordination of the volunteers who deliver it. This file is the glossary — the words the app and the barn agree to use. It is not a spec; decisions live in the issue tracker, and implementation detail lives nowhere near here.

Terms are added only once settled with the rescue. The barn's own words win over ours.

## Language

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

**Medication Authority**:
Permission to prepare and administer medication, held by a Feed Shift Lead or Co-Lead. A Shift must have at least one person who holds it, because without one the horses cannot be medicated at all. Preparing food carries no such requirement, despite the feed room sign saying otherwise.
_Avoid_: lead permission, med rights

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

### Horses and places

**Field**:
A turnout area, named by letter (A–E). A horse's field assignment may be a set — "all of C and D" is a real value on the board.
_Avoid_: paddock, pasture, turnout group — note these are used interchangeably in the barn and their relationship is not yet settled (#10)

**Small Barn**:
A second barn housing horses without numbered stalls, kept as its own section of the feed board. Covered by the same Shift as the main barn.
_Avoid_: annex, second barn
