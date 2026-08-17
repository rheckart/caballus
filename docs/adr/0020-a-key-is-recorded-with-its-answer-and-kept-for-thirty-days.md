---
status: accepted
extends: 0005 (what a repeat is answered with, and what a *different* request under the same key is answered with), 0007 (the index is total rather than partial, and where the record lives)
amended-by: #28, on what "route" means in the digest — the path that was sent, decoded, with its query, and never the pattern that matched it; #30, on what a write may answer with, so that a replay is the first answer rather than its shape
---

# A key is recorded with its answer, kept for thirty days, and a changed request under it is refused

> **Amended on what a write may answer with (#30).** Only a stored answer's status and body are kept, and the rest of it was rebuilt as `application/json` on the strength of a comment saying `json` is the only builder — which the 204 in the wrapper's own tests already disproved. A replay was therefore a JSON-shaped approximation of the first answer rather than the first answer. The claim is a type now: a mutation handler returns an `ApiResponse`, and only `src/server/api/answer.ts` makes one — `json` and `noContent` for a handler, `rebuild` for a stored answer, which is the same function answering the first attempt and the replay. See *A repeat gets the first response* below.
>
> **Amended on what the digest's "route" is (#28).** It was built from the *registered pattern*, which is one string for every horse in the barn — so a key spent on `/horses/alfie/observations` and then on `/horses/bramble/observations` digested identically, and the second was answered 201 with alfie's response while nothing recorded it. Latent only because `/day` takes no parameters, and every mutation this domain needs is parameterised. The concrete path is what is digested, stored and logged now; the section below says so and says what became of the query string.

ADR 0005 says the server "records that identifier with the effect and treats a repeat as success rather than as a new event". The skeleton (#22) built the half a type can hold — `mutation` does not compile without a key, parses it and logs it — and left the recording out, so a retry ran the handler twice. This decides the parts ADR 0005 and ADR 0007 leave open, all of which had to be settled before the first real mutation and none of which are cheap to settle after it.

## The record is a table of its own, and the constraint on it is total

ADR 0007 names the mechanism as "a partial unique index". That is the shape it takes when the key lives on the table the write created a row in — `unique (org_id, idempotency_key) where idempotency_key is not null` — and the same ADR gives the reason it cannot be the shape here: **ticking a checklist item and closing a shift create no row**, and those are the majority of a shift's writes. A key with nowhere to live needs somewhere to live. So `idempotency_keys` is org-scoped like every other table, and its primary key is `(org_id, idempotency_key)` — total, because every row in it is a key.

**The row is written inside the same `forOrg(...).run()` transaction as the work**, which is the guarantee and not an implementation detail: a key that outlived its rolled-back effect would turn every retry into a permanent silent failure — the write never happens and the phone is told it did. The claim is made *before* the work rather than after, so that two attempts in flight at once serialise on the primary key instead of racing; the second blocks until the first commits or rolls back, and then sees the truth.

**This lives in the `mutation` wrapper, which opens the transaction and hands the handler the scoped handle.** ADR 0016 rejects an invariant every future handler has to remember, and *remember to record your key* is precisely that. A handler receives `db` already inside the transaction that holds its key; there is no arrangement of a handler that opts out.

## A repeat gets the first response; a *different* request under the same key gets a 409

Neither ADR settled this, and the two cases are not the same fact. A repeat is ADR 0005 working as designed — the response was lost on the way back — and it is answered with the stored status and body, with a `mutation_answered` line saying `outcome: replayed`.

The same key carrying a **different** request is a client bug or a collision, and the one answer it must not get is the first response: that would report success for a write nothing recorded, which is the same confident lie as the double-log, told in the other direction. So the key is stored beside a **digest of the request it first arrived with** — route and parsed body, canonicalised so that key order and reserialisation do not read as a change — and a mismatch is refused with **409**, which every client already reads as *stop retrying, this will not become true*.

A digest rather than the payload, because a queued write carries volunteer names and observations and this table's only job is bookkeeping — the same argument ADR 0007 makes about what reaches Sentry.

### The first answer, and not something the same shape (#30)

*The first response* has to mean the response, headers included. Only the status and the body are stored, so the rest of it must be a **function of those two** — and that was asserted in a comment rather than held anywhere, so a handler returning a bare 204 got its replay back announcing `application/json`. A `Location`, an `ETag`, a `Retry-After` would have been dropped outright. The first attempt gets the truth and the retry gets something else, and the retry is the attempt that happens from a pocket on Thursday.

**A mutation handler may only answer with what this layer builds** — `json` for an answer with a body, `noContent` for one without — and that is a type, in ADR 0016's sense: `MutationHandler` returns an `ApiResponse`, which only `src/server/api/answer.ts` produces. The content type is then genuinely derivable (a body is JSON; an empty answer claims no type at all), and the store keeps a **status and a body** rather than a response, so `mutation` builds the first attempt's answer and the replay through one call to `rebuild` and the two cannot disagree.

`rebuild` is the third thing in that module and is not a handler's door: it takes what was stored, and a handler importing it to answer with something that is not JSON would be labelling it `application/json` deliberately. That is a person's decision to make badly, not a hole the type leaves open.

A read is left unconstrained. It is answered once and never replayed, and nothing about it is claiming to be reproducible.

The cost is named rather than smoothed over: **an endpoint that needs another header has to add a builder**, and adding one means deciding how it replays — which is the question that went unasked here. Storing the headers instead was the alternative, and it buys freedom this application has no use for at the price of a wider bookkeeping table and a handler's stray header outliving the request.

### The route in the digest is the path that was sent, and it includes the query

"Route" was first read as the registered pattern, which is the same string for every horse in the barn (#28). One key spent on `/horses/alfie/observations` and then on `/horses/bramble/observations` digested identically, so the second was answered **201 with alfie's response** and nothing recorded bramble's observation — the confident lie this digest exists to prevent, told by the mechanism meant to prevent it. It was latent only because `/day` takes no parameters, and every mutation this domain needs is parameterised: a tick belongs to a shift, an observation belongs to a horse.

So the **concrete path** goes into the digest, and is what is stored and logged as `route`. A collision that names `:horseId` cannot tell a person which horse it was about, and which horse is the reason they are reading the line.

**The path is canonicalised the way the body is.** The body half of this digest is the *parsed* body precisely so that reserialisation is not read as a change, and the path half may not be held to a looser standard: `/horses/al%66ie` and `/horses/alfie` reach one handler with one `horseId`, so they are one request. The path is digested as its **decoded segments** — a list rather than a joined string, so a segment containing a slash cannot spell itself as two — and the query as its **sorted pairs**. A retry that re-encodes on its way out of the queue must drain, not collect a permanent 409 (ADR 0005).

**The query string is part of the request for digest purposes.** No mutation carries one — the typed client puts a write's arguments in the body — and the decision is made here rather than left to the endpoint that first does. Ignoring it would rebuild the same collision one layer down; counting it means a client that genuinely varies a query between attempts is refused with a 409, which is loud, honest, and not a shape this API has.

**It is dropped again on the way to the table and the log.** A path segment is an id this application minted; a query is free text somebody else wrote, and this table holds digests rather than payloads for exactly that reason. The query reaches the digest, which is one-way, and stops there.

**A 4xx answer from a handler is recorded like any other.** It is a deliberate answer, and replaying it is correct: the retry gets the same rejection instead of a second attempt at something the server already refused. A handler that wants nothing recorded **throws**, and the transaction takes the key with it — which is also the only way a handler should produce a 5xx, since `onError` is the 500 path in this application. A handler that *returns* a 5xx instead of throwing would have it recorded, and every retry would replay it forever. The wrapper does not second-guess that: a rule that quietly discards a handler's own response is worse than a convention the one door already follows.

## Keys are kept for thirty days

ADR 0005 notes that iOS has no Background Sync API, so a queue drains only when somebody opens the app. A volunteer who works Thursday and does not open their phone until the following weekend is ordinary, and the queue is durable in IndexedDB across all of it. Retention has to clear that by a margin.

**Thirty days.** Comfortably past any queue on a phone that still has the app installed, and short enough that the table is bounded: at sixty volunteers a busy shift is a few hundred writes, so a month is tens of thousands of narrow rows. The failure at the far end is real and is stated rather than smoothed over — **a key replayed after expiry is recorded a second time**, which is the double-log this whole mechanism exists to prevent. Thirty days buys a margin; it does not remove the edge. Shortening it is the change that needs an argument.

**The sweep is not scheduled yet, and that is deliberate.** ADR 0007 puts durable background work on pg-boss, and an in-process interval is the thing that ADR explicitly says is not durable. `forgetKeysPastRetention` exists, is tested, and is idempotent — a missed run costs nothing but a slightly larger table — and it joins the job runner with the overdue-alert derivation and the days-of-supply checks. Until then the table grows at the rate of writes, which at this size is not a problem anyone will notice.

## What would make this wrong

**The digest is computed over the parsed body, not the bytes.** Fields the schema strips do not change it. That is the behaviour a retrying client needs, and it means a client sending a genuinely different *unknown* field under a repeated key gets the first response. When a schema change makes an ignored field meaningful, it becomes part of the digest by becoming part of the schema — which is the right coupling, but it is a coupling.

**A collision that differs only in the query says nothing on the log.** `route` and `firstRoute` are the same string, and what actually differed lives only in a digest nobody can read backwards — the shape of complaint #28 made about the pattern, one level down. It is accepted because no mutation carries a query today; the endpoint that first does should expect to put what it needs on the line itself.

**Nothing yet bounds the size of a stored response.** Every mutation today answers with small JSON and ADR 0007 keeps blobs out of this path entirely, so the column is text and unbounded. A future endpoint answering with something large would put it in this table twice over — once in the answer and once in every replay's memory.

**The 409 tells a volunteer nothing useful.** It is the right answer to a client bug and the wrong thing to show a person in a barn, so the client has to turn it into "this didn't send, and retrying won't fix it" rather than surfacing the code. That is a client concern and it is not built yet.
