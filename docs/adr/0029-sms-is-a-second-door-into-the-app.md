---
status: accepted
amends: 0009 (login no longer stays on email permanently), 0027 (a Volunteer changes their own mobile, verified)
---

# SMS is a second door into the app, and Verify keeps login off the carrier queue

ADR 0009 ended with a sentence meant to be permanent: _"it returns for notifications only. Login stays on email permanently."_ That sentence rested on an argument, and the argument no longer holds.

The argument was that ADR 0008 made a mistake by _"putting the ability to log in behind a carrier approval queue"_ — three to four weeks of campaign review sitting in front of anybody being able to use the app. **Twilio Verify has no queue.** It is a dedicated verification service, explicitly outside A2P brand and campaign registration; Twilio's own 10DLC documentation steers OTP traffic off a messaging campaign and onto it. At $0.05 per successful verification plus $0.0083 per SMS, with no monthly fee and sessions lasting about a year, sixty volunteers cost single-digit dollars annually.

The premise dissolved. The conclusion goes with it.

# A second door, never a replacement

Email stays the credential it is. The login screen accepts an **email address or a mobile number**, and mails or texts a code to whichever one matches a Volunteer.

Replacing email was rejected and it is not close. `volunteers.email` is the credential `requestCode` gates on; ADR 0027 has just built `/me/email`, which mints a `change-email` OTP, verifies it, and moves `volunteers.email` and Better Auth's `user.email` in one transaction. Throwing that away buys nothing — the volunteers who read email are the majority and they cost nothing to reach.

What the second door buys is the volunteer ADR 0009 named as its own sharpest risk: _"a volunteer with no email, or who never reads it, cannot log in."_ That volunteer is not hypothetical here. They are the reason this whole line of work started.

# It could not have been done on the notification campaign anyway

Worth recording, because it looks like the obvious way and is a dead end. The Sole Proprietor brand ADR 0028 registers permits **one campaign, one number**, under a fixed `SOLE_PROPRIETOR` use case. There is no second campaign to put login codes on, and putting them on the first one is the thing Twilio's own guidance says not to do.

**Verify also buys back a rule ADR 0008 was paying $10 a month for.** That ADR required login and notifications on separate senders so that a notification opt-out or a tripped kill switch could never lock the roster out of the app; `docs/research/sms-providers.md` costed that isolation at a second campaign. Verify is a separate path from the messaging service by construction, so STOP on notifications cannot touch login. The isolation is now free and structural rather than bought and remembered.

# `/me/mobile` ships in the same ticket, or none of this ships

This is the trap, and it is the same one ADR 0027 already walked out of once.

The moment a text is how somebody logs in, **a new phone number is a permanent lockout that only a Coordinator can undo** — the exact failure ADR 0027 identified for email and solved by verifying the new address before moving it. Shipping SMS login without the matching self-serve change flow re-creates the lockout the previous ticket removed, for a different field.

So `/me/mobile` takes the shape `/me/email` already has: a code minted to the **new** number, of a type structurally unreachable from the login screen, verified before `volunteers.mobile` moves. Same ticket. Not a follow-up.

## Consequences

**Two channels means two ways into an account** — whoever holds the inbox or the handset gets in. Accepted, and recorded rather than discovered: sixty volunteers, no financial data, and nothing behind `roster` worse than contact details and a date of birth. The exposure with email alone was already this shape.

**Login is not gated on SMS Consent.** A code is asked for by the person receiving it, in the moment, which is not standing permission to be messaged. ADR 0028's consent record gates the Urgent Send and nothing else — and the separation is what stops a volunteer who replied STOP to a staffing text from finding they can no longer sign in.

**Better Auth's phone-number plugin is not reintroduced.** ADR 0008 accepted visible roughness in it and ADR 0009 was glad to be rid of it. Verify owns the code and its lifetime; what Caballus stores is which channel a code went to, in the shape `src/server/auth/email-change.ts` already established for verification it owns rather than borrows.
