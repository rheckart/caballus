---
status: accepted
---

# Shifts copy their roster and start time; Shift Patterns never reach into the past

A Shift Pattern is the recurring commitment ("Tuesday mornings"); a Shift is one dated occurrence of it. When a Shift is generated — on a rolling two-week horizon — it **copies** the Pattern's standing roster and start time rather than resolving them from the Pattern on every read. Editing a Pattern therefore changes future generations only, and the app explicitly asks whether to apply the change to the already-scheduled Shifts inside the horizon.

## Considered options

The alternative was to keep the roster only on the Pattern and have each Shift resolve it live, with a table of per-day exceptions for "I'm away Thursday". Both cases the rescue actually has — one-day absences and permanent moves to a different day — are expressible either way.

We rejected live resolution for two reasons. First, an exceptions table accumulates a special case for every human situation and becomes the load-bearing part of the design, which is the well-known failure mode of recurring-calendar models. Second, and decisively: a Pattern edit under live resolution **retroactively rewrites what was planned** for every Shift that has not yet been read. The rescue needs to answer "who was supposed to be there on the 14th" months later, and audit logging is a stated requirement, so the planned roster has to be a fact recorded at the time rather than a value recomputed on demand.

## Consequences

A Pattern change does not reach a Shift that already exists. This is simultaneously the point and the sharpest edge: a Volunteer Coordinator who moves someone to Tuesdays will find next Tuesday still showing the old roster unless they accept the prompt. The prompt is not optional polish — without it, the model is quietly wrong in the most common editing case.

The same copy-on-generate rule covers the start time, which the Shift Lead owns. "Change all my shift start times" is a bulk edit across the Patterns that Lead runs, plus the same apply-to-upcoming prompt; "change just Thursday" edits that one Shift.

# A Shift can never be cancelled

There is no `Cancelled` state. The property is never closed — horses require feed and shelter regardless of weather, staffing or holidays — so a Shift that nobody can staff is still a Shift, still visible, and escalating. It is not removed, and it does not lapse.

This is recorded because the absence is surprising. Every scheduling system a reader has met before has cancellation, and the natural instinct on encountering an unstaffable Shift is to add it. The domain forbids it: cancelling a Shift would represent a day on which the horses were not fed, which is not a state the rescue permits itself to record because it is not a state it permits to happen. The correct model of "we could not staff this" is an unstaffed Shift that escalates, not an absent one.
