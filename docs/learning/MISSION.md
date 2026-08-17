# Mission: Email as Caballus' credential channel

## Why

ADR 0009 makes an emailed six-digit code the **only** way anyone signs in to Caballus, and the only way the app ever contacts a volunteer. That makes the mail path load-bearing in a way it is not for most applications: when mail stops, sixty volunteers cannot get into the app at all, and the failure shows up as onboarding that quietly doesn't work rather than as an outage anybody gets paged for. Rob needs to be confident about that path end to end — able to run it on his own machine today, able to trust Fastmail SMTP at the POC, and able to move it to Resend at go-live without discovering the gaps in production.

## Success looks like

- Signing in on the dev box start to finish, reading the code out of a local inbox, without touching a real mail provider
- Being able to say, for any failed sign-in, which of the five refusals it was and where to look
- Knowing what Better Auth owns in the mail path and what Caballus owns, well enough to debug a break in either
- Configuring Fastmail SMTP for the POC deliberately — app password, port, and what an `@` in a username does to a connection URL
- Knowing what has to be true before the Resend move at go-live, and what breaks if it isn't

## Constraints

- Learning happens against the real repository, not a toy — lessons should cite `src/` files by path
- The dev box already runs Postgres on 5432, so anything added must not fight for a port
- No real mail may leave the machine during development; a volunteer's address is personal data (ADR 0007's scrubbing rule)

## Out of scope

- SMS. ADR 0009 dropped it outright, and it returns for notifications only, never for login
- Deliverability as a discipline — SPF/DKIM/DMARC tuning, warm-up, reputation monitoring
- Email templating and design. Caballus sends plain text, and one message
