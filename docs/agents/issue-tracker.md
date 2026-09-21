# Issue tracker: GitHub

Issues, specs and PRs for this repo live on GitHub at
**`https://github.com/rheckart/caballus`** (private).

**Use the `gh` CLI for all of it.** It is installed through mise and authenticated as
`rheckart`; if `gh` is not on the PATH, prefix every command with `mise exec gh --`. Run it
from inside the repo and it resolves the repo from the `origin` remote, so no `-R` flag is
needed.

## History, before anything else

The repo lived on a self-hosted Forgejo until 2026-09-21, when that Forgejo's database was
found ten days behind its git data. **Issues #1–#101 were recreated here under their original
numbers**, so a `#n` in a commit message or an ADR still points at the right thing. Old PRs
could not be recreated as PRs: they are **closed issues titled `[PR] …`**, carrying the
original description and a link to the Forgejo record. Each imported issue ends with an
_Imported from Forgejo_ footer, and each imported comment names its Forgejo author.

The `forgejo` git remote is kept for reference and is **not** the tracker. Never file an issue
there, and never use `fj` or the `forgejo-mcp` tools for this repo.

**GitHub shares one number space across issues and PRs**, as Forgejo did. `gh issue view <n>`
on a PR number may not show it as a PR; use `gh pr view <n>`.

## Issues

```
gh issue list                               # open issues, the default
gh issue list --state all --limit 200       # every issue
gh issue list --label ready-for-agent
gh issue list --search "landing page"
gh issue view 68                            # title, body, labels
gh issue view 68 --comments                 # and the thread
```

Writing:

```
gh issue create --title "<title>" --body-file <path>
gh issue comment 68 --body-file <path>
gh issue edit 68 --title "<new title>"
gh issue edit 68 --body-file <path>
gh issue edit 68 --add-label ready-for-agent --remove-label needs-triage
gh issue close 68 --comment "done in #77"
gh issue edit 68 --add-assignee <user>
```

**Always pass `--title` and `--body-file`** (or `--body`) on create. Leaving them out opens an
interactive prompt, which in a non-interactive session hangs.

**Write the body to a file first.** Issue bodies here run to several hundred words of Markdown
with backticks and `#n` references; a heredoc to the scratchpad and then `--body-file` avoids
every shell-quoting problem.

## Pull requests

```
gh pr list
gh pr view 54                # title and body
gh pr diff 54
gh pr view 54 --json files
gh pr view 54 --json commits
gh pr view 54 --comments
gh pr checks 54              # CI
gh pr create --base main --title "<title>" --body-file <path>
gh pr checkout 54
gh pr comment 54 --body-file <path>
gh pr review 54 ...
gh pr merge 54 --merge       # a merge commit, as the history has always used
```

## Labels

```
gh label list
gh label create <name> --color <hex> --description "<text>"
```

The five canonical triage labels are in `docs/agents/triage-labels.md`. The `wayfinder:*`
labels already exist in this repo.

## Conventions

### Blocking edges

This repo's established convention — kept from its Forgejo years rather than swapped for GitHub's sub-issues, and used across
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

This is a solo, private repo — every PR is authored by the owner or by Claude
on the owner's behalf, so there is no external request queue to triage.

### When a skill says "publish to the issue tracker"

`gh issue create --title "<title>" --body-file <path>`.

### When a skill says "fetch the relevant ticket"

`gh issue view <n> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue; tickets are child issues pointing back at
it.

- **Map**: one issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: an issue with `Part of #<map>` at the top of its body and an entry in the
  map body's task list. Labels: `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, or `wayfinder:task`.
- **Blocking**: the `## Blocked by` convention above.
- **Frontier query**: `gh issue list --state open`, scoped to the map's task list; drop any with an
  open blocker or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee <user>` — the session's first write.
- **Resolve**: `gh issue comment <n> --body-file <path>` with the answer, `gh issue close <n>`, then append a
  context pointer to the map's Decisions-so-far.
