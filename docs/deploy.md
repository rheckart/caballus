# Deploying Caballus

ADR 0006 asks that a restore be rehearsed by hand and that "the commands as
they actually ran are the runbook". This is that file for the deploy. Every
command below has been run against the real box; where something is not built
yet it says so rather than describing what it would look like.

## What runs where

**The VPS** — `caballus.tech`, `177.7.58.133`, Ubuntu 24.04, 2 CPU, 8 GB.
Traefik was already on it and is untouched: host networking, the Docker
provider with `exposedbydefault=false`, entrypoints `web` (:80, redirecting)
and `websecure` (:443), and a `letsencrypt` resolver over the HTTP challenge.
Caballus adds one stack at `/docker/caballus/`, following the box's own
convention — Traefik lives at `/docker/traefik/`.

**CI is on GitHub's hosted runners.** ADR 0007 put it on the OMV8 box at
home, beside Forgejo, and never on the VPS. On 2026-09-12 that box rebooted and
Forgejo's database came back ten days behind its git data — PRs #93–#98 and
issues #97 and #99–#101 were gone from it — and its nightly backup had been
deleting its own output since the 8th. The repository moved to
`github.com/rheckart/caballus` with every issue recreated under its old number,
and CI moved with it. The half of ADR 0007 that matters holds: **the VPS only
ever pulls.**

`runs-on: ubuntu-latest` is GitHub's own Ubuntu image, so `docker` and `psql`
are already there and nothing is installed by hand. The one difference that
bites when reading an older workflow: a job runs on the VM, not in a container
on the services' network, so the Postgres service is `localhost:5432` rather
than `postgres:5432`.

## The workflows' secrets

| Secret        | What it is                                          |
| ------------- | --------------------------------------------------- |
| `VPS_SSH_KEY` | The private half of the deploy key described below. |

Publishing needs no stored secret: `ci.yml` grants its `publish` job
`packages: write`, and the built-in `GITHUB_TOKEN` writes
`ghcr.io/rheckart/caballus` with it. (On Forgejo that token could not write
packages and a personal token had to be stored instead; that is no longer
true here.) Set a secret with `gh secret set VPS_SSH_KEY < <file>`.

**The VPS pulls from `ghcr.io` with a token of its own.** The package is private
because the repository is, so the box needs a classic token with
`read:packages` and nothing else, logged in once as root:
`docker login ghcr.io -u rheckart`. `deploy/.env.tpl` names the image as
`REGISTRY_IMAGE`, which is what made the registry move one line.

The VPS host key is written into `deploy.yml` in the clear rather than kept as
a secret. A public key is public, and pinning it means a box that was silently
recreated fails the deploy loudly instead of trusting whatever answers — which
has already happened once here: the VM was recreated on 2026-08-14 and its host
key changed with it.

## The deploy key can only deploy

`/root/.ssh/authorized_keys` on the VPS carries the CI key with a forced
command:

```
command="/docker/caballus/deploy-ssh.sh",restrict ssh-ed25519 AAAA… github-actions-deploy@caballus
```

So a key that leaks out of an Actions secret can deploy a tag and cannot open a
shell, read `/docker` or reach the database. `deploy-ssh.sh` extracts the tag
out of `SSH_ORIGINAL_COMMAND` and refuses anything else, and `deploy.sh` checks
the tag against a tag's own alphabet before it becomes part of a command.

One trap, met the hard way: **the file had no trailing newline**, so appending a
key with `echo >>` concatenated it onto the end of the previous line, where
sshd read it as that key's comment. It looked installed and was not. Append
with `printf '%s\n'` and check with `awk '{print NR}'`, not `grep`.

## Secrets are rendered from 1Password

> **The render has run against the box; a deploy through it has not.** The vault
> exists, the service account reads it, and `render-env.sh` has written a real
> `.env` on the VPS — so everything up to and including _Prove the first render_
> is the record this file promises. What is still procedure is the last step:
> no `deploy.sh` run has yet gone render → pull → migrate → health with the new
> first step in front of it. The first one that does closes the gap, and the
> rollback note under _Rolling back_ is the part to read before it.

ADR 0006: _"A service account renders a real `.env` onto the box with `op inject`
at deploy time."_ `deploy/render-env.sh` is that, and `deploy.sh` calls it as its
first step — before the pull, so a token that expired overnight fails with the
running container untouched.

**1Password is never in the startup path.** What the render produces is a plain
file, and the container reads it with no 1Password dependency of its own.
Starting under `op run` would make a 6am restart depend on somebody else's API
at the exact hour that matters.

`deploy/.env.tpl` is the template, and it is in the repository because it holds
references rather than values. The split is one rule: **the repository decides
what is a literal, and 1Password holds what only the deployment knows.**
`APP_URL` is a literal. A password, a token, the barn's coordinates and the
`APP_ORG_ID` that `bootstrap` minted on the box are references — none of them
can be read off a checkout, and a box rebuilt from scratch has to get them from
somewhere.

### What the vault has to contain

One vault, `Caballus`, six items — `s4` needed only once `backup.env.tpl` is on
the box — and every reference in the template must
resolve or the render fails — `op inject` errors on one it cannot find, and the
deploy stops there with `.env` untouched.

| Item         | Fields                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------- |
| `postgres`   | `password` (the owner), `app-password` (the `caballus_app` role)                              |
| `app`        | `org-id`, `better-auth-secret`, `board-token`, `barn-latitude`, `barn-longitude`              |
| `smtp`       | `url`                                                                                         |
| `openrouter` | `api-key`                                                                                     |
| `twilio`     | `account-sid`, `auth-token`, `from-number`, `verify-service-sid`, `verify-change-service-sid` |
| `s4`         | `access-key-id`, `secret-access-key` — read by `backup.env.tpl` only (_Backups_)              |

The values come out of the `.env` already on the box, which is the only place
some of them exist. Copy them in **before** touching anything else — a
`BETTER_AUTH_SECRET` that is lost signs out every volunteer at once, and ADR
0004 made sessions effectively permanent so that never happens.

**A reference is for a value that exists. A value that does not exist yet stays
a literal empty line.** `op inject` fails on a field it cannot find, and it
fails the whole render, so one reference written ahead of the thing it names
takes the deploy down for every variable rather than just its own.

`SENTRY_DSN` is the settled case: there is no Sentry project, its unset state is
already the right default, and so it is two empty lines in the template rather
than a reference to nothing.

**The five `TWILIO_*` entries are the live case, and they are references
today.** The campaign and the Verify Services are paperwork against Twilio's
console (#76), and until each one exists its field has to exist in the vault
too — so either create all five fields before the first render, or turn the
ones that are still pending back into literal empty lines and make them
references as they land. Do **not** paper over it with a placeholder value:
`src/server/sms.ts` refuses in words when a variable is unset, and a
made-up SID turns that clean refusal into a failure at send time, which is the
one thing the Urgent Send cannot afford.

### Setting it up

Two things about service accounts that decide the shape of this. **Vault access
is immutable** — a service account's vaults are fixed when it is created and
cannot be added to afterwards, so the vault has to exist first and be granted at
creation. And **a service account cannot be given the Personal or Private
vault** at all, which is why `Caballus` is a vault of its own rather than a
folder in an existing one. Read-only is enough; nothing here writes back.

```bash
# On a workstation with `op` signed in, not on the box.
op vault create Caballus
# … create the five items above, by hand, from the box's current .env …
op service-account create caballus-deploy --vault Caballus:read_items
# -> prints the token, once. Put it in 1Password too, in a vault this service
#    account cannot read.
#
# Deliberately no --expires-in. The flag exists, and a token that expires on a
# date nobody wrote down is exactly the 6am failure ADR 0006 names. Rotation
# here is a person's act, and it is listed below as not built.
```

Then the box, as root:

```bash
# The 1Password CLI, from 1Password's own apt repository.
curl -sS https://downloads.1password.com/linux/keys/1password.asc \
  | gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg
printf '%s\n' 'deb [arch=amd64 signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/amd64 stable main' \
  > /etc/apt/sources.list.d/1password.list
apt-get update && apt-get install -y 1password-cli

# The token, which is the one secret 1Password cannot hold for us.
umask 077
printf '%s\n' 'ops_…' > /docker/caballus/op-token
chmod 600 /docker/caballus/op-token

# And the two new files from deploy/ in the repository.
# scp .env.tpl render-env.sh root@caballus.tech:/docker/caballus/
chmod 755 /docker/caballus/render-env.sh
```

### One trap, met the hard way

**`op inject` scans the whole file for the reference scheme, not just the
moustaches** — comments included. A line explaining that a value is an
`op`-colon-slash-slash reference is itself parsed as a reference, and one with
no vault, item or field fails the render before it starts:

```
[ERROR] invalid secret reference 'op://': too few '/': secret references
        should have at least vault, item and field specified
```

The message names no line, which is what makes it slow to find. So `.env.tpl`
never writes the bare scheme outside a moustache, and says so in its own header
so the next person adding a variable does not reintroduce it. Checking a
template without resolving it — the parse alone — is one command, and stdout
goes to `/dev/null` so a template that _does_ resolve never prints a secret to a
terminal:

```bash
op inject -i deploy/.env.tpl >/dev/null
```

A complaint about the vault rather than about a reference means every reference
is well-formed, which is the whole of what this check is for.

### Prove the first render before trusting it

Run the render on its own and compare what it produced against what it
replaced. The first one should change **nothing but the formatting** — if a
value moved, a vault field is wrong, and finding that out now is much cheaper
than finding it out from a container that will not start.

```bash
cd /docker/caballus
./render-env.sh
diff <(grep -vE '^\s*(#|$)' .env.previous | sort) <(grep -vE '^\s*(#|$)' .env | sort)
```

`render-env.sh` refuses rather than guesses, and each refusal leaves the working
`.env` exactly where it was: no `op` installed, no token, a token file that is
not `chmod 600`, an `op inject` that could not resolve a reference, a required
variable that rendered empty, or a `DATABASE_URL` that did not come out in the
shape the box expects. The file it replaced is kept at `.env.previous`.

### When 1Password is the broken thing

```bash
CABALLUS_SKIP_ENV_RENDER=1 /docker/caballus/deploy.sh <tag>
```

The deploy then runs against whatever `.env` is already on the box, and says so
loudly in its output. It is **not reachable from CI** — the deploy key's forced
command passes a tag and nothing else — so it is root's own act at a real
shell, which is the right shape for a decision to skip a safety step.

## First boot, as it actually ran

```bash
# On the VPS, as root.
mkdir -p /docker/caballus && chmod 750 /docker/caballus
# docker-compose.yml, deploy.sh, deploy-ssh.sh, provision-database.sql, .env
# are copied in; .env is chmod 600.

cd /docker/caballus
docker compose up -d postgres

# The application role. ADR 0007 has the application connect as a non-superuser
# so the row-level security policies apply to it — a table's owner bypasses its
# own policies, so this must never be the owner. The password is read out of
# .env rather than typed, so it never reaches a shell history.
APP_PW=$(grep '^DATABASE_URL=' .env | sed -E 's|.*caballus_app:([^@]+)@.*|\1|')
docker compose exec -T postgres psql -U caballus -d caballus \
  -v app_password="$APP_PW" -f - < provision-database.sql

# Then the schema.
docker compose run --rm -T app npm run db:migrate

# Bootstrap does not mint an organisation id — it requires APP_ORG_ID to
# already be set, and refuses with a fresh one printed to stderr when it is
# not. So it is run twice: once to be told an id, and once for real.
docker compose run --rm -T app npm run bootstrap -- \
  "Freedom Hill Horse Rescue" America/New_York "Rob Heckart" rob@heckart.me
# -> APP_ORG_ID is not set. A fresh one: 01a03af7-…
sed -i 's|^APP_ORG_ID=.*|APP_ORG_ID=01a03af7-…|' .env
docker compose run --rm -T app npm run bootstrap -- \
  "Freedom Hill Horse Rescue" America/New_York "Rob Heckart" rob@heckart.me
# -> Created Freedom Hill Horse Rescue and its first President, Rob Heckart.
#    They sign in with a code like anybody else; nothing here made them an
#    account.

docker compose up -d app
```

Traefik took about a minute to get a certificate, and served its own default
one until it did — so a browser opened straight after the first `up` shows a
warning that is not a misconfiguration. `acme.json` also carried four failed
challenges for `caballus.tech` from 2026-08-18, before any of this existed;
they are old and did not block the issue.

## The build's browser half is served by `serve.mjs`, and was by nothing

The first deploy answered every page with 200 and every asset with **404**: the
site rendered as unstyled text, `manifest.webmanifest` and `sw.js` were missing,
and the installable shell (#48) installed nothing. `vite build` emits the
browser's half into `dist/client` and the server bundle does not read it, so
until `scripts/serve.mjs` looked there, nothing served it.

It went unnoticed because `npm run dev` has Vite serving those files and no test
had ever asked the built server for one. `npm run build && npm start` is
described in `CLAUDE.md` as the production build, and it had never actually
worked.

`serve.mjs` now serves `dist/client` ahead of the handler, on `GET` and `HEAD`
alone, resolving each path and checking it against the root rather than scanning
for `..`. `/assets/` — Vite's content-hashed output, whose bytes at a given hash
never change — is `immutable, max-age=31536000`; everything else is `no-cache`,
`sw.js` above all, where a cached copy is a shell that cannot be updated.

## A routine deploy

Push to `main`. `ci.yml` runs `verify` and, if it passes, publishes
`ghcr.io/rheckart/caballus:<twelve-character commit>` and `:latest`.

Then press **deploy** — Actions → deploy → Run workflow — and give it the tag.
Publishing does not deploy. ADR 0007 makes migrations a deliberate step, and a
6am restart is on the critical path of a Lead waiting for the medication list;
the moment is a person's to choose.

`deploy.sh` does the same thing over SSH when CI is the thing that is broken:

```bash
ssh root@caballus.tech /docker/caballus/deploy.sh <tag>
```

It pulls, records the image in `.env`, migrates as a one-shot container that
must succeed, starts the application, and then polls `https://caballus.tech/health`
from outside — so a green answer proves Traefik, the certificate and the
database as well as the process. If health never comes, it puts the previous
image back and says which one failed.

## The image, and why it is the size it is

The heavy layer is `node_modules`; the runtime stage installs `--omit=dev`
fresh instead of copying the build stage's tree, which took the image from
751 MB to 676 MB, and `drizzle-kit` and `jiti` are in `dependencies` because a
migration and the bootstrap are production acts run from this image.

676 MB is less of a saving than it looks like it should be: `better-auth`
depends on `vitest` and `@tanstack/react-start` on `prettier`, so both are
genuinely in the production tree.

## Changing a secret

**Change it in 1Password, then deploy.** That is the whole procedure, and it is
the reason the render exists: a value edited in the vault reaches the box on the
next deploy, and a box rebuilt from nothing gets the same value back.

```
# 1Password: Caballus / openrouter / api-key  ->  the new key
# Then: Actions -> deploy -> Run workflow, with the tag already running.
```

Deploying the tag that is already running is a normal thing to do here. `pull`
is a no-op, the migration re-runs against a schema it has already applied, and
the container is recreated — which is what picks the new value up.

Nothing about a secret is edited into `/docker/caballus/.env` by hand any more.
That file is **rendered output**: an edit to it survives exactly until the next
deploy and then vanishes, which is worse than not working, because it works for
a week first. If a value has to change without a deploy, change it in the vault
and render:

```bash
ssh root@caballus.tech
cd /docker/caballus && ./render-env.sh && docker compose up -d app
```

`up -d` rather than `restart`, and this is the trap worth knowing on its own: a
container reads `env_file` when it is **created**, and carries that environment
until it is replaced. `docker compose restart app` stops and starts the
container that is already there — so the file changes and the application does
not. `up -d` builds a new one.

**Adding a variable is three files, not one.** `.env.example` in the repository
root, so a developer's machine knows about it; `deploy/.env.tpl`, as a literal
or an `op://` reference by the rule above; and then the template has to be
copied to the box, because nothing keeps the two in step yet.

Several variables refuse in words rather than obscurely when they are unset,
which is what makes a missing one findable at all: `SMTP_URL`, where no
transport means nobody can sign in by email (ADR 0009); `OPENROUTER_API_KEY`,
where `/admin/whiteboard-read` answers _Nobody has told this deployment how to
read a whiteboard_ (ADR 0023); and the five `TWILIO_*` variables, where every
Urgent Send answers `sms_not_configured` and a sign-in by text says plainly that
nothing is coming (ADR 0028, ADR 0029).

## Rolling back

Deploy the previous tag. `grep CABALLUS_IMAGE /docker/caballus/.env` says what
is running now; the registry holds every commit that was ever published.

A rollback across a migration is **not** automatic and never will be by this
script: Drizzle's migrations are forward-only, and a schema the old image does
not understand is a decision, not a button.

**A rollback puts the tag back and not the secrets.** It always was about which
image is running, and now that every deploy re-renders `.env`, that distinction
has to be said out loud: reverting the secrets too would undo the very value
somebody just deployed in order to fix the outage. The file the render replaced
is kept at `/docker/caballus/.env.previous` — restoring it is
`cp .env.previous .env && docker compose up -d app`, which is a decision with a
command rather than something the script does behind you.

## `/health`

`GET /health` is answered by `scripts/serve.mjs` **ahead of** the application
handler, and deliberately. ADR 0016 requires every endpoint the application
serves to be declared in `src/shared/api-contract.ts` with an authorization,
and there is no public one — inventing it would widen ADR 0010's two axes for
an operations probe that is not a domain read. Answering ahead of the handler
also means it still answers when the handler is the broken thing.

It opens a real connection of its own and runs `select 1`, and on the box it
also reads the two stamps `backup.sh` writes (see _Backups_):

```json
{
  "status": "ok",
  "database": "ok",
  "backup": "ok",
  "backupAgeMinutes": 7,
  "restoreCheck": "ok",
  "restoreCheckAgeHours": 9
}
```

It answers **503 when any of the three is bad**: the database, a dump older
than an hour, or a restore check older than 26 hours. A missing stamp is stale,
not unknown. It is unauthenticated and says up or down and how old, never why;
the reason goes to stdout or the journal.

**The deploy and the container's healthcheck read `database`, not the status.**
A backup job that broke overnight is something for the monitor to shout about,
not a reason for `deploy.sh` to roll back a working image. `BACKUP_STATE_DIR`
is what turns the backup half on, and only `deploy/docker-compose.yml` sets
it — a laptop and CI run no backups for a check to find missing.

## Backups

> **Installed 2026-09-21, and a restore rehearsed by hand the same evening.**
> _Installing it_ and _Restoring_ below are the commands as they actually ran,
> with what they printed. One step is still outstanding: the application image
> running at the time (`a22753cceb6c`) predates the stamps, so `/health` starts
> carrying the backup's age at the first deploy of the image that merges #73.

ADR 0006: `pg_dump` every fifteen minutes plus a nightly full, to MEGA S4
`ca-central-1`, thirty days kept, last night's restored on a schedule, and
`/health` carrying the age of the last success. `deploy/backup.sh` is all of
it, run by three systemd timers on the VPS.

**Pushed from the VPS, not pulled to OMV8.** ADR 0006 is one offsite copy and
declines a second at home; pulling to the rclone machinery already on OMV8
would quietly change that trade rather than implement it.

| Timer                                 | When                   | What                                                                |
| ------------------------------------- | ---------------------- | ------------------------------------------------------------------- |
| `caballus-backup-frequent.timer`      | every 15 minutes       | `pg_dump` → `frequent/`                                             |
| `caballus-backup-nightly.timer`       | 02:50 America/New_York | `pg_dump` and roles → `nightly/`, then delete anything over 30 days |
| `caballus-backup-restore-check.timer` | 03:50 America/New_York | newest nightly → scratch database, tables and rows counted          |

Each dump is read back with `pg_restore --list` **before** it is uploaded. A
job that succeeds writes a stamp into `/docker/caballus/backup-state/`, which
the application mounts read-only; a job that fails writes nothing, and the
stamp going stale turns `/health` red. That is the whole alerting story, and
it only reaches a person once Uptime Kuma watches `/health` (below).

The restore check fails when the newest nightly is more than 26 hours old,
when the restore has more tables than live or none, when any of `orgs`,
`volunteers`, `horses` or `audit_entries` has rows live and none restored, and
when any object in the bucket is older than 31 days — which is where the
thirty-day retention is checked rather than assumed.

**The S4 key lives in `backup.env`, never in `.env`.** `.env` is the
application's environment, and the application has no business holding a key
that can delete the backups. `render-env.sh` renders `backup.env` from
`backup.env.tpl` only when the template is on the box, so no deploy fails on a
vault item that does not exist yet.

### Installing it

As it ran on 2026-09-21. The box's copies of `docker-compose.yml`,
`render-env.sh` and `deploy.sh` were diffed against `main` first — identical —
and kept as `*.pre-73` before being replaced.

```sh
# 1. In the MEGA S4 console: bucket caballus-db-backup in ca-central-1
#    (Montreal), and an access key scoped to that bucket alone. The key goes in
#    the vault as the s4 item; the bucket name is a literal in backup.env.tpl.
op item create --vault Caballus --category login --title s4 \
  'access-key-id[text]=…' 'secret-access-key[password]=…'
# The service account reads the vault, so nothing about it changes.

# 2. From the repository, onto the box. deploy.sh travels too, and before any
#    image that carries the stamps is deployed: the old one polls /health with
#    `curl -f`, so the first stale-backup 503 would roll a working image back.
ssh root@caballus.tech 'cd /docker/caballus && for f in docker-compose.yml render-env.sh deploy.sh; do cp -p $f $f.pre-73; done'
scp deploy/backup.sh deploy/backup.env.tpl deploy/render-env.sh deploy/deploy.sh \
  deploy/docker-compose.yml root@caballus.tech:/docker/caballus/
scp deploy/systemd/* root@caballus.tech:/etc/systemd/system/

# 3. On the box.
cd /docker/caballus
chmod 755 backup.sh render-env.sh deploy.sh
chmod 600 backup.env.tpl
./render-env.sh              # -> wrote /docker/caballus/.env, then backup.env
systemctl daemon-reload      # -> four caballus-backup units, timers disabled

# 4. One of each by hand, before any timer, and read what they say.
systemctl start caballus-backup@frequent.service
systemctl start caballus-backup@nightly.service
systemctl start caballus-backup@restore-check.service
journalctl -u 'caballus-backup@*' -n 80 --no-pager
# -> nightly/20260921T222041Z.dump is offsite
# -> pruned everything older than thirty days
# -> tables: live 45, restored 45
# -> orgs: live 1, restored 1
# -> volunteers: live 4, restored 4
# -> horses: live 10, restored 10
# -> audit_entries: live 167, restored 167
# -> 20260921T222041Z.dump restored and counted

# 5. The timers.
systemctl enable --now caballus-backup-frequent.timer \
  caballus-backup-nightly.timer caballus-backup-restore-check.timer
systemctl list-timers 'caballus-*'
# -> frequent next at 22:30 UTC; nightly 06:50 UTC and restore-check 07:50 UTC,
#    which are 02:50 and 03:50 in New York

# 6. Outstanding: the application picks up the mount at the next deploy of an
#    image carrying #73, and then
curl -s https://caballus.tech/health; echo   # backup and restoreCheck "ok"
```

Step 6 comes after step 4 on purpose: the compose change is what makes
`/health` look for stamps, so bringing it up before a backup has run is a 503
for no reason.

**Two things went wrong on the way, and both are worth knowing.**

The first upload failed with `NoSuchBucket: The specified bucket does not
exist` — the template named a bucket that had been planned rather than the one
that was made. The key authenticated, which is what the error proves: a bad key
is `AccessDenied`, not `NoSuchBucket`. Checking the name with `rclone lsd s4:`
does **not** work and should not be made to: the key is scoped to one bucket,
so `ListBuckets` answers `AccessDenied: Request not allowed by policy`, which is
the key being as narrow as it should be. Read the name off the console.

The first successful run took **8 minutes 44 seconds** — started 22:00:37,
finished 22:09:21 — with nothing in the journal between. Every run since has
taken one to two seconds: the dump is about 200 KB, `pg_dump` 0.3 s, the
upload 1.6 s. It did not reproduce under `bash -x` or under systemd, and the
likeliest cause is S4 itself on the first write to a new bucket. It is recorded
because the fifteen-minute cadence has room for it — `flock -w 900` stops two
runs overlapping, and a dump that is late is `/health` going red rather than a
silent gap — and because a second one is a real signal rather than a mystery.

### Restoring

**Rehearsed by hand on 2026-09-21, against the real bucket, in fifteen
seconds** — from listing S4 to every table counted against live. ADR 0006's
one-hour RTO holds with room to spare for a restore on a box that still exists.
The rehearsal restores into a scratch database beside production rather than
over it; a real restore after losing the box is the same steps against a fresh
stack built from _First boot_, with the same `.env` rendered from 1Password —
the `BETTER_AUTH_SECRET` above all, so nobody is signed out.

The commands as they ran, as root in `/docker/caballus`. `RCLONE_CONFIG=/dev/null`
is not optional: without it rclone looks for a config file on every call and
says so.

```sh
cd /docker/caballus
R="docker run --rm --env-file backup.env -e RCLONE_CONFIG=/dev/null -v $PWD/backup-work:/work rclone/rclone:1.74.0"
P="docker compose exec -T postgres psql -U caballus -v ON_ERROR_STOP=1 -At"

# Which dumps there are, newest last.
$R lsf --files-only s4:caballus-db-backup/frequent | sort | tail -n 3
# -> 20260921T220037Z.dump
# -> 20260921T221924Z.dump
# -> 20260921T221949Z.dump

# Fetch the newest.
DUMP=$($R lsf --files-only s4:caballus-db-backup/frequent | sort | tail -n 1)
$R copyto s4:caballus-db-backup/frequent/$DUMP /work/$DUMP

# Into a database of its own.
$P -d postgres -c "create database caballus_rehearsal"
docker compose exec -T postgres pg_restore -U caballus -d caballus_rehearsal \
  --no-owner --no-privileges --exit-on-error < backup-work/$DUMP

# Every table, against live.
for t in $($P -d caballus -c "select table_name from information_schema.tables where table_schema = 'public' order by 1"); do
  printf "%-32s live=%-6s restored=%s\n" $t \
    $($P -d caballus -c "select count(*) from $t") \
    $($P -d caballus_rehearsal -c "select count(*) from $t")
done
# -> 45 tables, every one equal: audit_entries 167, feed_schedule_lines 51,
#    horse_space_assignments 35, standing_rules 34, spaces 26, products 21,
#    horses 10, volunteers 4, orgs 1 … and the empty ones empty on both sides.

# And clean up.
$P -d postgres -c "drop database caballus_rehearsal"
rm -f backup-work/$DUMP
```

For a real restore over production, the application is stopped first
(`docker compose stop app`), the dump is restored into `caballus` **with**
ownership — `pg_restore --clean --if-exists` as the owner — the nightly's
`globals.sql` is applied first on a fresh cluster so `caballus_app` exists, and
`scripts/provision-database.sql` sets its password again from `.env`. That path
has **not** been rehearsed: it overwrites production, and the scratch-database
rehearsal is the part that proves the dumps are good.

## Texting: what has to exist before a message can leave

**Two Twilio products behind one account, and they are not interchangeable**
(ADR 0028, ADR 0029). The messaging campaign carries the **Urgent Send** — a
Shift declared Short, and an Announcement whose news will not keep, and nothing
else ever. **Verify** carries sign-in codes, and sits outside A2P brand and
campaign registration entirely. That separation is what keeps a volunteer who
replied STOP to a staffing text able to sign in, and it is what stops the
Urgent Send's kill switch or daily cap from locking the roster out of the app.

**None of this blocks a deploy.** All five variables are absent from
`render-env.sh`'s required list on purpose: the brand and the campaign take
days to approve, and until they are approved every send refuses in words
(`sms_not_configured`) rather than dropping quietly.

**Where this stands as of 2026-09-02.** The brand and the campaign are
**Approved**, the number is bought and attached, and both Verify Services
exist — so all five values are obtainable and nothing below is waiting on
Twilio any more. What is left is a person's work: put the five values in the
vault, confirm the number's HELP and STOP auto-replies, and send the canary.
The rejection history further down is kept rather than deleted, because the
same four causes will be waiting the day the rescue re-registers under its own
EIN.

### The sole-proprietor limits, which the next person will otherwise rediscover

The brand ADR 0028 registers is **Sole Proprietor**, registered to the
maintainer personally, and it is capped:

- **One campaign.** There is no second one to put anything else on. This is
  survivable only because login lives on Verify (ADR 0029); ADR 0008 needed two
  campaigns and that is where its bill doubled.
- **One number.** Volunteers who save the contact will see it change on the day
  the rescue registers its own brand against its own EIN — the tripwire ADR
  0028 writes down. Annoying, survivable, and cheaper than a board conversation
  blocking the build.
- **About 1,000 messages a day, 15 a minute.** `src/server/sms.ts` caps itself
  at **120** in a rolling twenty-four hours, which is two full sends to sixty
  people. Tripping the app's cap means something is wrong; the carrier's is not
  reachable from normal use.

Registration wants a legal name matching government ID, a mobile that receives
a PIN **within 24 hours or the process restarts**, a physical address with no PO
box, and a public URL — which is why `caballus.tech` serves a real page (#75)
rather than a login form. **Three URLs go on the form**, and all three are
served by the application: `https://caballus.tech/` describes the messages and
the opt-in, `https://caballus.tech/privacy` is the privacy policy carrying the
non-sharing statement vetting looks for, and `https://caballus.tech/terms` is
the terms carrying HELP, STOP and the rates disclosure (#80).

### The sample messages, which have to match what the code sends

The campaign form asks for sample messages and asks whether the traffic carries
embedded links. **These are the two samples that were given, and they are the
two `src/shared/urgent.ts` composes** (#83) — recorded here because nothing else
in the repository would show a reader that the form and the code had drifted,
and a mismatch between the samples and the traffic is what carriers flag for:

```
Caballus: Feed AM on 2026-09-03 at 07:00 is short. Cover it: https://caballus.tech/shifts Reply STOP to stop.
Caballus: The farrier comes Thursday morning. More: https://caballus.tech Reply STOP to stop.
```

**The campaign description, which vetting reads against the samples.** The
first submission was rejected with Twilio's 30886 — _Invalid Campaign
Description_ — which is the vetting bot saying the description did not spell
out who sends, who receives, and why. This is the resubmitted text, recorded
for the same reason the samples are: a rewording that drops one of the three
fails a review a week later in an email nobody would connect back to it.
Resubmitted with this text on 2026-08-30. **The dates inside Twilio's
compliance emails distinguish nothing**: both the rejection and the
resubmission confirmation stamp the _original_ submission timestamp, so an
email cannot tell you which submission it reviewed — only the campaign's
status in the console can. If a resubmission is rejected again with 30886,
the next step is a support ticket quoting the Campaign SID and asking which
part of the description failed, not a third blind resubmit.

```
Caballus is a volunteer-coordination web app for a horse rescue barn, operated
by Rob Heckart as a sole proprietor. Messages are sent through the app by the
rescue's volunteer coordinators to the rescue's own registered volunteers
(about 60 people). There are exactly two message types: (1) an alert that a
specific upcoming barn shift is short-staffed, with a link to
https://caballus.tech/shifts where the volunteer can offer to cover it, and
(2) a time-sensitive operational announcement from a rescue officer, such as a
farrier visit. Volunteers opt in when a coordinator registers them: SMS
consent is collected explicitly at invitation and recorded, as described at
https://caballus.tech/. There is no marketing and no public sign-up. Traffic
is very low — the app caps itself at 120 messages per rolling 24 hours — and
every message ends with "Reply STOP to stop."
```

A rejection is resolved by **editing and resubmitting the same campaign**,
never by creating a second one — a new campaign is a second vetting fee, and
the sole-proprietor brand only carries one anyway.

**The second rejection (2026-08-30, same 30886, two hours after resubmission)
was the page and not the words.** Vetting fetches the opt-in URL with no
JavaScript, and `/` answered every scriptless client the loading shell —
_One moment…_ — because the signed-out branch was decided by `/home`'s 401 in
a client-side effect. The consent language the form pointed at was invisible
to the one reader it was written for. The fix is in `src/routes/index.tsx`: a
cookie-less request gets the public page in the server's own HTML. Verify the
fix is actually serving before resubmitting a third time:
`curl -s https://caballus.tech/ | grep -c "What we send by text"` must answer
at least 1.

**Two more 30886 causes were found by reading the campaign in the console
rather than by rewriting the description again**, and both are the same fault:
a field that disagrees with the description beside it. 30886's own text asks
for a description matching "your selected campaign use case, sample messages,
and registered brand details", so a contradiction anywhere in that set is the
error, not only a vague description.

The **opt-in field** (_How do end-users opt in to receive messages?_) said end
users opt in by visiting the site, signing in and choosing to opt in "in the
future" — self-serve, and a roadmap. The description says the opposite in the
same campaign: a coordinator collects consent at invitation and there is no
public sign-up. The third attempt replaced it with an accurate account of the
coordinator's own act, and **that one was rejected too, with 30909** — a
different error, and the first sign of progress in three attempts, because
30886 was gone and the description had passed.

**30909 is the reviewer saying they cannot verify how anybody consented**, and
its companion codes are where the answer is: 30924 wants the required
disclosures inside the consent language itself, and 30921 is a flow behind a
login that no reviewer will ever see. An accurate description of an
unverifiable process is still unverifiable. Both are closed by one move —
`SMS_CONSENT` in `src/components/public.tsx`, quoted verbatim in the three
places that have to agree (#79): the checkbox a Volunteer Coordinator ticks in
`src/routes/admin/volunteers.tsx`, the public page at `/` where a reviewer with
no session reads the identical words, and the campaign field below. A
paraphrase in any one of them is the drift the constant exists to prevent, and
`src/routes/index.test.tsx` asserts each clause **by its words** rather than
against the constant, the way `privacy.test.tsx` and `terms.test.tsx` do.

This is the fourth attempt's text, recorded here for the same reason the
description and the samples are — plain ASCII, because a curly quote or an em
dash in a carrier form is a needless variable:

```
There is one opt-in path and no others. There is no public sign-up, no
web form, no keyword opt-in, and no purchased or shared list.

The workflow, start to finish: a Volunteer Coordinator at the horse
rescue brings a new volunteer on in person or by phone. The coordinator
opens the volunteer's record in the Caballus web app and reads them this
disclosure, word for word:

"Caballus will text you when a shift you could work is short, or when
there is rescue news that will not keep. Message frequency varies.
Message and data rates may apply. Reply STOP to stop and HELP for help.
Your sign-in codes are separate, and STOP never stops those."

The volunteer answers yes or no. The consent checkbox beside those words
is unchecked by default and is never pre-selected; the coordinator ticks
it only on a yes, and a no is recorded as a no. The date of the answer
is stored on the volunteer's record, and only a record carrying a
recorded yes is ever sent a message.

Reviewers can read the identical disclosure, quoted word for word and
without signing in, at https://caballus.tech/ under the heading "You
cannot sign yourself up". That page also links the privacy policy at
https://caballus.tech/privacy and the terms at
https://caballus.tech/terms.

A volunteer can reply STOP at any time, ask a coordinator to remove
their number, or remove it themselves once signed in.
```

The quoted paragraph in the middle of it is `SMS_CONSENT` exactly, which is the
point: a reviewer clicks the URL, reads the same paragraph under a heading of
its own, and the two cannot come apart without a test failing first.

The **operator's name** was the other one. The description said _Rob Heckart_;
the registered sole-proprietor brand is **Charles Heckart**, which is the legal
name on the ID that verified it. `Charles "Rob" Heckart` is what the
description now carries — true, and matching the brand a reviewer holds it
against. `src/components/landing.tsx` still says _Rob Heckart_ and that is
fine: it is the name the rescue's volunteers know, and the campaign is where
the legal one has to appear.

One thing the console showed that was **not** a vetting problem and was still
a send-time one: no phone number was assigned to the Messaging Service.
**Resolved 2026-09-02** — `+1 667 225 3977` (Annapolis, MD) is bought and is
the one sender on `MG…`. It stays written down because the failure it would
have caused is the one this section exists to prevent: a campaign approved, a
send that looks fine, and nothing to send it from.

The link is `APP_URL`, passed in from `src/server/urgent/send.ts` rather than
read by the composers — so a development send names `http://localhost:3000` and
never production, and a box with `APP_URL` unset composes the linkless sentence
rather than one naming `undefined`. **Never a shortener**: bit.ly and its kind
are the most reliable way to have a campaign blocked, because a carrier cannot
see where the link goes.

The link costs about thirty characters, which can push an **Announcement** —
which carries an officer's free text and is already the long one — from one
segment into two. That doubles what Twilio bills for it and what it counts
against the brand's thousand a day. It is worth knowing and is not worth a
limit: nothing truncates an officer's words to save a fifth of a cent, and the
app's own cap counts **sends** rather than segments, so `DAILY_CAP` is unmoved.

The **mobile-change notice** is the one text that is not an Urgent Send and it
carries no link, deliberately: it says _tell a coordinator_, which a link does
not help with.

**HELP and STOP auto-replies are a console setting, not code.** Twilio answers
both keywords for a US number by default; `src/server/sms.ts` only recognises
the 21610 a blocked send comes back with. Confirm the default is on for the
number before the canary, because `/terms` promises a HELP reply and this
repository is not what keeps that promise. Roughly $4 one-time, $15 campaign vetting and $2 a
month, plus a number at about $1.15 and messages at about $0.008 plus carrier
pass-through. **Campaign approval runs 3–7 business days.** Confirm the
no-EIN rule at the form before paying anything: one secondary source claims 2026
changed it, the vendor's own guide wins, and thirty seconds at the form beats a
rejected brand.

### Two Verify Services, not one

`TWILIO_VERIFY_SERVICE_SID` is the login door and
`TWILIO_VERIFY_CHANGE_SERVICE_SID` is `/me/mobile`. A code issued against one
cannot be checked against the other **at the vendor**, which is Verify's
spelling of the `change-email-otp-` separation ADR 0027 built for the address.
Creating the second Service in the console is free and takes a minute. Both are
required together: falling back to one for both purposes would fail on the day
somebody changed their number rather than at boot, which is the quietly-wrong
shape the pair exists to prevent.

**Both exist as of 2026-09-02**, under Identity & security > Verify >
Services: the login door is the one named **Caballus**, and `/me/mobile`'s is
**Caballus Number Change**. The SIDs are values and live in the vault with the
other three rather than here. Two things about the friendly name are worth
knowing before anybody renames one. It is **not** a console label — Verify puts
it in the message body, so the login code reads _Your Caballus verification
code is: 123456_ and the other reads _Your Caballus Number Change verification
code is:_, which is why the two cannot simply both be called Caballus. And
setting one at all requires ticking a warranty that you are authorised to use
that name and can show Twilio evidence within 72 hours, which is a statement a
person makes rather than a field a script fills.

The console enables the **Email** channel alongside SMS whether or not you ask
for it. Harmless — `src/server/auth/verify.ts` only ever calls the SMS channel
— and left alone rather than fought with.

### What is not done here, and cannot be

Everything above is paperwork against Twilio's console (#76) and none of it is
in this repository. What **is** here is the plumbing: the five variables in
`.env.example` and `deploy/.env.tpl`, the vault item above, and code that
refuses in words when they are unset. Adding a variable is still three files
(_Changing a secret_ above), and `deploy/.env.tpl` still has to be copied to the
box by hand.

**The canary is a person's job.** Once the campaign is approved, send one real
text from production and confirm it by eye on a real handset, then record it
here beside the restore rehearsal. Nothing automated can do that: unregistered
US A2P traffic is _silently filtered_ rather than rejected, so a
successful-looking send proves nothing at all.

**There is no inbound webhook, and that is deliberate.** Twilio honours STOP
itself and refuses the message; the application learns about it from the
refusal's own error code and stamps `volunteers.sms_stopped_at`, so the next
_this reaches 47 of 60_ is right. An endpoint for a stranger's POST is a real
surface, and ADR 0016 requires every one to be declared in the contract with an
authorization.

## What is deliberately not built yet

**1Password, past the first render.** The render itself is built — see
_Secrets are rendered from 1Password_ above — and two things around it are not.
The template on the box is a hand-copied file, so a variable added to
`deploy/.env.tpl` in the repository is not live until somebody `scp`s it; that
is the same gap `deploy/README.md` already names for the compose file and the
scripts, now with one more file behind it. And **the service-account token has no
rotation**. `op service-account create` takes `--expires-in` and this one was
created without it, on purpose — an expiry is a deploy that stops working on a
date nobody wrote down. The cost of that choice is a token that lives forever
until somebody replaces it by hand, and nothing reminds them to. The render
fails loudly rather than silently, which is the part that had to be true first.

**Outgoing mail.** `SMTP_URL` is empty, which means no transport at all and a
sign-in that fails loudly rather than appearing to work. **Nobody can sign in
until a Fastmail app password is in place**, because an emailed code is the
only credential there is (ADR 0009).

**Monitoring.** No Uptime Kuma check yet. `/health` exists for it to call.

**Zero-downtime deploys.** The application container is stopped and started, so
Traefik answers 502 for a few seconds. At maintainer-and-testers scale that
costs nothing; starting the new container alongside and cutting over after
health is the upgrade when it stops being free.
