# Issue tracker: Forgejo (self-hosted)

Issues, specs and PRs for this repo live on the self-hosted Forgejo at
**`https://git.heckart.me/rob/caballus`**.

There is **no `gh`, `glab` or `tea` CLI on this machine.** All operations go through the
**`forgejo-mcp` MCP tools**. Every call takes `owner: "rob"` and `repo: "caballus"`.

The tool schemas are deferred — load them first with
`ToolSearch({query: "select:mcp__forgejo-mcp__<name>,..."})` before calling.

## Conventions

- **Create an issue**: `mcp__forgejo-mcp__create_issue` — `{owner, repo, title, body, labels?}`
- **Read an issue**: `mcp__forgejo-mcp__get_issue_by_index` — `{owner, repo, index}`, then
  `mcp__forgejo-mcp__list_issue_comments` for the thread.
- **List issues**: `mcp__forgejo-mcp__list_repo_issues` — `{owner, repo, state, labels?, type?}`.
  Pass `type: "issues"` to exclude PRs (see the shared number space below).
- **Comment**: `mcp__forgejo-mcp__create_issue_comment` — `{owner, repo, index, body}`
- **Apply / remove labels**: `mcp__forgejo-mcp__add_issue_labels` /
  `mcp__forgejo-mcp__remove_issue_labels`
- **Close / reopen**: `mcp__forgejo-mcp__issue_state_change`
- **List available labels**: `mcp__forgejo-mcp__list_repo_labels`

Pull requests have their own tools: `create_pull_request`, `get_pull_request_by_index`,
`get_pull_request_diff`, `list_repo_pull_requests`, `merge_pull_request`.

Forgejo shares one number space across issues and PRs (`#54` is a PR here, `#48` an issue).
Resolve an ambiguous `#n` with `get_issue_by_index` and check whether the result carries a
`pull_request` object.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature
requests; `/triage` reads this flag.)_

This is a solo repo behind a private Forgejo — every PR is authored by the owner or by Claude
on the owner's behalf, so there is no external request queue to triage.

## When a skill says "publish to the issue tracker"

Create a Forgejo issue with `mcp__forgejo-mcp__create_issue`.

## When a skill says "fetch the relevant ticket"

`mcp__forgejo-mcp__get_issue_by_index`, then `mcp__forgejo-mcp__list_issue_comments`.

## Blocking edges

Forgejo has no native issue-dependency API exposed through this MCP server. This repo's
established convention — already used across #34–#48 — is a **`## Blocked by` section at the
bottom of the child issue body**, listing one `- #<n>` per blocker:

```markdown
## Blocked by

- #36
- #44
```

A ticket is unblocked when every issue listed there is closed. To compute the frontier: list
open issues, parse each body's `## Blocked by` list, and drop any ticket with a blocker still
open.

Issues created by `/to-tickets` also carry a `## Parent` section naming the spec issue
(`Spec: #32`), which is how a ticket points back at the spec it came from.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue; tickets are child issues pointing back at it.

- **Map**: one issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: an issue with `Part of #<map>` at the top of its body and an entry in the
  map body's task list. Labels: `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, or `wayfinder:task`.
- **Blocking**: the `## Blocked by` convention above.
- **Frontier query**: `list_repo_issues` with `state: "open"`, scoped to the map's task list;
  drop any with an open blocker or an assignee; first in map order wins.
- **Claim**: `mcp__forgejo-mcp__update_issue` to set the assignee — the session's first write.
- **Resolve**: `create_issue_comment` with the answer, `issue_state_change` to close, then
  append a context pointer to the map's Decisions-so-far.

The `wayfinder:*` labels already exist in this repo.
