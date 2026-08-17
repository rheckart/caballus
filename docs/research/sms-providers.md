# SMS provider, 10DLC registration, and how it gets tested

**Status:** research complete, recommendation pending decision on #18
**Date:** 2026-08-12
**Question:** Which SMS provider should Caballus use, what does US A2P registration cost and take, and how is any of it exercised in development?

---

## TL;DR

**Twilio, on an account owned by the rescue, registered as a Low Volume Standard brand with two Low Volume Mixed campaigns.** Roughly **$9/month** all-in, about $35 one-time.

The deciding factor is not the per-message rate. At the volume Caballus will send — a few hundred messages a month — the spread between the cheapest and the dearest provider is under two dollars a month, while the fixed carrier and registry fees are five to ten times that and are broadly the same whoever you buy from. **Choose on developer experience, deliverability and who owns the account.**

Two findings matter more than the provider choice:

> ⚠️ **The account cannot be personal.** Registration requires an EIN and a legal name matching IRS records exactly. This is the first piece of Caballus infrastructure where the ownership question ADR 0006 deliberately left open has no personal option.

> ⚠️ **Real delivery cannot be tested before registration completes, and campaign review currently runs 10–15 days.** Unregistered US A2P traffic is _silently filtered_ rather than rejected, so a successful-looking send proves nothing. Development must not depend on real SMS, and registration should start long before it is needed.

---

## Why this is not a price comparison

| Provider               | US outbound, per segment |
| ---------------------- | ------------------------ |
| Telnyx                 | ~$0.0040                 |
| AWS End User Messaging | ~$0.0065                 |
| Plivo                  | ~$0.0077                 |
| Twilio                 | ~$0.0079–0.0083          |

At 400 messages a month the whole range spans about **$1.60/month**. Carrier pass-through fees (~$0.003/message; T-Mobile's 2026 rate is $0.0025) apply on top and are identical across providers because they are the carriers' fees, not the vendor's.

Against that, campaign registration costs **$1.50–$10 per campaign per month**, and ADR 0008 requires two. The fixed cost dominates by an order of magnitude, which is why the rate card should not drive this decision.

## The 10DLC fee structure

US application-to-person traffic over a 10-digit number requires registration with The Campaign Registry, in two layers:

**Brand** — the organisation, registered once.

| Brand type                        | One-time | Notes                                                               |
| --------------------------------- | -------- | ------------------------------------------------------------------- |
| Sole Proprietor                   | ~$4.50   | For individuals without an EIN; tight throughput; poor fit for auth |
| Low Volume Standard               | ~$4.50   | Needs an EIN                                                        |
| Standard (with secondary vetting) | ~$46     | Needs an EIN; required for the Charity use case                     |

**Campaign** — what you send and to whom, registered per use case, with a one-time vetting fee around $15 and a monthly fee thereafter.

| Use case                               | Monthly |
| -------------------------------------- | ------- |
| Low Volume Mixed                       | $1.50   |
| Charity (501(c)(3))                    | $3      |
| Emergency Services                     | $5      |
| Most standard use cases, including 2FA | $10     |

Registration under the **Charity** use case triggers an automatic check of the submitted name and EIN against IRS tax-exempt records. If the legal name does not match exactly — punctuation and abbreviations included — the brand is rejected.

## Two paths, and the cheap one is not the obvious one

|                            | Path A — Low Volume                  | Path B — Charity                                             |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| Brand                      | Low Volume Standard, ~$4.50          | Standard + vetting, ~$46                                     |
| Campaigns                  | 2 × Low Volume Mixed, $1.50/mo each  | Charity $3/mo + 2FA $10/mo                                   |
| Vetting                    | ~$15 per campaign, one-time          | ~$15 per campaign, one-time                                  |
| Carrier fees               | ~$0.003/msg                          | T-Mobile waives fees on verified 501(c)(3) charity campaigns |
| Throughput                 | Capped — irrelevant at 60 volunteers | Higher                                                       |
| Numbers                    | 2 × ~$1.15/mo                        | 2 × ~$1.15/mo                                                |
| **Recurring, ~400 msg/mo** | **~$9/mo**                           | **~$19/mo**                                                  |

Path B looks like the natural fit for a rescue and costs twice as much, because the **$10/month 2FA campaign** dwarfs the charity discount. T-Mobile's fee waiver is worth roughly $1.20/month at this volume; it does not close the gap until traffic is in the thousands.

Both paths need the rescue's EIN. Path A does not forfeit the nonprofit discount either — that comes from Twilio's own programme, not from the campaign use case.

**Against ADR 0006's roughly $25/month ceiling, Path A is comfortable and Path B is most of the budget.**

## Nonprofit discount

Twilio.org's **Impact Access Program** gives verified 501(c)(3) organisations a **25% ongoing discount** in the US plus a one-time $100 credit. It requires an upgraded (non-trial) account, as does 10DLC registration itself, so the order of operations is: create the account under the rescue, upgrade it, apply for Impact Access, then register.

## What the two-sender rule costs

ADR 0008 requires login SMS and notification SMS on separate senders, so that a notification opt-out or a tripped kill switch can never block a volunteer from logging in. Twilio scopes STOP handling to a **Messaging Service**, and a Messaging Service maps to a campaign — so two isolated opt-out scopes means two campaigns, which is exactly where the monthly fee doubles.

**Worth paying.** The failure it prevents is the entire roster locked out of the app during the incident that caused the message storm. But two things should be confirmed with the provider before committing, because sources conflict and both change the bill:

- Whether two Messaging Services can share a single campaign registration.
- Whether Low Volume Mixed explicitly permits one-time-passcode content.

## An app requirement, not paperwork

Carriers require documented **proof of opt-in** — how recipients consented, plus sample message templates per campaign. For Caballus that consent happens in the Coordinator-driven invite flow from ADR 0008, which means the app must **capture and store consent, and show the volunteer the opt-in language**. This is build work that the ADR did not anticipate; it is recorded there now.

---

# How this gets tested

## The blunt constraint

A trial account cannot register for 10DLC, and unregistered US A2P traffic is filtered _silently_ — no bounce, no error, just non-delivery. So before registration completes there is no configuration in which a successful send is evidence of anything. **Nothing in development may depend on a real message arriving.**

The corollary is a scheduling one: register early. It costs about $35 and $9/month to have the capability sitting ready, and campaign review is currently **10–15 days**, on top of 1–3 days for brand vetting. With one rejection and resubmission — likely, given the exact-legal-name trap — three to four weeks is the honest planning number.

## One seam, three senders

Better Auth's phone-number plugin takes a send function rather than owning delivery, so the seam already exists. Caballus defines one interface with three implementations, selected by environment:

| Implementation     | Used by                    | Behaviour                                                                                                                                                          |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LogSender`        | local development, staging | Writes the code to the structured log and a dev-only panel. No network, no cost, works offline                                                                     |
| `TwilioTestSender` | automated tests            | Real Twilio client against **test credentials** and the magic number `+15005550006`. Exercises the SDK and its error paths; never reaches a carrier; never charged |
| `TwilioSender`     | production only            | The real thing                                                                                                                                                     |

**No bypass code.** The development sender shows the _real_ generated code rather than accepting a fixed one — a fixed code is an extra credential to secure for no benefit. End-to-end tests read the pending code straight from Postgres, which the test suite already talks to per ADR 0007, so no test-only endpoint exists in the application.

**The selection fails closed.** A startup assertion refuses to boot if the environment is production and the sender is anything but `TwilioSender`, in the same posture as the other structural guards in ADR 0007. A dev sender silently active in production would mean every volunteer's login code printed to a log file.

## What gets tested where

- **The caps, the kill switch and the queue** — ADR 0004's daily ceiling, per-recipient rate limit and "over-cap messages queue and alert rather than drop" — are all logic, and they are tested against `LogSender` and pg-boss. Burning real messages to test a rate limiter is the wrong instinct.
- **The SDK boundary** — malformed numbers, provider errors, retry behaviour — is tested against Twilio's test credentials, which return real error codes without carrier involvement.
- **Delivery itself** cannot be tested before registration, and afterwards needs exactly one canary: a message to a real handset from production, confirmed by eye, recorded in the runbook next to the restore rehearsal.

## Staging does not send

Staging uses `LogSender`. A second registered campaign for a non-production environment would double the recurring cost to test a code path that the canary already covers once.

## Cost during development

Approximately zero. Test credentials are not billed, the development sender never leaves the process, and the only spend before go-live is the registration itself — which should be incurred early precisely because it is the part that cannot be rushed.

---

## Sources

- [Twilio A2P 10DLC](https://www.twilio.com/en-us/phone-numbers/a2p-10dlc)
- [Twilio: registration for government and nonprofit agencies](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-for-government-and-non-profit-agencies)
- [Twilio A2P 10DLC quickstart](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart)
- [Twilio.org Impact Access Program](https://www.twilio.org/en-us/support-and-resources/impact-access-program)
- [Twilio Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out)
- [Twilio test credentials and magic numbers](https://www.twilio.com/docs/iam/test-credentials)
- [Bandwidth: 10DLC campaign use cases](https://www.bandwidth.com/support/en/articles/12823087-10dlc-campaign-use-cases)
- [T-Mobile 2026 A2P pass-through fees](https://www.telgorithm.com/news/t-mobile-announces-new-2026-a2p-sms-pass-through-fees)
- [Twilio vs Plivo vs Telnyx, 2026](https://apiscout.dev/guides/twilio-vs-plivo-vs-telnyx-sms-voice-api-2026)
- [10DLC registration guide for nonprofits, 2026](https://www.fransis.ai/articles/10dlc-registration-guide-2026)
