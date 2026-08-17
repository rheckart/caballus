---
status: accepted
extends: 0016 (the premise under the `/api/` path ban is made true; a sixth entry joins *What becomes a type*, the fourth of them held in `route.ts`), 0007 (wire shapes are hand-written Zod, and this is where they are written), 0005 (the idempotency key is added by the layer rather than declared per endpoint)
---

# The API is one contract of hand-written Zod, and both sides read it

ADR 0016 bans `/api/` path literals on a stated premise: _with a typed client nobody has a reason to write the path_. The skeleton (#22) landed the ban and a client, but not the typing — `apiGet<T>` ended in `body as T`, and `ApiPath` was a second copy of `RoutePath`, both `` `/${string}` `` (#26). So the client would take a path no route served and assert whatever shape the caller named. With one endpoint that costs nothing; the day a volunteer's tick goes to a path nobody registered, it costs the tick.

## One module declares the endpoints, and it is neither side's

`src/shared/api-contract.ts` holds every path with the Zod schema of what it answers, and every write with the schema of what it accepts. The server registers against it and the client calls against it. Neither one owns it, and there is no second copy to drift:

- **A path the contract does not declare does not compile** — on the phone and in registration alike. A wrong path is a type error rather than a 404 at 6am.
- **A handler answers the shape the contract promised.** `json` carries what is in it in its type, so `route`'s handler is held to `answers`, and a read that returns something else is a build failure rather than a screen with holes in it.
- **The client parses rather than asserts.** The schema is the type _and_ the check: `as T` is a promise about the wire made by whoever wrote the call site, and the wire is the one place in this system where the two ends were built at different times (ADR 0007). An answer that does not match is an `UnreadableAnswerError` — a distinct class, because the queue has to know that retrying cannot fix it.
- **`RoutePath` is defined once**, here, and imported by both.
- **A path declared and never registered does not start.** `api.sealed()` runs after registration in `app.ts` and throws naming every endpoint the contract promises and nothing serves. The type closes one direction; a container that refuses to boot closes the other, and both beat a 404 at 6am.

**Hand-written Zod, not generated from the tables** (ADR 0007). A wire shape and a column are different things that happen to agree today; the schema is what the phone was promised, and it should change when somebody decides it changes rather than when a migration runs.

## A write declares its payload, and never its idempotency key

`mutation` takes no schema argument. It builds one from the contract's `accepts` and adds the key itself (ADR 0005). Two things follow, and both are the ADR 0016 move:

- The payload is stated **once**, so the schema the phone is typed against is the schema the server parses with. A second declaration is how a client sends `note` to a server that wants `text`, and the failure lands on a volunteer.
- A keyless write is no longer something to catch — it is not something anybody can write. This **replaces** ADR 0016's second type invariant, which was _the schema you pass must extend a key base_: a rule about an argument that no longer exists is strictly weaker than removing the argument.

## The queue replays through the same call

`post` mints a key when it is not given one and uses the one it is given otherwise, and that is the only door. A replay is the same function with the key the queue kept, so the body it sends is built by the same code that built the first attempt — which matters more since #28: the server fingerprints the request, and a second builder that spells the body differently turns a replay into a 409 that no amount of retrying will clear.

## What would make this wrong

**Parameterised paths are declared but not built.** `/horses/:horseId/observations` is a legal contract key and the client would make the caller write the literal `:horseId`, which is nonsense. The first parameterised endpoint has to take its params as an argument and interpolate them — the type work is small and it is deliberately not done ahead of an endpoint that needs it.

**The client now carries Zod.** The schemas are in the bundle because the parse happens on the phone. That is the cost of not asserting, and it is paid on the device with the worst connection.

**A test binds its own contract.** `createApi` and `createClient` are generic over it, so a test's fixtures do not go in the real one. The risk is a test that proves something about a contract nobody serves; the alternative — fixtures in the application's contract — is an endpoint that exists for the tests, which is the drift this ADR removes.

**A contract annotated rather than satisfied loses the narrowing.** `Contract`'s maps are keyed by `` `/${string}` ``, so `const c: Contract = {…}` hands the client back every path in the world. Every contract in the repo is written `as const satisfies Contract`, which keeps the literal keys; the annotated form is a footgun rather than a hole, and both sides answer it at runtime with _no endpoint is declared at …_ rather than a `TypeError` about `undefined`.

**A refusal at 200 is not typed.** A handler may answer `{ error }` for any status, because `json` cannot see that a `Failure` belongs with a 4xx. One sent with a 200 would be parsed against the endpoint's `answers`, fail, and reach the phone as an `UnreadableAnswerError` — loud and wrong-shaped rather than silent, which is the acceptable half of a bad trade.
