---
status: accepted
amends: 0009 (SMS returns for notifications), 0018 (an Announcement may be sent), 0006 (the ownership question, deferred rather than closed)
---

# The urgent channel returns as SMS, and it carries exactly two cases

ADR 0009 dropped SMS outright and wrote down what would bring it back: _"a volunteer who cannot be onboarded because they have no usable email"_, the whiteboard tripwire, or #11 being genuinely needed. The rescue has now said the thing that fires the first of those in a different key — **the volunteers least likely to adopt a new tool are the ones the app most needs to reach**, and email is not reaching them. Facebook is not either; it is where information goes to scroll away.

So SMS returns, and it returns for **notifications only**. Login is settled separately in ADR 0029, and the two must not be conflated again: ADR 0009 was right that ADR 0008's real mistake was putting the ability to log in behind a carrier queue.

# Two cases, named, and nothing else ever

An Urgent Send carries a **Shift declared Short** and an **Announcement whose news will not keep**. That is the whole list.

The temptation is to move the evening digest, or Escalations, or a Drop. Every one of those is refused, on ADR 0004's own rule: _never both channels for the same event_. A channel that carries everything means nothing, which is precisely how the Facebook group failed. Email keeps the digest, the Escalations, the sign-in codes and everything else.

**A real emergency is still a phone call.** ADR 0010 says so and ADR 0014 refuses a priority field on the strength of it. A colicking horse was proposed for this list and is deliberately not on it: the failure mode is a volunteer typing into the app, feeling finished, and not dialling. What the app does about colic is what it already did — the record afterwards, and a standing Alert on the horse (ADR 0024).

# It is a send, not a noun

There is no Message, no Broadcast and no Notification entity. The two cases are records the app already holds: `shifts`' Short columns, and an `announcements` row. The Urgent Send is a **second, deliberate act** on an existing record — a checkbox at the moment of declaring Short or posting an Announcement — and it stores who sent it and when, and nothing else.

This is what keeps the model from growing a fifth way to say something. It also means **nothing is ever said in a text that is not already written somewhere it will still be true tomorrow**, which is the property the group chat never had.

**This amends ADR 0018**, which says of an Announcement that _"the app sends nothing about it"_ and declares both its writes `neverQueued`. The wall is still a wall — posting still sends nothing. What changes is that a second act may put one in front of people, and the `neverQueued` rule is untouched: an Urgent Send is the app as medium, not as ledger, exactly as ADR 0018 restates ADR 0005.

**Caballus carries no message between two people.** Volunteers texting each other about a swap continues on their own phones, forever. What the app carries is a fact about the barn; the moment it carries a conversation it owns moderation, history and a second inbox nobody reads.

# Nobody is told twice, and there are no read receipts

The reply is the receipt. _We are short tonight_ is answered by somebody tapping Cover, which is already a record with a name on it. If nobody covers, nobody saw it — the same information, with no per-person read state, no badge and no watching.

# Sent.dm's automated registration does not change the shape of the problem

It was investigated on the rescue's suggestion. **Sent.dm** is one API over SMS, WhatsApp and RCS at $0.015 per contact per month plus carrier pass-through — about ninety cents a month at sixty volunteers — and it advertises automated 10DLC registration. Its own registration guide gives brand registration at 2–5 business days and campaign approval at 1–4 weeks, which is the industry number and not "a day". **Automation removes the form-filling, not the carrier's queue.**

That is worth knowing because it relocates the blocker. The blocker was never the fortnight; it was **a tax record and an account somebody has to own** — The Campaign Registry's rule, which no vendor can route around, and which from January 2026 applies to toll-free numbers too.

# The vendor is Twilio, and the reason is not price

Sent.dm is cheaper on the platform fee and would be the pick if this were only about notifications. It is not, because ADR 0029 puts login codes through **Verify**, which is Twilio's own service. Choosing sent.dm for the campaign means **two vendors, two accounts, two bills and two SDKs** for a solo maintainer, to save a few dollars a month.

The vendor is behind one module either way — `src/server/sms.ts`, the shape `src/server/email.ts` already holds — so being wrong about this costs a day rather than a redesign, which is why it is a paragraph here and not an ADR of its own. Twilio's test credentials and magic numbers are also already the documented development path in `docs/research/sms-providers.md`, and Twilio.org's Impact Access Program gives a verified 501(c)(3) a 25% discount for the day the tripwire below fires.

# Registered as a person, and the tripwire is written here so it is not forgotten

The **Sole Proprietor** brand needs no EIN. It wants a legal name matching government ID, a mobile that receives a PIN within 24 hours, a physical address and a public URL. It costs roughly **$4 one-time, $15 campaign vetting and $2/month**, plus a number and messages — call it four dollars a month — and approves in **3–7 business days**. It is capped at **one campaign, one number, ~1,000 messages a day**.

That cap used to be disqualifying, because ADR 0008 needed two campaigns — one for login, one for notifications — and the second one is where the bill doubled. **Login lives on email and on Verify, so only one campaign was ever needed.** The constraint and the design now agree.

So the brand is registered to **the maintainer personally**, and this is a deliberate deferral of ADR 0006's ownership question rather than an answer to it. The consequence is real: the opt-in consent is legally the maintainer's, and if he steps away the channel goes with him.

> **The tripwire.** The day this stops being a proof of concept and real volunteers depend on being texted, the rescue registers its own brand against its own EIN. It costs about $15 and a few days. **The number changes when it does**, so volunteers who saved the contact will see a new one — annoying, survivable, and cheaper than a board conversation blocking the build today.

## Considered options

**Waiting for the rescue's EIN and a board conversation** was the correct-looking answer and was rejected on ADR 0009's own reasoning about lead times: it puts a human approval queue in front of a proof of concept whose user base is the maintainer and an officer or two.

**Web push** was rejected on the exact fact that motivated the ticket. On iOS it requires the volunteer to add the app to the home screen and grant a permission — asked of the people who will not reliably adopt a new tool. SMS asks them to do nothing at all.

**Slack, GroupMe or Discord** was rejected for the same reason plus one more: an off-the-shelf chat is another silo with no link to a horse or a Shift, and it scrolls away exactly as Facebook does. The one thing Caballus can do that chat cannot is attach a sentence to a horse and keep it.

## Consequences

**Opt-in becomes build work, not paperwork.** Carriers require documented consent. It is captured in the Coordinator's invite flow as **SMS Consent**, stored with a timestamp, and STOP is honoured. ADR 0009 already said the record was worth collecting at invite for free; it is now load-bearing.

**A gap must be visible before the send, not after.** Whoever is about to send sees _this reaches 47 of 60_. A sender who believes they told everyone and did not is the failure being fixed, reproduced.

**A failed send is loud.** `src/server/sms.ts` is the one door out, in the shape `src/server/email.ts` already holds: an injectable transport, a kill switch when configuration is missing, a daily cap set at **120** — two full sends to sixty people, well clear of normal and well under the carrier's thousand. A swallowed failure here is a Shift nobody knew was short.

**Nothing in development sends a real message.** Twilio test credentials and magic numbers charge nothing and reach no carrier; the fake transport is the same seam `setEmailTransport` already is. Registration is paperwork running in parallel and is never a blocker on the code.

**`caballus.tech` needs a public page.** Vetting wants to see what the messages are and how people consented; a login screen shows neither. One designed landing page describing the app, what it texts, and how a volunteer opts in and stops — a genuine requirement, not decoration.

**The Facebook group is not retired, it is relegated.** The success test the rescue named is that nobody posts about a horse or a shift there for a month, leaving it to cute pictures. ADR 0009 put the group formally in service for urgent broadcast; this ADR takes that job off it, and the horse Timeline takes the other one.
