# Better Auth swallows a rejection from `sendVerificationOTP`

Discovered while building #33, not read in a doc. The plugin's `sendVerificationOTP` callback is
invoked in a way that does not surface a rejection to the caller, so `requestCode` answered
`{ sent: true }` for mail that never left. The Better Auth docs point straight at the cause —
_"It is recommended to not await the email sending to avoid timing attacks"_ — which reads as
advice and behaves as a constraint.

The fix in `src/server/auth/sign-in.ts` is to mint through `api.createVerificationOTP` (which
returns the OTP) and send through Caballus' own `sendEmail`, where a rejection is a value the
function can return.

**Evidence:** reproduced against real Postgres with no transport configured; pinned by the test
_"tells the volunteer nothing is coming when the mail could not be sent"_.

**Implications:** this is the model case for the whole mission — a library default optimised for a
threat Caballus does not face (timing attacks on an intentionally-enumerable roster, ADR 0008),
which costs the thing Caballus does need. Future lessons should treat "what does this default
assume about my app" as a standing question. It is also the first thing worth taking to the Better
Auth community, since whether it is intended decides whether the workaround is permanent.
