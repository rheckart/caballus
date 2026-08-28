#!/usr/bin/env bash
# Render `.env` from `.env.tpl` through 1Password, and refuse to leave a broken
# one behind.
#
# ADR 0006 puts 1Password at deploy time and never at startup: this runs before
# anything is pulled, and what it produces is a plain file the container reads
# with no 1Password dependency of its own. A 6am restart must not depend on a
# service-account token that quietly expired.
#
# Run by `deploy.sh`, and runnable on its own when a secret changed and nothing
# else did:
#
#   /docker/caballus/render-env.sh && cd /docker/caballus && docker compose up -d app
#
# `up -d` rather than `restart`, because a container reads `env_file` when it is
# created and carries that environment until it is replaced.
set -euo pipefail

STACK="${CABALLUS_STACK:-/docker/caballus}"
TEMPLATE="$STACK/.env.tpl"
TOKEN_FILE="$STACK/op-token"
TARGET="$STACK/.env"

say() { printf '==> %s\n' "$*"; }
die() { printf 'render-env: %s\n' "$*" >&2; exit 1; }

# Nothing this script writes should exist, even for an instant, at a mode that
# lets another account on the box read a database password.
umask 077

[ -r "$TEMPLATE" ] || die "no template at $TEMPLATE"
command -v op >/dev/null 2>&1 || die "the 1Password CLI is not installed — docs/deploy.md says how"
[ -r "$TOKEN_FILE" ] || die "no service-account token at $TOKEN_FILE"

# A token file that anybody on the box can read is not a secret. This is
# checked rather than assumed, because the failure is silent.
MODE=$(stat -c '%a' "$TOKEN_FILE")
[ "$MODE" = "600" ] || die "$TOKEN_FILE is mode $MODE — it must be 600"

OP_SERVICE_ACCOUNT_TOKEN=$(tr -d '\r\n' < "$TOKEN_FILE")
[ -n "$OP_SERVICE_ACCOUNT_TOKEN" ] || die "$TOKEN_FILE is empty"
export OP_SERVICE_ACCOUNT_TOKEN

# Which tag is running. The template deliberately leaves this blank — it is the
# one value the box owns rather than 1Password or the repository — so it is
# read out of the file being replaced and written back into its successor. A
# render on its own must not leave compose unable to resolve ${CABALLUS_IMAGE}.
RUNNING_IMAGE=""
if [ -r "$TARGET" ]; then
  RUNNING_IMAGE=$(sed -nE 's/^CABALLUS_IMAGE=(.*)$/\1/p' "$TARGET" | tail -n 1)
fi

NEXT="$STACK/.env.next"
trap 'rm -f "$NEXT"' EXIT

say "rendering $TEMPLATE through 1Password"
# Into a file beside the real one and never over it: a token that expired
# overnight must fail with the working `.env` untouched, not halfway rewritten.
if ! op inject --in-file "$TEMPLATE" --out-file "$NEXT" --force; then
  die "op inject failed — .env is untouched. A reference it could not resolve is named above."
fi

if [ -n "$RUNNING_IMAGE" ]; then
  say "carrying CABALLUS_IMAGE=$RUNNING_IMAGE across"
  sed -i "s|^CABALLUS_IMAGE=.*|CABALLUS_IMAGE=$RUNNING_IMAGE|" "$NEXT"
fi

# `op inject` leaves an unresolved reference as an error rather than as text,
# so this is a belt-and-braces check against a malformed one it read as
# literal — an unbalanced brace, a typo in the moustache.
if grep -q '{{' "$NEXT"; then
  die "the rendered file still contains a template reference — .env is untouched"
fi

# What the application cannot start without, and what a silently-empty vault
# field would otherwise turn into a container that boots and then refuses every
# request. Checked here, where the old file is still in place.
for required in POSTGRES_PASSWORD DATABASE_URL ADMIN_DATABASE_URL APP_ORG_ID BETTER_AUTH_SECRET APP_URL REGISTRY_IMAGE; do
  value=$(sed -nE "s/^${required}=(.*)\$/\1/p" "$NEXT" | tail -n 1)
  [ -n "$value" ] || die "$required rendered empty — .env is untouched"
done

# A password that arrived with a stray newline is a connection refused with no
# hint as to why, so the shape of the two URLs is checked rather than trusted.
grep -qE '^DATABASE_URL=postgres://caballus_app:[^@[:space:]]+@postgres:5432/caballus$' "$NEXT" \
  || die "DATABASE_URL did not render into the shape the box expects — .env is untouched"

if [ -r "$TARGET" ]; then
  cp -p "$TARGET" "$STACK/.env.previous"
  say "the file being replaced is kept at $STACK/.env.previous"
fi

mv "$NEXT" "$TARGET"
chmod 600 "$TARGET"
trap - EXIT
say "wrote $TARGET"
