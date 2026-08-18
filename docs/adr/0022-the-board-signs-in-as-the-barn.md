---
status: accepted
extends: 0010 (a fifth authorization, and the first that is not a person; the read-everything floor gains one non-Volunteer reader), 0008 (identity is Better Auth's and this is deliberately not identity), 0016 (a sixth entry in *what becomes a type*: the Board's authorization cannot be spelled on a write)
---

# The Board signs in as the barn, and the credential is configuration

The Board is a rescue-owned tablet on a wall in the feed room, showing the grid all day (`CONTEXT.md`'s Board). It records nothing and therefore credits no actor. But something has to authorize the read, and every existing answer is wrong for it:

- **Signing the tablet in as a person** puts a Volunteer's live session on an unattended screen in a barn. It also credits a person: `/me` answers Grace, and the first write the app ever grows on that surface is attributed to whoever was last at the desk. ADR 0010 hangs authorization off the person the barn knows precisely so that this is never ambiguous.
- **Serving the Board to anybody who asks** makes the whole feed grid — eleven horses, their medications and their stalls — a public URL. The floor is _every Volunteer_, which is a person the organisation knows and not the internet (ADR 0010).
- **A Volunteer record for the tablet** ("Barn Tablet") is the impersonation ADR 0008 rules out, wearing a name badge. It would hold Domain Scopes, appear on the people list, and be rosterable.

## The decision

The Board authenticates with **one shared kiosk token, held in configuration** as `BOARD_TOKEN`, sent by the tablet as an `x-board-token` header on the one read it makes. `src/server/auth/kiosk.ts` compares it in constant time; unset means there is no kiosk, which is the state of every development box and fails closed.

The token is not identity. It resolves to no `Actor`, so `context.actor` stays `null` and there is nobody to credit — the same fact the glossary states about the Board, now true by construction rather than by the surface happening to have no buttons on it.

A new authorization, `board()`, allows **a signed-in Volunteer or the barn's tablet**. A volunteer looking at the Board on their own phone is an ordinary reader; the tablet is the carve-out.

**It can never authorize a write.** `mutation`'s authorization argument is typed as `Authorization` minus this one, so a write declaring `board()` does not compile — ADR 0016's move, applied to the one authorization in the system that is not a person. That is what keeps _the Board records nothing_ from being a property of today's screen.

## Why a shared secret and not a device record

A `kiosks` table with a hashed token per device, minted from an admin screen and revocable one device at a time, is the shape this would take at scale. The rescue has **one tablet**. A table, a migration, a mint endpoint and an admin surface to manage a set of size one is a management surface nobody would open twice a year, and the thing it buys — revoking device 3 while leaving devices 1 and 2 alone — has no case here.

Rotation is `BOARD_TOKEN` changing and the container restarting, which is a thing the rescue's deployment already does (ADR 0006, 0007). The tripwire is a second tablet in a second building: at that point the device becomes a record, and this ADR is superseded rather than stretched.

The tablet is enrolled once, by hand, by opening `/board?token=…` on it. The screen keeps the token in `localStorage` and takes it out of the URL, so the secret is not left sitting in a history entry on a screen anybody can walk up to.

## Consequences

The Board's read is `/board`, and it is the only endpoint `board()` is declared on. Everything else on that tablet — the horse profile a row links to — is behind the ordinary floor, so a kiosk cannot drill down. The screen knows this and renders its rows as plain cells rather than links when it is holding a kiosk token: a link that leads to a refusal is worse than no link, and the drill-down is a phone's affordance anyway (#37).

`RequestContext` grows one boolean. It is resolved on every request like the actor is, from the header and the configured token and nothing else — never from a body, a query or a cookie the caller could have set for another reason.

A leaked token reads the feed grid until it is rotated. That is the exposure, stated plainly: it is the same information as a photograph of the whiteboard, which is on a wall in a barn that every volunteer walks into, and it can write nothing.
