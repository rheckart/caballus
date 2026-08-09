# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Greenfield. As of the first commit this repo contains only `brainstorming_document.md` — no source, no stack, no dependencies, no CI. Nothing below describes existing code; it describes the domain the code will model.

**No stack has been chosen.** Do not assume one. If a task requires picking a framework, database, or language, raise it as a decision rather than silently scaffolding.

## Commands

None yet. When a stack is chosen, replace this section with the real build / test / lint / run commands, including how to run a single test.

## Product

"Caballus" — a **mobile-first** application for horse rescue organizations. Primary users are volunteers working a shift in a barn, on a phone, often outdoors and possibly on poor connectivity. Data capture during a shift is the core loop; reporting and coordination are built on top of it.

## Domain model

Two entity clusters, and most features are joins between them.

**Horse** is the central record. It accumulates append-only logs across many care domains — feeding/nutrition, medical, dental, farrier, daily wellness, behavioral/training, emergency, adoption/foster/transfer, end-of-life. Design implications that recur across all of them:

- Care events are **historical logs, not current-state fields**. Feed changes, weight, body condition, medication, and training progress each need date + actor + reason, because "why did this change" is a real question rescues ask. Overwriting current state loses the answer.
- Many domains pair a **schedule** with a **history** and derive an **overdue alert** from the gap (vaccination, deworming, dental, farrier, grooming). That schedule/history/overdue triad is one pattern, not five — model it once.
- Fields that look required frequently aren't known. Date of birth is often unknown, so **age is derived when DOB exists and entered directly otherwise**. Assume incomplete intake data throughout.
- Photos attach to care events, not just to the horse (hoof records pre/post farrier, dental findings, memorial photos).
- Documents and compliance artifacts (Coggins, health certificates, adoption/foster/relinquishment agreements, test results) attach to the horse and have their own expiry/regulatory tracking.
- Audit logs are required for all record changes.

**Shift** is the other core entity, and it is where volunteers actually spend their time. A shift has a lead, a co-lead, volunteers, a start time, and a checklist. Two kinds:

- **Regular feed shifts** run a standard checklist: prepare food per horse, prepare/administer medication per horse, turn horses in/out, check real-feel temperature and act on it, hay and water in every paddock/field/stall (water heaters on when cold), muck paddocks and stalls, groom, fly spray, sunscreen, sweep barn.
- **Pop-up shifts** are ad-hoc (special feeding, hosing horses down in heat, welfare checks in adverse weather) and use **volunteer sign-up** rather than assignment.

Checklist items are **per-horse or per-area**, and some are **role-restricted** — food prep and medication are typically limited to the Feed Shift Lead or Co-Lead. Checklist completion is not a single boolean on the shift.

**Weather drives care decisions.** Real-feel temperature above or below a horse's threshold changes what happens on a shift: sheets/blankets in cold, fans in heat, horses kept in stalls at either extreme, water heaters on. Thresholds are per-horse. This means the app needs real-feel temperature as an input, not just a display.

**Shifts generate reports that route to roles.** A volunteer on a feed shift observing a medical, dental, or farrier issue reports it to the Head of Horse Welfare; a maintenance issue goes to the Head of Maintenance; low medicine/feed/supply levels trigger reorder. This observation → routed report → coordinator action flow is a first-class workflow, not an afterthought.

## Roles and permissions

Roles are the authorization model. **A volunteer may hold many roles simultaneously** — model this as a many-to-many assignment, never a single `role` column on a user.

- **President** and **Board Member** — can perform all functions for all roles.
- **Treasurer** — all financial matters.
- **Head of Maintenance** — sees and acts on maintenance and groundskeeping items.
- **Head of Horse Welfare** — sees and acts on medical/dental/farrier items; ingests issues reported from feed shifts, coordinates them back to volunteers, schedules visits.
- **Volunteer Coordinator** — new-volunteer orientation, assigning volunteers to shifts, removing volunteers from shifts or the rescue.
- **Feed Shift Lead** / **Feed Shift Co-Lead** — same responsibility set: set shift start time, food prep, medication, checklist completion, supervise volunteers, report medical/dental/farrier and maintenance issues upward, report low supplies.
- **Feed Shift Volunteer** — completes checklist items assigned to them by the Lead/Co-Lead.
- **Event Coordinator** — educational and public events (scout horsemanship badges, holiday events, open houses) and volunteer sign-up registration for them.

Permissions are scoped by **care domain** (medical/dental/farrier vs. maintenance vs. financial vs. volunteer management), which is why the two "head" roles and the Treasurer partition cleanly. Build authorization around domain scopes rather than enumerating per-endpoint role lists.

## Source of truth

`brainstorming_document.md` is the product brief and is more detailed than the summary above — read it before designing any feature area, since each care domain has specific fields listed there. It is aspirational scope, not a committed roadmap; the app is intended to eventually cover all aspects of rescue operations.
