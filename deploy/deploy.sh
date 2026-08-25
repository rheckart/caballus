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
REGISTRY_IMAGE=git.heckart.me/rob/caballus
TAG="${1:-latest}"

# A tag reaches this script from a workflow input, so it is checked rather than
# trusted. Anything outside a tag's own alphabet is refused before it becomes
# part of a command.
if ! printf '%s' "$TAG" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$'; then
  echo "deploy: refusing tag '$TAG'" >&2
  exit 2
fi

cd "$STACK"
IMAGE="$REGISTRY_IMAGE:$TAG"
PREVIOUS=$(grep -E '^CABALLUS_IMAGE=' .env | cut -d= -f2-)

say() { printf '==> %s\n' "$*"; }

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
sed -i "s|^CABALLUS_IMAGE=.*|CABALLUS_IMAGE=$PREVIOUS|" .env
docker compose up -d app
say "rolled back. The failed image was $IMAGE"
exit 1
