# Issue tracker: Forgejo (self-hosted)

Issues, specs and PRs for this repo live on the self-hosted Forgejo at
**`https://git.heckart.me/rob/caballus`**.

**Use the `fj` CLI for all of it.** It is installed at `~/.cargo/bin/fj` and already
authenticated — `fj whoami` says `claude@git.heckart.me`. Run it from inside the repo and it
resolves the host and repo from the git remote, so no `--repo` or `--host` flag is needed.

There is no `gh`, `glab` or `tea` CLI here, and none is wanted.

> The `forgejo-mcp` MCP tools are still connected and still work. Prefer `fj`: it is one Bash
> call against the same API, it needs no `ToolSearch` round-trip to load a deferred schema, and
> it reads the remote instead of taking `owner` and `repo` on every call. Reach for the MCP
> tools only for something `fj` has no verb for.

## Two gotchas, before anything else

**`fj` wraps every value it prints in Unicode directional isolates** — U+2068 before and U+2069
after — in _every_ style, `--style minimal` included. So `#78` comes back as `#⁨78⁩`, and a
naive parse of the issue number picks up two invisible characters.

Strip them before using output as data, and **never paste `fj` output verbatim into a file in
this repo**:

```
fj issue search -s open | perl -CSD -pe 's/[\x{2066}-\x{2069}]//g'
```

`npm run check:control-bytes` will not catch these — they are not C0/C1 control bytes — so
nothing downstream saves you.

**Forgejo shares one number space across issues and PRs** (`#54` is a PR here, `#48` an issue).
`fj issue view <n>` on a PR number fails; try `fj pr view <n>`.

## Issues

```
fj issue search                          # open issues, the default
fj issue search -s all                   # every issue
fj issue search -s open -l ready-for-agent
fj issue search "landing page"           # text query
fj issue view 68                         # title and body
fj issue view 68 comments                # the thread
fj issue view 68 assignees
```

Writing:

```
fj issue create "<title>" --body-file <path> --no-template
fj issue comment 68 --body-file <path>
fj issue edit 68 title "<new title>"
fj issue edit 68 body --body-file <path>          # or pass the body inline
fj issue edit 68 labels -a ready-for-agent -r needs-triage
fj issue close 68 -w "done in #77"
fj issue assign 68 <user>
```

**Always pass `--body-file` or an inline body.** Leaving the body out opens `$EDITOR`, which in
a non-interactive session hangs.

**Always pass `--no-template` on create** unless you mean to use a template
(`fj issue templates` lists them).

**Write the body to a file first.** Issue bodies here run to several hundred words of Markdown
with backticks and `#n` references; a heredoc to `/tmp` and then `--body-file` avoids every
shell-quoting problem.

`fj issue view` has no `labels` subcommand — to check an issue's labels, search by label, or
use `fj pr view <n> labels` for a PR.

## Pull requests

```
fj pr search
fj pr view 54                # title and body
fj pr view 54 diff
fj pr view 54 files
fj pr view 54 commits
fj pr view 54 comments
fj pr status 54              # mergeability and CI
fj pr create ...
fj pr checkout 54
fj pr comment 54 --body-file <path>
fj pr review ...
fj pr merge 54
```

## Labels

```
fj repo labels view
fj repo labels create ...
```

The five canonical triage labels are in `docs/agents/triage-labels.md`. The `wayfinder:*`
labels already exist in this repo.

## Conventions

### Blocking edges

Forgejo has no native issue-dependency API. This repo's established convention — used across
`#34`–`#48` and again on `#74`–`#78` — is a **`## Blocked by` section at the bottom of the child
issue body**, listing one `- #<n>` per blocker:

```markdown
## Blocked by

- #36
- #44
```

A ticket is unblocked when every issue listed there is closed. To compute the frontier: list
open issues, read each body's `## Blocked by` list, and drop any ticket with a blocker still
open.

Issues created by `/to-tickets` also carry a `## Parent` section naming the spec issue
(`Spec: #32`), which is how a ticket points back at the spec it came from.

### Ticket shape

Match the house style, which `#68` and `#77` are good examples of: a paragraph or two of
context naming the ADR that decided it, a `## What lands` section, a `## Acceptance` checklist
ending in `npm run verify` passes, and a `## Blocked by` section when there is one.

### PRs as a triage surface: no

_(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this
flag.)_

This is a solo repo behind a private Forgejo — every PR is authored by the owner or by Claude
on the owner's behalf, so there is no external request queue to triage.

### When a skill says "publish to the issue tracker"

`fj issue create "<title>" --body-file <path> --no-template`.

### When a skill says "fetch the relevant ticket"

`fj issue view <n>`, then `fj issue view <n> comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue; tickets are child issues pointing back at
it.

- **Map**: one issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: an issue with `Part of #<map>` at the top of its body and an entry in the
  map body's task list. Labels: `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, or `wayfinder:task`.
- **Blocking**: the `## Blocked by` convention above.
- **Frontier query**: `fj issue search -s open`, scoped to the map's task list; drop any with an
  open blocker or an assignee; first in map order wins.
- **Claim**: `fj issue assign <n> <user>` — the session's first write.
- **Resolve**: `fj issue comment <n>` with the answer, `fj issue close <n>`, then append a
  context pointer to the map's Decisions-so-far.
