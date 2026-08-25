#!/usr/bin/env bash
# What the CI deploy key is allowed to do, and the whole of it.
#
# The key is installed with a forced command, so a key that leaks out of a
# Forgejo secret can deploy a tag and cannot open a shell, read /docker or
# reach the database. The tag is extracted rather than passed through.
set -euo pipefail

COMMAND="${SSH_ORIGINAL_COMMAND:-}"
TAG=$(printf '%s' "$COMMAND" | sed -nE "s|^/docker/caballus/deploy\.sh '?([A-Za-z0-9_][A-Za-z0-9_.-]{0,63})'?\$|\1|p")

if [ -z "$TAG" ]; then
  echo "refused: this key may only run /docker/caballus/deploy.sh <tag>" >&2
  exit 2
fi

exec /docker/caballus/deploy.sh "$TAG"
