# Email as Caballus' credential channel — Resources

## Knowledge

- [Better Auth — Email OTP plugin](https://www.better-auth.com/docs/plugins/email-otp)
  The plugin Caballus signs in with. Use for: `sendVerificationOTP`'s signature, and the options table (`otpLength`, `expiresIn`, `allowedAttempts`, `storeOTP`, `disableSignUp`). Note the line _"It is recommended to not await the email sending to avoid timing attacks"_ — that recommendation is why `requestCode` had to stop using this callback.

- [Better Auth — Sessions](https://www.better-auth.com/docs/concepts/session-management)
  Use for: `expiresIn`, `updateAge`, and the cookie cache. Caballus keeps the cookie cache **off** deliberately, so read this when tempted to turn it on.

- [Mailpit documentation](https://mailpit.axllent.org/docs/)
  The local SMTP catcher in `docker-compose.yml`. Use for: the REST API (`/api/v1/messages`), and the `MP_SMTP_AUTH_*` variables that stop it demanding credentials.

- [Nodemailer — SMTP transport](https://nodemailer.com/smtp/)
  How `SMTP_URL` becomes a connection. Use for: the `smtp://` vs `smtps://` schemes, and why port 465 is `secure: true` while 587 starts plain and upgrades.

- [Fastmail — Server names and ports](https://www.fastmail.help/hc/en-us/articles/1500000278342-Server-names-and-ports)
  The POC's sender (ADR 0009). Use for: `smtp.fastmail.com`, port 465, and the rule that an **app password** is required — the account password will not authenticate.

- [Resend — Send with Nodemailer SMTP](https://resend.com/docs/send-with-nodemailer-smtp)
  The go-live exit ADR 0009 names. Use for: host `smtp.resend.com`, port 465, username the literal string `resend`, password an API key — and that a **verified domain** is required before anything sends.

- [RFC 6265bis — Cookie lifetime limits](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis#section-5.5)
  Why "permanent sessions" is not a thing a browser will do: `Max-Age` is capped at 400 days. Use for: the session-lifetime argument in `src/server/auth/auth.ts`.

## Wisdom (Communities)

- [Better Auth GitHub Discussions](https://github.com/better-auth/better-auth/discussions)
  Where the maintainers answer. Use for: checking whether a rough edge is a bug or intended before working around it — the swallowed-send behaviour is exactly the kind of thing worth asking about here.

- [Better Auth Discord](https://discord.gg/better-auth)
  Faster, lower-signal than Discussions. Use for: "is anyone else seeing this" on a version-specific problem.

> Not yet raised with either community. The swallowed `sendVerificationOTP` rejection (see
> [LR-0002](./learning-records/0002-better-auth-swallows-the-send-failure.md)) is the first thing worth
> posting: it is reproducible, it has a workaround, and confirming whether it is intended would tell us
> whether the workaround is permanent.

## Gaps

- **No trusted source yet on where a refreshed session cookie should be applied** in a TanStack Start app whose API layer deliberately cannot carry response headers. This is the open question behind the once-a-year sign-in noted in `src/server/auth/auth.ts`.
- **Nothing yet on Fastmail's actual sending limits** for an app password at this volume. ADR 0009 says "comfortably inside" them; that number has not been checked against a source.
