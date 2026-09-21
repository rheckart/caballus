#!/usr/bin/env bash
# ADR 0006's durability story: a dump offsite every fifteen minutes, a nightly
# full beside it, thirty days kept, and last night's restored on a schedule.
#
#   backup.sh frequent        pg_dump to S4 under frequent/        (every 15 min)
#   backup.sh nightly         pg_dump + roles to S4 under nightly/, then prune
#   backup.sh restore-check   last night's dump into a scratch database, counted
#
# Run by the systemd timers in deploy/systemd/, and by hand the same way.
#
# A job that succeeds writes a stamp into backup-state/, which the application
# container mounts read-only and `/health` reads (scripts/backup-freshness.mjs).
# A stamp is written **after** the upload or the check has succeeded and never
# before, so a failure anywhere leaves the previous stamp to go stale — that is
# the alert, rather than a mail this box has no way to send.
#
# Pushed from the VPS rather than pulled to OMV8: ADR 0006 is one offsite copy
# and declines a second at home, and pulling would quietly change that trade.
set -euo pipefail

MODE="${1:-}"
STACK="${CABALLUS_STACK:-/docker/caballus}"
STATE="$STACK/backup-state"
WORK="$STACK/backup-work"
ENV_FILE="$STACK/backup.env"

# Pinned, like every image this stack runs. `Mega` is a provider rclone knows by
# name, which is what sets the S3 quirks rather than a hand-kept list of flags.
RCLONE_IMAGE=rclone/rclone:1.74.0

SCRATCH_DB=caballus_restore_check

say() { printf '==> %s\n' "$*"; }
die() { printf 'backup: %s\n' "$*" >&2; exit 1; }

case "$MODE" in
  frequent | nightly | restore-check) ;;
  *) die "usage: backup.sh frequent|nightly|restore-check" ;;
esac

# Dumps hold volunteers' names and mobile numbers. Nothing written here should
# exist, even for an instant, at a mode another account on the box can read.
umask 077

[ -r "$ENV_FILE" ] || die "no $ENV_FILE — render it with render-env.sh (docs/deploy.md, Backups)"
BUCKET=$(sed -nE 's/^CABALLUS_BACKUP_BUCKET=(.*)$/\1/p' "$ENV_FILE" | tail -n 1)
[ -n "$BUCKET" ] || die "CABALLUS_BACKUP_BUCKET is empty in $ENV_FILE"

mkdir -p "$WORK"
# The state directory is the one thing here the application reads, as the
# container's `node` user, and it holds nothing but two timestamps.
mkdir -p "$STATE"
chmod 755 "$STATE"

# One job at a time. A nightly that runs long must not race the next fifteen-
# minute dump for the same database, and a restore check must not download a
# file the prune is deleting.
exec 9>"$STACK/backup.lock"
flock -w 900 9 || die "another backup job has held the lock for fifteen minutes"

cd "$STACK"

rclone() {
  # Configured wholly by the environment, so the config file it would otherwise
  # look for — and complain about on every call — is told to be nothing.
  docker run --rm --env-file "$ENV_FILE" -e RCLONE_CONFIG=/dev/null -v "$WORK:/work" \
    "$RCLONE_IMAGE" "$@"
}

psql_in() {
  docker compose exec -T postgres psql -U caballus -v ON_ERROR_STOP=1 -At "$@"
}

stamp() {
  date -u +%Y-%m-%dT%H:%M:%SZ > "$STATE/.$1.next"
  chmod 644 "$STATE/.$1.next"
  mv "$STATE/.$1.next" "$STATE/$1"
}

NOW=$(date -u +%Y%m%dT%H%M%SZ)

# A dump, proved readable before it leaves the box: `pg_restore --list` reads
# the whole table of contents, so a truncated file fails here rather than on the
# morning it is needed.
dump() {
  local target="$1"
  docker compose exec -T postgres pg_dump -U caballus -d caballus --format=custom > "$target"
  [ -s "$target" ] || die "pg_dump wrote nothing"
  docker compose exec -T postgres pg_restore --list < "$target" > /dev/null \
    || die "the dump does not read back — nothing was uploaded"
}

cleanup() { rm -f "$WORK"/*.dump "$WORK"/*.sql; }
trap cleanup EXIT

case "$MODE" in
  frequent)
    dump "$WORK/$NOW.dump"
    rclone copyto "/work/$NOW.dump" "s4:$BUCKET/frequent/$NOW.dump"
    stamp last-backup
    say "frequent/$NOW.dump is offsite"
    ;;

  nightly)
    dump "$WORK/$NOW.dump"
    # Roles as well as the database, so a restore onto a fresh box has
    # `caballus_app` to grant to. Without passwords: those are in 1Password,
    # and provision-database.sql sets them.
    docker compose exec -T postgres pg_dumpall -U caballus --globals-only --no-role-passwords \
      > "$WORK/$NOW.globals.sql"
    rclone copyto "/work/$NOW.dump" "s4:$BUCKET/nightly/$NOW.dump"
    rclone copyto "/work/$NOW.globals.sql" "s4:$BUCKET/nightly/$NOW.globals.sql"
    stamp last-backup
    say "nightly/$NOW.dump is offsite"

    # Thirty days, enforced here rather than assumed of a bucket policy nobody
    # can see from this repository. `restore-check` asserts it held.
    rclone delete --min-age 30d "s4:$BUCKET/frequent"
    rclone delete --min-age 30d "s4:$BUCKET/nightly"
    say "pruned everything older than thirty days"
    ;;

  restore-check)
    LATEST=$(rclone lsf --files-only --include '*.dump' "s4:$BUCKET/nightly" | sort | tail -n 1)
    [ -n "$LATEST" ] || die "there is no nightly dump in s4:$BUCKET/nightly at all"

    # The newest nightly has to be last night's. An old file restoring cleanly
    # proves the restore works and says nothing about whether backups do.
    TAKEN="${LATEST:0:4}-${LATEST:4:2}-${LATEST:6:2}T${LATEST:9:2}:${LATEST:11:2}:${LATEST:13:2}Z"
    AGE_HOURS=$(( ( $(date -u +%s) - $(date -u -d "$TAKEN" +%s) ) / 3600 ))
    [ "$AGE_HOURS" -le 26 ] || die "the newest nightly, $LATEST, is $AGE_HOURS hours old"

    rclone copyto "s4:$BUCKET/nightly/$LATEST" "/work/$LATEST"

    drop_scratch() { psql_in -d postgres -c "drop database if exists $SCRATCH_DB" > /dev/null || true; }
    trap 'drop_scratch; cleanup' EXIT
    drop_scratch
    psql_in -d postgres -c "create database $SCRATCH_DB" > /dev/null
    docker compose exec -T postgres \
      pg_restore -U caballus -d "$SCRATCH_DB" --no-owner --no-privileges --exit-on-error \
      < "$WORK/$LATEST"

    TABLES_SQL="select count(*) from information_schema.tables where table_schema = 'public'"
    LIVE_TABLES=$(psql_in -d caballus -c "$TABLES_SQL")
    RESTORED_TABLES=$(psql_in -d "$SCRATCH_DB" -c "$TABLES_SQL")
    say "tables: live $LIVE_TABLES, restored $RESTORED_TABLES"
    # A migration between the dump and now can add a table; nothing removes one.
    [ "$RESTORED_TABLES" -gt 0 ] && [ "$RESTORED_TABLES" -le "$LIVE_TABLES" ] \
      || die "the restore has $RESTORED_TABLES tables against $LIVE_TABLES live"

    # Rows, on the tables a real rescue cannot have none of once it exists. A
    # table that is populated live and empty in the restore is a dump that
    # silently lost data.
    for table in orgs volunteers horses audit_entries; do
      LIVE=$(psql_in -d caballus -c "select count(*) from $table")
      RESTORED=$(psql_in -d "$SCRATCH_DB" -c "select count(*) from $table")
      say "$table: live $LIVE, restored $RESTORED"
      if [ "$LIVE" -gt 0 ] && [ "$RESTORED" -eq 0 ]; then
        die "$table has $LIVE rows live and none in the restore of $LATEST"
      fi
    done

    # Thirty days is enforced by the nightly prune; this is where it is checked.
    OVERDUE=$(rclone lsf -R --files-only --min-age 31d "s4:$BUCKET" | head -n 1)
    [ -z "$OVERDUE" ] || die "retention is not holding: $OVERDUE is older than thirty-one days"

    stamp last-restore-check
    say "$LATEST restored and counted"
    ;;
esac
