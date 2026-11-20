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
RESCUES_TEMPLATE="$STACK/rescues.tpl"
TOKEN_FILE="$STACK/op-token"
TARGET="$STACK/.env"

say() { printf '==> %s\n' "$*"; }
die() { printf 'render-env: %s\n' "$*" >&2; exit 1; }

# Nothing this script writes should exist, even for an instant, at a mode that
# lets another account on the box read a database password.
umask 077

[ -r "$TEMPLATE" ] || die "no template at $TEMPLATE"
[ -r "$RESCUES_TEMPLATE" ] || die "no rescue list at $RESCUES_TEMPLATE — docs/deploy.md, Adding a rescue"
command -v python3 >/dev/null 2>&1 || die "python3 is needed to assemble RESCUES — install it on the box"
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
RESCUES_NEXT="$STACK/rescues.next"
trap 'rm -f "$NEXT" "$RESCUES_NEXT"' EXIT

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

# Every rescue, one per line of `rescues.tpl` (ADR 0030, #116), rendered the
# same way and then assembled into the two things that must agree: the
# application's `RESCUES` map and Traefik's router rule. One list, two outputs,
# so a host can never be routed without being mapped or mapped without being
# routed.
#
# Checked against the rules the application parses `RESCUES` by
# (`parseRescues` in src/server/rescues.ts) — every host as a browser sends it,
# every organisation id an id, at most a kiosk token and a texting switch — and
# refusing a host or an organisation that appears twice. The application
# refuses to serve a malformed map, so a render that produced one would deploy
# an image that answers nobody.
say "rendering $RESCUES_TEMPLATE through 1Password"
if ! op inject --in-file "$RESCUES_TEMPLATE" --out-file "$RESCUES_NEXT" --force; then
  die "op inject failed for rescues.tpl — .env is untouched. A reference it could not resolve is named above."
fi
if grep -q '{{' "$RESCUES_NEXT"; then
  die "the rendered rescue list still contains a template reference — .env is untouched"
fi
if ! ASSEMBLED=$(python3 - "$RESCUES_NEXT" 2>&1 <<'PY'
import json, re, sys

host_shape = re.compile(r"^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$")
guid = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
token_shape = re.compile(r"^[A-Za-z0-9_-]{24,}$")

rescues = {}
orgs = set()
with open(sys.argv[1], encoding="utf-8") as lines:
    for number, line in enumerate(lines, start=1):
        line = line.strip()
        if line == "" or line.startswith("#"):
            continue
        where = "rescues.tpl line " + str(number)
        try:
            rescue = json.loads(line)
        except ValueError:
            sys.exit(where + " is not JSON")
        if not isinstance(rescue, dict) or not {"host", "orgId"} <= set(rescue) or not set(rescue) <= {"host", "orgId", "boardToken", "sms"}:
            sys.exit(where + " must carry host and orgId, and at most boardToken and sms")
        host = rescue["host"]
        if not isinstance(host, str) or not host_shape.match(host):
            sys.exit(where + " has a host that is not one: " + repr(host))
        if host in rescues:
            sys.exit("RESCUES names the host " + host + " twice")
        org = rescue["orgId"]
        if not isinstance(org, str) or not guid.match(org):
            sys.exit(where + " has an orgId that is not an id")
        if org.lower() in orgs:
            sys.exit("RESCUES maps two hosts to the same organisation: " + org)
        orgs.add(org.lower())
        entry = {"orgId": org}
        if "boardToken" in rescue:
            # base64url and long, which is what docs/deploy.md generates — and
            # which keeps a quote or a dollar sign out of a line compose reads.
            if not isinstance(rescue["boardToken"], str) or not token_shape.match(rescue["boardToken"]):
                sys.exit(where + " has a kiosk token shorter than 24 characters, or not base64url")
            entry["boardToken"] = rescue["boardToken"]
        if "sms" in rescue:
            if not isinstance(rescue["sms"], bool):
                sys.exit(where + " has an sms that is not true or false")
            entry["sms"] = rescue["sms"]
        rescues[host] = entry

if not rescues:
    sys.exit("RESCUES names no rescue at all")

# Single-quoted: compose and Node both read a single-quoted value literally,
# so the JSON's own double quotes arrive as written.
print("RESCUES='" + json.dumps(rescues, separators=(",", ":")) + "'")
print("CABALLUS_ROUTER_RULE=" + " || ".join("Host(`" + host.split(":")[0] + "`)" for host in rescues))
PY
); then
  die "$ASSEMBLED — .env is untouched"
fi
printf '\n# --- Assembled from rescues.tpl by render-env.sh (ADR 0030) -----------\n%s\n' "$ASSEMBLED" >> "$NEXT"
rm -f "$RESCUES_NEXT"
say "assembled RESCUES and the router rule from $(grep -c '^{' "$RESCUES_TEMPLATE") line(s) of rescues.tpl"

# What the application cannot start without, and what a silently-empty vault
# field would otherwise turn into a container that boots and then refuses every
# request. Checked here, where the old file is still in place.
for required in POSTGRES_PASSWORD DATABASE_URL ADMIN_DATABASE_URL RESCUES CABALLUS_ROUTER_RULE BETTER_AUTH_SECRET REGISTRY_IMAGE; do
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

# The backup job's own file, rendered only when its template has been copied
# onto the box — which is the step that says the S4 bucket and its vault item
# exist. Before then there is nothing to render, and a deploy must not fail on
# a vault item nobody has made yet (docs/deploy.md, Backups).
BACKUP_TEMPLATE="$STACK/backup.env.tpl"
BACKUP_TARGET="$STACK/backup.env"
if [ -r "$BACKUP_TEMPLATE" ]; then
  BACKUP_NEXT="$STACK/backup.env.next"
  trap 'rm -f "$BACKUP_NEXT"' EXIT
  say "rendering $BACKUP_TEMPLATE through 1Password"
  if ! op inject --in-file "$BACKUP_TEMPLATE" --out-file "$BACKUP_NEXT" --force; then
    die "op inject failed for backup.env — .env is written, backup.env is untouched"
  fi
  if grep -q '{{' "$BACKUP_NEXT"; then
    die "backup.env still contains a template reference — backup.env is untouched"
  fi
  for required in RCLONE_CONFIG_S4_ACCESS_KEY_ID RCLONE_CONFIG_S4_SECRET_ACCESS_KEY CABALLUS_BACKUP_BUCKET; do
    value=$(sed -nE "s/^${required}=(.*)\$/\1/p" "$BACKUP_NEXT" | tail -n 1)
    [ -n "$value" ] || die "$required rendered empty — backup.env is untouched"
  done
  mv "$BACKUP_NEXT" "$BACKUP_TARGET"
  chmod 600 "$BACKUP_TARGET"
  trap - EXIT
  say "wrote $BACKUP_TARGET"
fi
