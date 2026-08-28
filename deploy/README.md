# The VPS stack

What is installed at `/docker/caballus/` on the box, kept here so that a change
to it is reviewed and versioned like anything else. `docs/deploy.md` is the
runbook that explains it.

The box's copy is installed by hand — `scp` these five files, then
`chmod 755` the scripts. There is no mechanism that keeps the two in step yet,
so a change here is not live until it is copied; that is a real gap and it is
named rather than papered over. `.env.tpl` is now one of the five, which makes
the gap bite harder: a variable added to the template in the repository is not
on the box until it is copied there, and the render that follows will not know
about it.

`.env` is **not** here and never will be. It is **rendered** on the box by
`render-env.sh`, from `.env.tpl` through a 1Password service account, at deploy
time and never at startup (ADR 0006). `.env.example` in the repository root
stays the list of what a machine needs; `.env.tpl` is that list again, saying
for each entry whether the value is a literal this repository decided or an
`op://` reference only the deployment knows.

`op-token` is not here either, for the ordinary reason: it is the service
account's token, placed on the box by hand at `chmod 600`, and it is the one
secret 1Password cannot hold for us.
