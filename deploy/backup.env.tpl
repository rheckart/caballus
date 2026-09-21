# What `backup.env` on the box is rendered from, by `render-env.sh`, beside
# `.env` and by the same rule: the repository decides the literals, 1Password
# holds what only the deployment knows.
#
# A file of its own rather than more lines in `.env.tpl`, because `.env` is the
# application container's environment and the application has no business
# holding a key that can delete the backups. Only `backup.sh` reads this.
#
# Rendered only when this template is on the box, so a deploy never fails on a
# vault item that does not exist yet (docs/deploy.md, Backups). The same trap
# as `.env.tpl` applies: nothing here may write the reference scheme outside a
# moustache, even in a comment.

# rclone's own configuration-by-environment: a remote named `s4`.
RCLONE_CONFIG_S4_TYPE=s3
RCLONE_CONFIG_S4_PROVIDER=Mega
# Montreal, ADR 0006's region, for proximity on the one occasion that matters.
RCLONE_CONFIG_S4_ENDPOINT=https://s3.ca-central-1.s4.mega.io
RCLONE_CONFIG_S4_ACCESS_KEY_ID={{ op://Caballus/s4/access-key-id }}
RCLONE_CONFIG_S4_SECRET_ACCESS_KEY={{ op://Caballus/s4/secret-access-key }}
# The key is scoped to one bucket that already exists, so rclone is told not to
# try creating it on every upload.
RCLONE_CONFIG_S4_NO_CHECK_BUCKET=true

# A literal, by the rule above: the name was chosen, not issued, and a box
# rebuilt from nothing reads it off the checkout.
CABALLUS_BACKUP_BUCKET=caballus-db-backup
