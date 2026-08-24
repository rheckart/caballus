---
status: accepted
extends: 0010 (the read-everything floor answers *may you look*; a Destination answers *is there anything here for you to do*, and they are different questions), 0011 (the disabled-and-explained action still governs a control on a screen; it stops governing a Destination), 0025 (the shell this is built into)
---

# Navigation offers what you may act on, not what you may read

Until #61–#63 this application's navigation was a top bar of five links, a bottom tab bar of five tabs, and a home screen carrying a tile for all nineteen Destinations. `src/routes/index.tsx` stated the rule in writing: _"Every tile is shown to everybody still — the server is what refuses, and a link that is not there is indistinguishable from a broken app"_, and named ADR 0011's disabled-and-explained action as its precedent.

That rule is overturned here for **Destinations**, and kept for **controls**. A plain Volunteer is offered the barn and is not offered the desk at all.

## The read-everything floor cannot decide this, and the attempt is what proves it

The obvious rule is _hide a Destination when the read behind it would refuse you_. It is honest, it is computable from `/me`'s `domainScopes`, and it does almost nothing. Counted against `src/server/api/app.ts` as of this decision, of the thirteen desk Destinations, eleven read through `readEverything()` — `/volunteers`, `/release-versions`, `/spaces`, `/horses`, `/products`, `/thresholds` and `/tasks` among them — and only `/audit` and `/attendance` sit behind `roster`. Hiding by the read hides two of thirteen and leaves the other eleven in front of a volunteer who cannot change a thing on any of them.

That is not a defect in ADR 0010. It is ADR 0010 working: the rescue's records are deliberately open, because a volunteer who cannot see the Task catalogue cannot follow it, and secrecy about a horse's feed helps nobody. The floor answers **may you look**. Navigation is asking a different question, and it has to be gated on a different fact.

So a Destination is gated on the **write it exists to perform**. `/admin/spaces` exists to run `mutation('/spaces', domainScope('horse_care'))`; without `horse_care` there is nothing there but a read you already have at `/spaces`. `/admin/audit` and `/admin/attendance` have no write of their own and keep the read as their gate. Each is a static set of Domain Scopes, decidable from `/me` alone.

## The disabled-and-explained action survives, at the smaller scale

ADR 0011 argues that an action a person may not take should be **shown and refused with a reason**, because a control that vanishes teaches nothing and reads as a broken app. That argument is correct and is not weakened here. It governs a **button on a screen you are already on**: the disabled Cover button says _this application can do this, and here is why not for you today_, which is information.

A Destination is not that. A nav entry to a screen where every control is disabled teaches a person nothing except that they wasted a tap, and it repeats the lesson on every screen they open. Worse, at the scale this application has reached the honest version of the rule is a menu of nineteen entries of which twelve are dead for most of the sixty — and a menu that is mostly dead is a menu nobody reads, which is the same failure ADR 0014 names about a wall of notices.

The line is: **a control is shown and refused; a Destination is offered or not offered.** One is a fact about an act. The other is a fact about whether there is any act.

## It is declared by hand, in one module, and tested

`src/shared/navigation.ts` holds one entry per Destination — its path, its label, its group and the Domain Scopes it needs — and a table test asserts that every Destination the shell can render has an entry, so a screen added without one fails the build rather than appearing for everybody.

It is not derived. `src/shared/api-contract.ts` records paths and shapes and deliberately records no authorization (ADR 0021); the authorization lives in `src/server/api/app.ts`, and a screen's _defining_ write is a judgement — `/admin/products` calls several — that nothing can pick out mechanically. Hand-declared and asserted is the same shape `src/shared/roles.ts` already holds for the Role-to-Scope mapping, and for the same reason: the mapping is small, it is a decision, and a wrong entry should be visible in a diff.

## Consequences

**This is cosmetic and never a security boundary.** Every one of these screens is still reachable by typing its path, and must be: the server refuses, exactly as it does today, and nothing in `src/server/` reads `navigation.ts`. A future reader must not mistake a hidden Destination for an authorization check.

**The barn is unaffected.** Its Destinations are all on the floor and there is nothing to hide, with one exception — `/attendance`, which #43 put behind `roster` against ADR 0012's own argument. The bottom tab bar therefore never changes shape, which matters: a volunteer in a barn should find Shifts in the same place every time.

**A plain Volunteer sees no desk group at all**, rather than a desk group with two entries in it. A group heading with nothing under it is the empty-tab failure ADR 0011 already names.

**Home stops being the menu.** With navigation carrying every Destination, a home screen whose job was to list them has no job, and it becomes the barn's dashboard instead. That is a separate decision and a separate ticket; it is named here because it is the direct consequence of this one, and because Sign out currently lives on Home and has to move with it.
