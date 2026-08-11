---
status: accepted
---

# Everything runs on the existing VPS, and the backups are ours to write

App and Postgres both run in Docker on the Hostinger VPS that already hosts Forgejo. There is no managed database, no managed application platform, and no second server. Durability comes from `pg_dump` every fifteen minutes to offsite object storage, not from the host.

This is a **proof of concept**, and the decision is scoped to that. The tripwire that ends it, and what it re-opens, is recorded below.

## Considered options

**Managed Postgres behind an app on the VPS** was the recommendation, on one argument: with nobody else holding credentials, the failure that cannot be recovered from is data loss, not downtime — so outsource the data and keep the ops on the half that is cheap to redeploy. Verification killed it.

**Neon** grants 100 CU-hours per project per month on its free plan, about 400 awake-hours against a 730-hour month. ADR 0004 puts a tablet in the barn **polling the Board every 30–60 seconds**, which never lets a scale-to-zero compute sleep. The cap would be reached around the sixteenth of every month and the project **suspended** — connections dropped, new ones refused, until the next monthly window. Not degraded: off. Keeping 0.25 CU alive deliberately costs roughly $77/month at $0.106/CU-hour, three times the ceiling this project set itself. The free point-in-time-restore window is six hours, so a corruption discovered on a Monday could not be undone anyway.

**Supabase** has no compute cliff and its inactivity pause needs seven idle days, which will not happen here. But the free plan includes **no automated backups**; Supabase's own guidance is to schedule `db dump` and keep it offsite yourself. Backups begin at Pro, $25/month, which is the entire hosting budget spent on one component.

So the argument collapsed on a single observation: **the backup job gets written in every branch.** Once that is true, managed Postgres stops paying for itself and starts charging a cold start, an egress cap, a suspension cliff, and a second vendor account under a personal identity whose ownership is deliberately unresolved.

**A second, separate VPS** was considered to isolate Caballus from Forgejo. It buys blast-radius isolation and nothing else — every layer is still ours to run — and it costs a second bill. Declined at POC stakes, listed below as a risk.

## Consequences

**The reliability promise is RTO ≈ 1 hour inside shift windows, RPO ≤ 1 hour** — and it is a promise about the **read** path. The write path already degrades gracefully: ADR 0005's client-minted idempotency keys make the phone's retry queue safe, so ticks survive an outage in a volunteer's pocket. What has no fallback is a Lead at 6am needing to see which horses get medication, once the whiteboard is no longer being maintained.

**That RTO covers container failure and data corruption. It does not cover loss of the host.** With one server and one offsite copy, "Hostinger loses the box" is provision-and-restore: hours, not one hour. A second copy pulled to hardware at home was offered and declined. This is a stated trade, not an oversight.

**Backups are the durability story, and Hostinger's weekly snapshot is not.** Up to seven days of RPO is a floor to fall back on, not a plan. `pg_dump` every fifteen minutes plus a nightly full go to MEGA S4 `ca-central-1` with thirty-day retention. The database is a few thousand rows — under 50 MB with a year of ticks — which is precisely why the schedule can be this aggressive and the restore this fast.

**A restore is rehearsed by hand before the first real horse is entered, and the commands as they actually ran are the runbook.** An unrehearsed restore is a multi-hour improvisation at the worst possible moment, which means the one-hour RTO above is only real if this happens. Automated verification — restore last night's dump into a scratch database and count rows — follows, because a backup that has been silently failing for three weeks is worse than no backup: it is a backup being counted on.

**1Password is the source of truth for secrets and is never in the startup path.** A service account renders a real `.env` onto the box with `op inject` at **deploy** time. Starting the container under `op run` would make a 6am restart depend on 1Password's API and on a service-account token that has not quietly expired — a new single point of failure, added in the name of hygiene, at the exact hour that matters. The session signing key must survive a restore: rotating it signs out every volunteer at once, and ADR 0004 made sessions effectively permanent so that never happens.

**Photos live in S4 and are served through the app behind Cloudflare.** MEGA S4 includes egress at five times stored bytes — a ratio, not an allowance — so a bucket holding only a few megabytes of photos would include almost no egress. Proxying with cache headers means repeat views never reach S4, and the URLs stay ours, so changing provider is a config change. No presigned URL outlives its session; those get forwarded into group chats exactly like the SMS links ADR 0004 already guards.

**S4 has no US region.** Montreal is chosen for proximity on the one occasion that matters — restoring under the clock. Volunteer names and mobile numbers therefore sit on Canadian infrastructure. A footnote at this scale, but one the rescue's board should hear once rather than discover. Prefer a US region if one appears.

**Monitoring lives off the box it watches** — Uptime Kuma on a home server, on a UPS, texting one person. `/health` opens a real database connection and reports the age of the last successful backup, so the check proves the app *and* its data path *and* that last night's dump happened. It is unauthenticated and says up or down, never why. **A home ISP outage produces silence rather than an alert**, and silence reads identically to everything being fine; a dead-man's-switch heartbeat is the cheap fix, deferred.

**Caballus shares a kernel and a disk with the git host.** Accepted at POC stakes and listed for re-decision.

**Nothing here depends on a proprietary runtime.** The app runs from a plain Dockerfile against plain Postgres, so every option rejected above remains available later as a redeploy rather than a rewrite. That is what makes this decision safe to be wrong about.

# The POC ends when the whiteboard stops being maintained

"POC" is a status that expires silently. The classic failure is that the thing works, people start relying on it, and nobody ever declares go-live — so the tripwire is named now, while it costs nothing.

The tripwire is **the whiteboard ceasing to be maintained in parallel**. The early warning is a volunteer who is not the maintainer completing real work in the app during a real shift. While the board is current, an outage is an inconvenience; the morning after it stops, an outage is horses not getting medication.

Tripping it re-opens **hosting, backups and monitoring as a block** — specifically the second copy, the second host, the co-location with Forgejo, and the dead-man's switch. The whiteboard is not to be retired until those are re-decided.

Until then: real horse data transcribed from the board, no volunteer accounts, exposure limited to the maintainer and an officer or two. The data is not throwaway — the go-live migration begins with the first horse entered, because the board being transcribed has already demonstrated that it erases its own history.
