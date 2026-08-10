---
status: accepted
---

# Every write carries a client-minted idempotency key

Every mutating request generates an identifier **on the phone**, before the request is sent, and carries it to the server. The server records that identifier with the effect and treats a repeat as success rather than as a new event. This is a rule of the data layer and applies to every endpoint, not a convention applied where it seems useful.

## Why it is not optional

The client queues writes and retries them, because connectivity at the barn is fine until it isn't. A retry is indistinguishable, from the phone's side, between *the request never arrived* and *the request arrived and the response was lost on the way back*. Without a key, the second case double-records — and **"I fed Apollo" logged twice is worse than logged zero times**, because the second is visibly missing and the first is a confident lie. The retry queue is the feature; this is the thing that makes it safe rather than dangerous.

## Consequences

**A tick is a claim by an actor, not a boolean being flipped.** The key makes this fall out naturally: two volunteers ticking the same checklist item is not a write conflict to be resolved, it is either the same claim arriving twice or two people recording that they did something. Nothing needs last-write-wins.

**The client shows per-item pending state, not an aggregate count.** A shift is dozens of small ticks, and "2 unsent" does not tell a Lead *which* two are at risk. Unsent work is visible on the item it belongs to, the volunteer is warned before closing with work outstanding, and **unsent items block shift close** — inventing a clean record is exactly the lie the paper system already tells.

**iOS caps how good this can get.** WebKit has no Background Sync API, so a queue drains only while the page is open; nothing flushes after a volunteer walks away. The queue is durable in IndexedDB and drains on next open, and the interface says so rather than implying a delivery guarantee it does not have.

**The key is minted before the first attempt, not per attempt** — mint it at retry time and every retry looks like a new event, which is the bug this exists to prevent.
