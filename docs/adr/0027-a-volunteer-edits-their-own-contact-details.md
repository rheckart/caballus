---
status: accepted
extends: 0008 (the Account is claimed, and revocation is a delete with no staleness window), 0009 (email is the only channel, and therefore the credential), 0010 (a floor rather than a third axis past the two reasons anybody may act), 0012 (the floor's own reading of *your own*), 0017 (what stays behind `roster`, and why), 0019 (no fifth hand-rolled table)
---

# A Volunteer may edit their own contact details, and changing the email is changing the credential

Until this decision nothing in this application let a person change anything about themselves. `/me` is a read. Every write about a Volunteer — `/volunteers/date-of-birth`, `/volunteers/orientation`, `/volunteers/release`, `/volunteers/roles`, `/volunteers/medication-authority` — takes a `volunteerId`, sits behind `roster`, and demands a `reason`. A volunteer whose mobile number changed had to find a Coordinator.

That is fixed for **name and mobile and email, and nothing else**.

## It is a floor, not a new axis

ADR 0010 gives exactly two reasons anybody may act: a Domain Scope, or Shift Authority over the Shift being named. "It is my own record" is neither, and #34 explicitly refused to add a third.

It does not need one. The floor is already the mechanism for an act that needs no Scope at all — `floor('record-your-own-presence')` (ADR 0012) and `floor('work-on-a-shift-you-are-rostered-on')` (#42) are both this shape, and ADR 0012 already reasoned about what "your own" means when it decided that anybody may record anybody's arrival. `floor('edit-your-own-contact-details')` joins them. The check that the subject is the actor lives inside the handler, as `escalateObservation` and `recordSuppliesReading` already resolve their data-dependent checks inside themselves.

## Three fields, and the line is drawn at _who can honestly say it_

Name, mobile and email are facts a person is the best authority on. Everything else about a Volunteer is a statement **somebody else** has to make, and letting the subject make it defeats the thing:

- An **Orientation** is a Coordinator saying they oriented you.
- A **Release** and a **Consent** are records that a piece of paper exists in a filing cabinet, and ADR 0017 already says a Release is never self-recorded for exactly this reason.
- A **date of birth** is verified against photo ID; self-service is the gate defeating itself, since the age is the gate's own input.
- **Roles** and **Medication Authority** are grants, and a grant you can award yourself is not a grant.

Those all stay `roster`-only and unchanged. The three that move carry an audit entry like any current-state edit (ADR 0003), and no `reason` — a `reason` field exists because somebody is explaining a decision about another person, and "I changed my own phone number" is not a decision anybody will ever ask about.

`roster` keeps its own door to all three, unchanged. A Coordinator fixing `jsmtih@` to `jsmith@` commits immediately, because the volunteer may never have signed in and waiting on an inbox nobody owns means the typo is never fixed.

## The email is the credential, and that is the whole of the design

ADR 0009 makes email the only channel: you sign in with a six-digit code mailed to your address. `requestCode` gates on `volunteerByEmail(orgId, email)`, so **`volunteers.email` is what decides whether a code is sent at all**. Changing it is not editing a contact detail; it is editing a credential, and doing it naively locks the volunteer out permanently:

> Change A to B. The existing session survives, because a session resolves through `volunteer_accounts.userId` and not through an address. Sign in again with A and the gate refuses — no Volunteer has A. Sign in with B and Better Auth mints a fresh `user` with no `volunteer_accounts` row, and `actorForUser` refuses that too. Only a Coordinator can undo it.

So a self-edit of the email is verified before it commits, and four things follow.

**The pending change needs no table.** The unverified code _is_ the pending state, in Better Auth's own `verification` row keyed by the new address. The code proves the inbox; the session proves who is asking; the commit runs as the actor. A `pending_email_changes` table would be the fifth hand-rolled log ADR 0019 warns about, and it would need expiry and cleanup that `verification` already has. The code is minted with a **different OTP type from `sign-in`**, so a code obtained through the change flow can never be replayed at the login screen.

**`volunteers.email` and `user.email` move in one transaction**, or neither moves. They are two tables holding one truth, and a half-applied change is the lockout above with extra steps.

**The old address is told.** One message, on the sender `requestCode` already uses: _your sign-in address was changed_. It is the only way a person losing their account finds out, and without it a stolen session becomes a stolen account silently and permanently.

**Every other session is deleted.** Sessions are rows and revocation is a delete with no staleness window (ADR 0008), so the mechanism is already built. Changing the credential ends the sessions that were opened under the old one, except the one that made the change.

Shadowing somebody is already impossible and no code is needed for it: `volunteers_email_in_org` is a unique index on `(org_id, email)`, so a second Volunteer claiming an address in use is refused by the database.

## Consequences

**A self-edit of the email always implies a claimed Account**, because it takes a session to reach. The unclaimed case — a Volunteer created by a Coordinator who has never signed in — is `roster`'s door and needs no verification, since there is no credential in use yet to protect.

**`user.email` is unique globally while `volunteers.email` is unique per org.** One person volunteering at two rescues in a future multi-org deployment would collide on `user` and not on `volunteers`. Nothing here creates that problem and nothing here solves it; it is recorded because this is the first write that touches both columns and a future reader will meet it here.

**Email and mobile are still `behindRoster` on the people list** (ADR 0017), and that is not a contradiction. The redaction protects _other people's_ details from a reader without `roster`; it was never about your own, which you read on your own screen.

**This ships after the shell and the dashboard**, as its own ticket. It is a new authorization floor, a new audited write and a new verification flow, and folding it into a navigation change would bury all three.
