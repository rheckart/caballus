# Every rescue this deployment serves, one per line (ADR 0030, #116).
#
# `render-env.sh` renders this through 1Password, checks every line, and
# assembles the lines into the two things that must never disagree: the
# application's `RESCUES` map and Traefik's router rule, which is how every
# host gets routed to the one app service with a certificate from its resolver. They
# are written into `.env` together, from this one list.
#
# Each line is a JSON object:
#
#   host        the host the rescue is reached at, as a browser sends it
#   orgId       the organisation id `npm run bootstrap` printed for it
#   boardToken  its barn tablet's kiosk token; leave the key out until there
#               is a tablet to enrol
#   sms         true for the one rescue the Twilio sender is registered for
#               (ADR 0028), and absent for every other — a rescue without it
#               texts nothing and says so (#113)
#
# Every value that only the deployment knows is a reference into that rescue's
# own 1Password item, which is named `rescue-` and the rescue's slug, with the
# fields `host`, `org-id` and `board-token`. `docs/deploy.md`, under _Adding a
# rescue_, is the whole procedure.
#
# Adding a line is a deploy, deliberately — the way a migration is (ADR 0007).
#
# Nothing in this file may write the reference scheme outside a moustache, not
# even inside a comment: `op inject` scans the whole file for it and fails on a
# bare one. That is why this header says "reference" instead of showing one.

{"host":"{{ op://Caballus/rescue-freedom-hill/host }}","orgId":"{{ op://Caballus/rescue-freedom-hill/org-id }}","boardToken":"{{ op://Caballus/rescue-freedom-hill/board-token }}","sms":true}
