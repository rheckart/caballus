---
status: accepted
extends: 0005 (what a repeat is answered with, and what a *different* request under the same key is answered with), 0007 (the index is total rather than partial, and where the record lives)
---

# A key is recorded with its answer, kept for thirty days, and a changed request under it is refused

ADR 0005 says the server "records that identifier with the effect and treats a repeat as success rather than as a new event". The skeleton (#22) built the half a type can hold — `mutation` does not compile without a key, parses it and logs it — and left the recording out, so a retry ran the handler twice. This decides the parts ADR 0005 and ADR 0007 leave open, all of which had to be settled before the first real mutation and none of which are cheap to settle after it.

## The record is a table of its own, and the constraint on it is total

ADR 0007 names the mechanism as "a partial unique index". That is the shape it takes when the key lives on the table the write created a row in — `unique (org_id, idempotency_key) where idempotency_key is not null` — and the same ADR gives the reason it cannot be the shape here: **ticking a checklist item and closing a shift create no row**, and those are the majority of a shift's writes. A key with nowhere to live needs somewhere to live. So `idempotency_keys` is org-scoped like every other table, and its primary key is `(org_id, idempotency_key)` — total, because every row in it is a key.

**The row is written inside the same `forOrg(...).run()` transaction as the work**, which is the guarantee and not an implementation detail: a key that outlived its rolled-back effect would turn every retry into a permanent silent failure — the write never happens and the phone is told it did. The claim is made *before* the work rather than after, so that two attempts in flight at once serialise on the primary key instead of racing; the second blocks until the first commits or rolls back, and then sees the truth.

**This lives in the `mutation` wrapper, which opens the transaction and hands the handler the scoped handle.** ADR 0016 rejects an invariant every future handler has to remember, and *remember to record your key* is precisely that. A handler receives `db` already inside the transaction that holds its key; there is no arrangement of a handler that opts out.

## A repeat gets the first response; a *different* request under the same key gets a 409

Neither ADR settled this, and the two cases are not the same fact. A repeat is ADR 0005 working as designed — the response was lost on the way back — and it is answered with the stored status and body, with a `mutation_answered` line saying `outcome: replayed`.

The same key carrying a **different** request is a client bug or a collision, and the one answer it must not get is the first response: that would report success for a write nothing recorded, which is the same confident lie as the double-log, told in the other direction. So the key is stored beside a **digest of the request it first arrived with** — route and parsed body, canonicalised so that key order and reserialisation do not read as a change — and a mismatch is refused with **409**, which every client already reads as *stop retrying, this will not become true*.

A digest rather than the payload, because a queued write carries volunteer names and observations and this table's only job is bookkeeping — the same argument ADR 0007 makes about what reaches Sentry.

**A 4xx answer from a handler is recorded like any other.** It is a deliberate answer, and replaying it is correct: the retry gets the same rejection instead of a second attempt at something the server already refused. A handler that wants nothing recorded **throws**, and the transaction takes the key with it — which is also the only way a handler should produce a 5xx, since `onError` is the 500 path in this application. A handler that *returns* a 5xx instead of throwing would have it recorded, and every retry would replay it forever. The wrapper does not second-guess that: a rule that quietly discards a handler's own response is worse than a convention the one door already follows.

## Keys are kept for thirty days

ADR 0005 notes that iOS has no Background Sync API, so a queue drains only when somebody opens the app. A volunteer who works Thursday and does not open their phone until the following weekend is ordinary, and the queue is durable in IndexedDB across all of it. Retention has to clear that by a margin.

**Thirty days.** Comfortably past any queue on a phone that still has the app installed, and short enough that the table is bounded: at sixty volunteers a busy shift is a few hundred writes, so a month is tens of thousands of narrow rows. The failure at the far end is real and is stated rather than smoothed over — **a key replayed after expiry is recorded a second time**, which is the double-log this whole mechanism exists to prevent. Thirty days buys a margin; it does not remove the edge. Shortening it is the change that needs an argument.

**The sweep is not scheduled yet, and that is deliberate.** ADR 0007 puts durable background work on pg-boss, and an in-process interval is the thing that ADR explicitly says is not durable. `forgetKeysPastRetention` exists, is tested, and is idempotent — a missed run costs nothing but a slightly larger table — and it joins the job runner with the overdue-alert derivation and the days-of-supply checks. Until then the table grows at the rate of writes, which at this size is not a problem anyone will notice.

## What would make this wrong

**The digest is computed over the parsed body, not the bytes.** Fields the schema strips do not change it. That is the behaviour a retrying client needs, and it means a client sending a genuinely different *unknown* field under a repeated key gets the first response. When a schema change makes an ignored field meaningful, it becomes part of the digest by becoming part of the schema — which is the right coupling, but it is a coupling.

**Nothing yet bounds the size of a stored response.** Every mutation today answers with small JSON and ADR 0007 keeps blobs out of this path entirely, so the column is text and unbounded. A future endpoint answering with something large would put it in this table twice over — once in the answer and once in every replay's memory.

**The 409 tells a volunteer nothing useful.** It is the right answer to a client bug and the wrong thing to show a person in a barn, so the client has to turn it into "this didn't send, and retrying won't fix it" rather than surfacing the code. That is a client concern and it is not built yet.
