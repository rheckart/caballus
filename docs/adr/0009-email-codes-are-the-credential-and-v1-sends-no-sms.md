---
status: accepted
supersedes: 0008 (credential), 0004 (notification channel)
---

# Email one-time codes are the credential, and v1 sends no SMS

Volunteers sign in with a six-digit code sent to their email address. **Caballus v1 sends no SMS at all** — not for login, not for notifications. Email carries everything the app sends, and the rescue keeps its Facebook group in service for urgent broadcast, in the same way ADR 0006 keeps the whiteboard in parallel.

This supersedes ADR 0008's credential decision and the notification channel in ADR 0004. Everything else in both stands: Better Auth still owns identity and nothing else, sessions are still permanent database rows, revocation is still the only control, and the client is still an installable PWA.

## Why

US application-to-person SMS requires registration with The Campaign Registry against an EIN and an exactly-matching legal name, with campaign review currently running ten to fifteen days and unregistered traffic filtered silently rather than rejected. That is a three-to-four week dependency on a board conversation, a tax record and an approval queue, sitting in front of a proof of concept whose entire user base is the maintainer and an officer or two. The research is in `docs/research/sms-providers.md`; the conclusion here is that it is the wrong shape of work for this stage, not that it was priced wrong.

**ADR 0008 also made a mistake worth naming: it put the ability to log in behind a carrier approval queue.** Nothing about authentication needed that. Email decouples the two permanently, so even when SMS returns it will gate notifications only, and never the ability to use the app.

Better Auth's email-OTP plugin is the better-worn path as well — ADR 0008 accepted visible roughness in the phone-number plugin's API, and that cost disappears here.

## Considered options

**A magic link was rejected on a failure ADR 0004 already identified for SMS**: *"the messages app opens whatever browser it likes."* Email is worse. A link tapped inside the Gmail or Outlook app opens an in-app browser, the session cookie lands there, and the volunteer's real browser is still signed out. They try twice and conclude the app is broken. A typed code puts the session in the browser that asked for it.

**Deferring SMS rather than dropping it** was the recommendation, on the grounds that ADR 0006 runs the POC with no volunteer accounts, so there is nobody to notify urgently and nothing to decide yet. It was declined in favour of dropping it outright, which is the more honest position: a deferred channel still shapes designs around itself, and #11 and #14 would have been written against a delivery mechanism that does not exist.

## Consequences

**What is lost is not delivery, it is the urgency signal.** Email reaches phones; most volunteers see mail notifications. What disappears is the distinction ADR 0004 was built to protect — SMS for anything time-bound to a shift, email for everything else, *"never both for the same event... that is what keeps an SMS meaning something needs you now — the property the Facebook group lost by carrying everything."* One channel carrying everything is precisely that failure. Caballus v1 accepts it, in exchange for not carrying a carrier registration into a proof of concept.

**The map's incumbent table is now half true, and should be read that way.** It claims the Facebook group — issue reports *and* low-manpower calls — is replaced by routed issue reporting plus shift staffing. Issue reporting survives: it becomes a routed record with an owner, which is strictly better than a post that scrolls away. A short-staffing call for tonight does not, because nobody is reliably reached within the hour by email. **The Facebook group stays in service for urgent broadcast**, and #11 narrows to in-app sign-up for a call that was made elsewhere. Pretending otherwise would be the fabricated-completion failure the map forbids everywhere else.

**ADR 0004's tripwire fires, but narrowly.** That ADR says anything making SMS untenable reopens the platform choice with it. What actually reopens is the **notification** question. Native's advantage over web was push; with v1 doing no push at all, that advantage is unrealised and the PWA still wins on every argument ADR 0004 made. The platform choice only genuinely reopens if push later becomes *required*, at which point iOS delivering web push solely to home-screen-installed sites resurrects the native argument in full.

**An email address is now a precondition for having an account at all**, and this is the sharpest risk here. ADR 0004 chose SMS partly because email reachability was not assumed across this roster. A volunteer with no email, or who never reads it, cannot log in — where previously they could not be *notified*, which is a smaller failure. At POC scale this is invisible. **It is the most likely thing to force SMS back**, and it will surface as onboarding failures rather than as an outage, so it needs watching rather than monitoring.

**Email is required at invite; a mobile number is still collected but no longer enforced.** The Coordinator now creates a Volunteer from a name and an email address, reversing ADR 0008's position that email was optional. The mobile number keeps being collected because backfilling sixty of them later is the kind of chore that never happens, but ADR 0004's rule that a reachable number is a precondition for holding a Lead or head role is suspended — it enforces nothing without a channel — and returns with SMS.

**Several problems evaporate rather than being solved.** ADR 0008's two senders with separate budgets and kill switches, the STOP-lockout recovery path, the separate auth SMS cap, and the carrier-mandated consent capture added to ADR 0008 after researching #18 — all of these existed because of SMS. None applies to transactional email. The consent record is worth collecting at invite anyway, at zero cost, because SMS registration would require evidence of it later. ADR 0004's daily cap and kill switch still apply to email, for the cheaper reason that a bug that mails sixty volunteers repeatedly is its own kind of damage.

**Sending goes through Fastmail SMTP on `heckart.me` for the POC**, with an app password in 1Password per ADR 0006 — no new vendor, no DNS work, no DKIM setup, about ten lines behind Better Auth's send function, comfortably inside Fastmail's limits at this volume. What it is not is transactional-grade: no delivery webhooks, no bounce handling, and application mail sharing reputation with the maintainer's personal mail. **The exit at go-live is Resend on a subdomain**, so the rescue's sending never touches the apex domain's records, and it moves to a domain the rescue owns as part of the same ownership question ADR 0006 left open.

## What brings SMS back

Any one of: a volunteer who cannot be onboarded because they have no usable email; the whiteboard tripwire in ADR 0006 firing, at which point short-staffing calls stop being something Facebook can be trusted with; or #11 being genuinely needed rather than narrowed. When it returns, `docs/research/sms-providers.md` holds the costed path — Twilio, Low Volume Standard brand, roughly nine dollars a month, three to four weeks of lead time — and it returns for **notifications only**. Login stays on email permanently.
