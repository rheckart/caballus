---
status: accepted, notification channel superseded by 0009
---

# The client is an installable PWA, and notifications go out over SMS

> **Superseded in part by ADR 0009.** V1 sends no SMS; email carries everything and the rescue keeps its Facebook group for urgent broadcast. The platform decision below is unaffected — its own tripwire fires only as far as reopening the *notification* question, and with v1 doing no push at all, every argument here for the PWA still holds. Read the SMS specifics as the costed plan for when the channel returns.

Volunteers open **one responsive web app** in whatever browser they already have. It is installable to the home screen, but installing is optional and buys only an icon and a cached shell — never functionality. Messages that must reach people reach them by **SMS**, not push.

There is **no web push in v1**: no permission prompt, no subscription table, no second delivery path. The service worker exists to precache the app shell so the app opens on a bad bar of signal, and for nothing else.

## Considered options

**Native (Expo / React Native)** was rejected on two independent grounds. There is no Mac in the building, and renting a cloud one costs more per month than a rescue on a tight budget should spend on build infrastructure. Beyond that, an app store is a permanent tax on a solo maintainer: a review queue between him and every native-layer change, and volunteers running a stale install of the checklist until they update.

**Plain responsive web** — no service worker, no install — was rejected narrowly. The service worker's shell cache is the difference between the app opening at 6am on one bar and the browser showing an error page, and the bar this app has to clear is a clipboard.

**Installable PWA with web push** was the shape the question started in, and the interesting part is why it lost. Web push on iOS is delivered **only** to a site the user has added to the home screen — no install, no push, ever — and iOS offers no programmatic install prompt, so every iPhone volunteer would need walking through Share → Add to Home Screen before they could be reached at all. On a roster skewing toward iPhone that is not an onboarding detail; it is the whole notification story resting on a step most people will not complete.

## Consequences

**The notification question dissolved the platform question.** Native-versus-web was, underneath, an argument about whether messages reach people. Once SMS carries them, both platforms reach everyone equally and native's remaining advantages do not pay for its costs. This is the load-bearing move in the decision; anything that later makes SMS untenable reopens the platform choice with it.

**What we gave up, stated plainly.** No badge counts, no read receipts, no rich notifications, no presence in an app store, and a per-message bill. US A2P SMS also requires 10DLC brand and campaign registration before carriers deliver reliably — days of approval that can ambush a launch date, and unregistered traffic gets silently filtered rather than bounced. If a store listing is ever wanted, a Capacitor or PWABuilder wrap is the exit, and it needs the Apple account and review queue declined here.

**Messages are split by urgency with no overlap.** SMS for anything time-bound to a shift; email for everything else; never both for the same event. That is what keeps an SMS meaning *something needs you now* — the property the Facebook group lost by carrying everything.

**A mobile number is load-bearing.** It is mandatory at account creation, and a reachable number is a precondition for holding a Lead or head role, enforced when the role is assigned. Opting out is honoured and legally must be, but it makes a person **visibly** unreachable in the roster rather than silently so.

**Outbound SMS has a hard ceiling.** A daily cap with a server-side kill switch and a per-recipient rate limit, because every blast costs real money and a roster texted three times an evening learns to ignore the app. Over-cap messages queue and alert rather than drop — a swallowed short-staffing call is the same fabricated-completion failure the map forbids everywhere else.

**Three layouts, one codebase, one deployment.** A phone work surface; a tablet **Board** running as a kiosk on a rescue-owned device with a device-scoped read-only token, polling every 30–60 seconds, unable to record anything and therefore crediting no actor; and desktop admin screens for roster assignment and report triage, designed at width first and reflowed down. A separate admin app is the thing a solo maintainer regrets.

**Sessions are effectively permanent** — a long-lived refresh token, no re-auth per shift, no idle timeout, because a password prompt at 6am in gloves is where the clipboard wins. Revocation by the Volunteer Coordinator is the control instead of expiry, which makes **server-side session revocation mandatory** for whatever identity provider is chosen.

**The floor degrades, it never walls.** iOS 16.4+ and evergreen Chrome get the service worker and the full experience; anything older gets a plain responsive web app that still works. A volunteer standing in a barn being told their phone is unsupported is the moment the app loses.

**Links from an SMS open into login, then continue to their destination.** No content before auth — those links get forwarded into group chats — and nothing important may depend on the recipient having installed, because the messages app opens whatever browser it likes.
