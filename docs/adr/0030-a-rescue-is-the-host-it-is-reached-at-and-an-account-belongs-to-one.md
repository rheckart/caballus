---
status: accepted
amends: 0007 (the organisation is resolved per request, not once per deployment), 0008 (an Account belongs to one rescue, and there is no organisation switch), 0022 (the kiosk token is one per rescue), 0027 (`/me/email` no longer writes Better Auth's `user`), 0028 (each rescue texts under its own registration), 0029 (the session minted after Verify is the rescue's own Account)
---

# A rescue is the host it is reached at, and an Account belongs to one rescue

A second rescue wants to use Caballus, and more may follow. The database was built for this from the first migration: every table carries `org_id`, row-level security filters on it, and ADR 0007 chose that shape because retrofitting tenancy is the expensive direction. What was never built is the other half. `currentOrgId()` reads `APP_ORG_ID`, so one deployment serves exactly one rescue, and five other things are one-per-deployment beside it: the kiosk token, the barn's coordinates, the public origin, the Twilio sender and the daily SMS cap.

The cheap answer — a second container on the same Postgres with a different `APP_ORG_ID` — was considered first, and looking at it closely is what found the problem this ADR mainly exists to fix.

## The shared `user` table is a door between rescues

Better Auth's `user`, `session` and `verification` carry no `org_id` and no policy, because identity was declared not org-scoped (ADR 0008). `user.email` is unique across the whole database, while `volunteers.email` is unique only within one organisation. The text door (ADR 0029) then closes the gap between them the wrong way: Verify proves the handset, and `submitCodeByMobile` mints a session for **whichever `user` row holds the Volunteer's email address**.

So a `roster` holder at rescue B can create a Volunteer carrying a rescue-A President's email address and their own mobile number, sign in at B by text, and hold a session for the President's `user`. `claimAccount` links that `user` to B's Volunteer without complaint. One `BETTER_AUTH_SECRET` signs every cookie, so that session presented at A resolves through `actorForUser` to the President. Even with separate secrets, the same person can run `/me/email` at B and move the shared `user.email`, after which the President's next sign-in at A creates a new `user` that `claimAccount` refuses — a lockout, at somebody else's rescue's discretion.

None of this is reachable today only because a single rescue's `roster` holder already controls everybody in it. A second organisation makes it reachable under every deployment shape, a second container included.

## The decision

**An Account belongs to one rescue.** Better Auth's `user` row is keyed by an opaque address derived from the Volunteer it was claimed for — the Volunteer's id at a reserved, undeliverable domain — and never by a real one. The real email and mobile live on `volunteers`, where they always lived, and are where a code is _sent_; the opaque key is where it is _checked_. Sign-in resolves the Volunteer inside the rescue from what the person typed, mints the code against that Volunteer's key, and sends it to the address on the record. A `user` therefore answers for exactly one Volunteer of exactly one organisation, and `actorForUser` for any other organisation finds no `volunteer_accounts` row and answers nobody. The failure is closed and structural, the property ADR 0007 asks of tenancy.

Consequences that fall out:

- `/me/email` and `/me/mobile` move `volunteers` alone. ADR 0027's one deliberate second writer to `user` goes away, because nothing about `user` describes the person any more.
- A person who volunteers at two rescues holds two Accounts, signs in twice and carries two cookies. That is the honest shape: their Roles, their Shift Authority and their record at each rescue already had nothing to do with each other.
- Existing sessions survive the migration that rewrites `user.email`, because a session points at a `user` id and never at an address.

**A rescue is the host it is reached at.** `currentOrgId` takes the request and resolves its `Host` against a map held in configuration — `rescue-a.example` to one organisation id, `rescue-b.example` to another — and an unmapped host is refused rather than defaulted. It stays configuration rather than a column on `orgs` for two reasons: the `orgs` policy is keyed on `app.org_id`, so reading it by host would be a read before the tenant is known and an exemption in the policy catalogue; and adding a rescue is meant to be a deliberate deploy, the way migrations are (ADR 0007), rather than a row anybody with database access can insert.

**This contradicts ADR 0008 in one sentence, and on purpose.** ADR 0008 says `app.org_id` is derived "never from a URL, header or body". The host _is_ a header, and the ban existed because a client-supplied organisation id is the impersonation vector — a caller naming a tenant and being believed. The host is not believed: it chooses which rescue's door was knocked on, and the session still has to resolve to an Account **of that rescue**, which by the decision above it can only do if it was minted there. Point a rescue-A cookie at rescue B's host and the answer is nobody. ADR 0008's other sentence — _"the active organisation is a server-side session attribute changed by an explicit switch"_ — is withdrawn: with one Account per rescue there is nothing to switch, and a switch is the one mechanism that would put two rescues behind a single session.

**What is one per rescue moves to one per rescue.** Secrets stay configuration and are keyed by organisation; facts somebody might reasonably correct move onto the `orgs` row.

| Was                                               | Becomes                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `APP_ORG_ID`                                      | the host map                                                                                                      |
| `APP_URL`                                         | each rescue's origin, from its host — the link in a text and Better Auth's base URL                               |
| `BOARD_TOKEN`                                     | one kiosk token per rescue, in configuration (ADR 0022)                                                           |
| `BARN_LATITUDE` / `BARN_LONGITUDE`                | columns on `orgs`, set by `bootstrap`                                                                             |
| the Twilio sender (`TWILIO_*`)                    | one sender per rescue, in configuration (ADR 0028, below)                                                         |
| the SMS daily cap                                 | counted per rescue                                                                                                |
| the maintainer named on `/`, `/privacy`, `/terms` | the rescue's own name, operator and contact on `orgs`, because each rescue's campaign vetting reads its own pages |

`TWILIO_VERIFY_*` stays one, platform-wide: Verify sits outside A2P registration (ADR 0029) and a login code is asked for by the person receiving it.

**Each rescue texts under its own registration.** A 10DLC brand is the sender of record and belongs to one account or subaccount; STOP is kept per account. A shared number would put every rescue's volunteers under one rescue's — or one person's — consent, and a STOP to one rescue's text would silence the other's at the carrier while the app's own copy (`sms_stopped_at`, per Volunteer, per rescue) went on believing the second rescue could still reach them. So each rescue is registered as its own brand with its own campaign and number — in a Twilio subaccount under the maintainer's account if that account can be made an ISV, in the rescue's own Twilio account if not. The code does not care which: a sender is an account SID, credentials and a number, held per rescue. A rescue with no sender configured texts nothing and says so, which is the kill switch ADR 0028 already built, now per rescue. **This fires ADR 0028's tripwire for the first rescue too**: a brand registered to the maintainer personally cannot be stretched over two organisations, and the first rescue registers its own.

## Considered options

**A container per rescue** needs no code and was the first answer. It shares the hole above, multiplies every deploy by the number of rescues against one migration, and leaves the SMS registration question exactly where it was. It is what this ADR would fall back to for a rescue that wants its data physically separate, with its own database and its own secret.

**Better Auth's organization plugin** was declined in ADR 0008 for instance-scoped authority, and that reasoning is unchanged.

**Keeping one global identity and moving every rescue's copy of an address together** would make `/me/email` a write across tenants — the one thing row-level security exists to make impossible, and a person's contact details at one rescue changed by an act at another.

**Choosing the rescue after sign-in, on one shared host**, needs an active-organisation attribute on the session, a picker, and a session that spans rescues. It is ADR 0008's withdrawn switch, and it is the shape the host decision exists to avoid.

## What would make this wrong

**Better Auth refusing the opaque address**, or a future version deriving behaviour from `user.email` — a password reset, an account-linking flow — that this application never enables but might someday. The opaque key must stay undeliverable, and `sendVerificationOTP` must refuse it rather than mail it.

**A rescue that cannot have its own hostname.** A subdomain of a domain the maintainer holds costs nothing, so this is unlikely; if it happens, the picker above is the fallback and this ADR is superseded rather than stretched.

**A volunteer for whom two Accounts is a real burden** — somebody who leads Shifts at both rescues every week. A year-long session at each makes it two sign-ins a year, which is the cost being accepted knowingly.
