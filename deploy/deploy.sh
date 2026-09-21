#!/usr/bin/env bash
# One deploy of Caballus. Run by hand over SSH, or by the `deploy` workflow,
# which is the same act pressed from a different keyboard.
#
# The order is ADR 0007's: pull, migrate as an explicit one-shot step that must
# succeed, and only then let the new container take traffic. A migration in the
# entrypoint would turn the 6am restart ADR 0006 already puts on the critical
# path into a boot that can hang on a lock while a Lead waits for the
# medication list.
set -euo pipefail

STACK=/docker/caballus
TAG="${1:-latest}"

say() { printf '==> %s\n' "$*"; }

# A tag reaches this script from a workflow input, so it is checked rather than
# trusted. Anything outside a tag's own alphabet is refused before it becomes
# part of a command — and before anything on the box is touched.
if ! printf '%s' "$TAG" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$'; then
  echo "deploy: refusing tag '$TAG'" >&2
  exit 2
fi

cd "$STACK"

# ADR 0006's secrets step, and the first thing this script does: `.env` is
# rendered from `.env.tpl` through a 1Password service account, so a secret
# changed in the vault reaches the box by being deployed rather than by being
# typed into a file over SSH. It happens before the pull, so a token that
# expired overnight fails with the running container untouched.
#
# CABALLUS_SKIP_ENV_RENDER=1 is the escape hatch for the morning 1Password is
# the broken thing. It is not reachable from CI — the deploy key's forced
# command passes a tag and nothing else — so it is root's own act, at a real
# shell, and it says so in the log rather than being silent.
if [ "${CABALLUS_SKIP_ENV_RENDER:-}" = "1" ]; then
  say "SKIPPING the 1Password render — .env is whatever is already on this box"
else
  ./render-env.sh
fi

# Which repository in the registry the tag names, read from the file that was
# just rendered, because the registry has moved once already — from Forgejo's
# to GitHub's, with the repository — and a move should be one line of the
# template rather than an edit here. The fallback stays for a box rendered by
# an older template.
REGISTRY_IMAGE=$(grep -E '^REGISTRY_IMAGE=' .env | cut -d= -f2-)
REGISTRY_IMAGE="${REGISTRY_IMAGE:-ghcr.io/rheckart/caballus}"

IMAGE="$REGISTRY_IMAGE:$TAG"
PREVIOUS=$(grep -E '^CABALLUS_IMAGE=' .env | cut -d= -f2-)

say "pulling $IMAGE"
docker pull "$IMAGE"

say "recording the image this stack runs"
sed -i "s|^CABALLUS_IMAGE=.*|CABALLUS_IMAGE=$IMAGE|" .env

say "database up"
docker compose up -d postgres

say "migrating"
# `run` rather than `exec`: the migration is a container of its own, using the
# new image, and it must succeed before anything takes traffic. It connects as
# the owner through ADMIN_DATABASE_URL; the application never does (ADR 0007).
if ! docker compose run --rm -T app npm run db:migrate; then
  say "migration failed — nothing has been swapped, the old container is still serving"
  sed -i "s|^CABALLUS_IMAGE=.*|CABALLUS_IMAGE=$PREVIOUS|" .env
  say "note: the tag is put back, the secrets are not. This deploy re-rendered .env;"
  say "      the file it replaced is at $STACK/.env.previous if a secret is the suspect."
  exit 1
fi

say "starting the application"
docker compose up -d app

say "waiting for health"
# Polled from outside rather than from the container, so a green answer proves
# Traefik, the certificate and the database as well as the process.
for attempt in $(seq 1 30); do
  if curl -fsS -m 5 https://caballus.tech/health >/dev/null 2>&1; then
    say "healthy after ${attempt}0s or less"
    curl -fsS https://caballus.tech/health; echo
    say "deployed $IMAGE"
    exit 0
  fi
  sleep 5
done

say "did not become healthy — rolling back to $PREVIOUS"
# The tag, and deliberately not the secrets. A rollback has always been about
# which image is running; silently reverting .env as well would undo the very
# secret somebody just deployed in order to fix this. The previous file is kept
# rather than restored, so putting it back is a decision with a command.
sed -i "s|^CABALLUS_IMAGE=.*|CABALLUS_IMAGE=$PREVIOUS|" .env
docker compose up -d app
say "rolled back. The failed image was $IMAGE"
say "note: the secrets were not rolled back. If one is the suspect, the file this"
say "      deploy replaced is at $STACK/.env.previous."
exit 1
