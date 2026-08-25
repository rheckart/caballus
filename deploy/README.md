# The VPS stack

What is installed at `/docker/caballus/` on the box, kept here so that a change
to it is reviewed and versioned like anything else. `docs/deploy.md` is the
runbook that explains it.

The box's copy is installed by hand — `scp` these three files, then
`chmod 755` the scripts. There is no mechanism that keeps the two in step yet,
so a change here is not live until it is copied; that is a real gap and it is
named rather than papered over.

`.env` is **not** here and never will be. It is placed on the box by hand,
`chmod 600`, with 1Password as the source of truth (ADR 0006); `.env.example`
in the repository root is the list of what a machine needs.
