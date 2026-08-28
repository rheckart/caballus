# What `.env` on the box is rendered from, by `render-env.sh`, at deploy time.
# ADR 0006: 1Password is the source of truth for secrets and is never in the
# startup path — a service account renders a real file here, and the container
# then starts from a plain file with no network dependency of its own.
#
# The split is one rule. **The repository decides what is in this file as a
# literal; 1Password holds what only the deployment knows.** A URL this project
# chose is a literal. A password, a token, and an id minted on the box by
# `bootstrap` are references, because they cannot be read off a checkout and a
# box rebuilt from scratch has to get them from somewhere.
#
# Every reference below must exist in the vault before the first render:
# `op inject` fails on one it cannot resolve, and `render-env.sh` fails with it,
# before anything is pulled or swapped. `docs/deploy.md` lists them.
#
# Nothing in this file may write the reference scheme outside a moustache, not
# even inside a comment. `op inject` scans the whole file for it rather than
# only the braces, so a comment mentioning the bare scheme is parsed as a
# reference with no vault, item or field, and the render fails on it. That is
# why the sentence above says "reference" instead of showing one.

# --- Postgres -------------------------------------------------------------
# The owner, which migrations connect as, and the non-superuser the application
# connects as so that the row-level security policies of ADR 0007 apply to it.
# The host is the compose service, not localhost: nothing publishes a port.
POSTGRES_PASSWORD={{ op://Caballus/postgres/password }}
DATABASE_URL=postgres://caballus_app:{{ op://Caballus/postgres/app-password }}@postgres:5432/caballus
ADMIN_DATABASE_URL=postgres://caballus:{{ op://Caballus/postgres/password }}@postgres:5432/caballus

# --- The organisation -----------------------------------------------------
# Minted by `npm run bootstrap` on the box, so 1Password holds it: a rebuild
# must restore the id the existing rows are scoped to rather than mint a
# second one that sees none of them.
APP_ORG_ID={{ op://Caballus/app/org-id }}

# --- Identity -------------------------------------------------------------
# ADR 0006: this key must survive a restore. Rotating it signs out every
# volunteer at once, and ADR 0004 made sessions effectively permanent so that
# never happens.
BETTER_AUTH_SECRET={{ op://Caballus/app/better-auth-secret }}
APP_URL=https://caballus.tech

# --- The barn tablet (ADR 0022) -------------------------------------------
BOARD_TOKEN={{ op://Caballus/app/board-token }}

# --- Where the barn is (ADR 0015) -----------------------------------------
# Not a secret, and still a reference: the repository does not know where this
# rescue's barn is, and unset fails closed rather than guessing at a forecast.
BARN_LATITUDE={{ op://Caballus/app/barn-latitude }}
BARN_LONGITUDE={{ op://Caballus/app/barn-longitude }}

# --- Outgoing mail (ADR 0009) ---------------------------------------------
# An emailed code is the only credential there is, so an unset transport is a
# volunteer who cannot sign in at all.
SMTP_URL={{ op://Caballus/smtp/url }}
EMAIL_FROM=Caballus <caballus@heckart.me>

# --- Texting (ADR 0028, ADR 0029) -----------------------------------------
# Two Twilio products behind one account, and the separation is load-bearing.
# `TWILIO_FROM_NUMBER` is the 10DLC messaging campaign, which carries the Urgent
# Send and nothing else. The two Verify Services carry sign-in codes, outside
# A2P registration entirely — which is what keeps a STOP on the notifications,
# or a tripped kill switch, from locking the roster out of the application.
#
# Two Verify Services rather than one: sign-in and `/me/mobile`. A code issued
# against one cannot be checked against the other at the vendor, which is
# Verify's spelling of the separation ADR 0027 built for the address.
#
# Unset means no transport at all and a refusal rather than a silent drop, so
# these are absent from `render-env.sh`'s required list on purpose: the campaign
# takes days to approve (ADR 0028) and the deploy must not wait on it.
TWILIO_ACCOUNT_SID={{ op://Caballus/twilio/account-sid }}
TWILIO_AUTH_TOKEN={{ op://Caballus/twilio/auth-token }}
TWILIO_FROM_NUMBER={{ op://Caballus/twilio/from-number }}
TWILIO_VERIFY_SERVICE_SID={{ op://Caballus/twilio/verify-service-sid }}
TWILIO_VERIFY_CHANGE_SERVICE_SID={{ op://Caballus/twilio/verify-change-service-sid }}

# --- The Whiteboard Read's model key (ADR 0023) ---------------------------
# An OpenRouter key rather than an Anthropic one: the rescue pays for one
# gateway subscription and this call comes out of it.
OPENROUTER_API_KEY={{ op://Caballus/openrouter/api-key }}

# --- Error reporting ------------------------------------------------------
# Literal and empty, deliberately: there is no Sentry project yet, and a
# reference to a vault field that does not exist would fail every render. Unset
# means no reports leave the machine. When there is a DSN, these become
# references like the rest.
SENTRY_DSN=
VITE_SENTRY_DSN=

# --- The image ------------------------------------------------------------
# Which repository in the registry a tag names, and which tag is running.
# `REGISTRY_IMAGE` is a literal because the repository is the thing that
# decided it. `CABALLUS_IMAGE` is left blank here and written by `deploy.sh`
# after the render, which is what keeps this file the record of what is
# actually running — `render-env.sh` carries the current value across so a
# render on its own never loses it.
REGISTRY_IMAGE=git.heckart.me/rob/caballus
CABALLUS_IMAGE=
