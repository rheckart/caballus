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

**CI is at home, on OMV8**, which is where Forgejo itself runs. ADR 0007 puts
it there and never on the VPS: a dependency install, a Docker build and a
Postgres-backed suite are real contention, and evening shift is exactly when
code gets pushed. The VPS only ever pulls.

The runner is `forgejo_runner` in the `forgejo` compose stack, with a
`docker:dind` sidecar. Two facts about it are load-bearing and neither is
obvious:

- **`runs-on: ubuntu-latest` gets `data.forgejo.org/oci/node:20-bullseye`** —
  Debian 11, running as root, with Node 20, `git` and `curl`, and **without**
  `docker` or `psql`. Both are installed by the workflow that needs them.
  Node 24 comes from `actions/setup-node`, which reaches GitHub and works.
- **The Docker daemon a job can reach is the workflow network's own gateway.**
  The runner creates job containers on its DinD sidecar, so from inside one the
  daemon answers on `tcp://<gateway>:2375`. The gateway is read out of
  `/proc/net/route` at runtime rather than hard-coded, because the network is
  created fresh per workflow and the address moves with it.

## The three workflows-worth of secrets

Actions secrets must be set by the repository **owner**; a token belonging to
anyone else gets `403 user should be the owner of the repo` from the API.

| Secret           | What it is                                                    |
| ---------------- | ------------------------------------------------------------- |
| `REGISTRY_USER`  | A Forgejo username that may write packages under `rob/`.       |
| `REGISTRY_TOKEN` | That user's access token, with package read and write.         |
| `VPS_SSH_KEY`    | The private half of the deploy key described below.            |

**A token may only write packages under its own user's namespace.** Before
`REGISTRY_TOKEN` existed the `claude` token logged in fine and got `401` pushing
to `rob/caballus`, while `claude/caballus` succeeded — so the first images were
published there. `deploy.sh` reads `REGISTRY_IMAGE` out of `.env` rather than
fixing the repository in the script, which is what made moving to
`git.heckart.me/rob/caballus` one line on the box once the owner's token was a
secret.

The built-in `secrets.GITHUB_TOKEN` was tried first and **does not work**: it
logs in to the registry and then gets `401 Unauthorized` on the first blob
upload. It has no package-write scope, so a real token is required.

The VPS host key is written into `deploy.yml` in the clear rather than kept as
a secret. A public key is public, and pinning it means a box that was silently
recreated fails the deploy loudly instead of trusting whatever answers — which
has already happened once here: the VM was recreated on 2026-08-14 and its host
key changed with it.

## The deploy key can only deploy

`/root/.ssh/authorized_keys` on the VPS carries the CI key with a forced
command:

```
command="/docker/caballus/deploy-ssh.sh",restrict ssh-ed25519 AAAA… forgejo-actions-deploy@caballus
```

So a key that leaks out of a Forgejo secret can deploy a tag and cannot open a
shell, read `/docker` or reach the database. `deploy-ssh.sh` extracts the tag
out of `SSH_ORIGINAL_COMMAND` and refuses anything else, and `deploy.sh` checks
the tag against a tag's own alphabet before it becomes part of a command.

One trap, met the hard way: **the file had no trailing newline**, so appending a
key with `echo >>` concatenated it onto the end of the previous line, where
sshd read it as that key's comment. It looked installed and was not. Append
with `printf '%s\n'` and check with `awk '{print NR}'`, not `grep`.

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
`git.heckart.me/rob/caballus:<twelve-character commit>` and `:latest`.

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

## Two things about this runner, learned by running into them

**`ci.yml` is not dispatchable, on purpose.** It carried `workflow_dispatch` and
the button could not work: a dispatched run failed to plan the workflow at all —
*'runs-on' key not defined in ci/verify*, before a step executed — and skipped
`publish` on a `github.ref` it evaluated differently from a push. `deploy.yml`
dispatches correctly, and the difference is shape: one job, no `needs`, no `if`.
So `ci.yml` answers a push and nothing else, and the broken button is gone
rather than documented.

**The push retries, because the registry is behind a home tunnel.** Publishing
failed once with every layer uploaded and then `failed commit on ref
"layer-sha256:…": net/http: timeout awaiting response headers` — the blob commit
took longer than the client's thirty-second wait. The heavy layer is
`node_modules`; the runtime stage now installs `--omit=dev` fresh instead of
copying the build stage's tree, which took the image from 751 MB to 676 MB, and
`drizzle-kit` and `jiti` moved to `dependencies` because a migration and the
bootstrap are production acts run from this image.

676 MB is less of a saving than it looks like it should be: `better-auth`
depends on `vitest` and `@tanstack/react-start` on `prettier`, so both are
genuinely in the production tree. The rest is a five-attempt retry, which
resumes against blobs the registry already holds. It bites at most once per
dependency change — a push that does not move `package-lock.json` never sends
that layer again.

## Rolling back

Deploy the previous tag. `grep CABALLUS_IMAGE /docker/caballus/.env` says what
is running now; the registry holds every commit that was ever published.

A rollback across a migration is **not** automatic and never will be by this
script: Drizzle's migrations are forward-only, and a schema the old image does
not understand is a decision, not a button.

## `/health`

`GET /health` is answered by `scripts/serve.mjs` **ahead of** the application
handler, and deliberately. ADR 0016 requires every endpoint the application
serves to be declared in `src/shared/api-contract.ts` with an authorization,
and there is no public one — inventing it would widen ADR 0010's two axes for
an operations probe that is not a domain read. Answering ahead of the handler
also means it still answers when the handler is the broken thing.

It opens a real connection of its own and runs `select 1`: 200 with
`{"status":"ok"}`, or 503. It is unauthenticated and says up or down, never
why; the reason goes to stdout.

**It does not yet report the age of the last backup**, which is the other half
of what ADR 0006 asks of it. That lands with the backup job, because a field
reporting on a job that does not exist would report a reassuring nothing.

## What is deliberately not built yet

**Backups.** ADR 0006 wants `pg_dump` every fifteen minutes and a nightly full
to MEGA S4, thirty-day retention, and a restore rehearsed by hand **before the
first real horse is entered**. None of it exists. The rclone machinery is
already on OMV8 (`rclone-mega-s3-mount`, `rclone-backup-worker`), so the next
ticket has somewhere to start. Until it lands, the only durability is
Hostinger's weekly snapshot, which ADR 0006 already names as a floor to fall
back on rather than a plan.

**1Password.** ADR 0006 wants `.env` rendered by `op inject` at deploy time.
For the first cut it is a file placed by hand, `chmod 600`. Swapping it in is a
deploy-script change, not a redesign, and 1Password stays out of the startup
path either way: a 6am restart must not depend on a service-account token that
quietly expired.

**Outgoing mail.** `SMTP_URL` is empty, which means no transport at all and a
sign-in that fails loudly rather than appearing to work. **Nobody can sign in
until a Fastmail app password is in place**, because an emailed code is the
only credential there is (ADR 0009).

**Monitoring.** No Uptime Kuma check yet. `/health` exists for it to call.

**Zero-downtime deploys.** The application container is stopped and started, so
Traefik answers 502 for a few seconds. At maintainer-and-testers scale that
costs nothing; starting the new container alongside and cutting over after
health is the upgrade when it stops being free.
