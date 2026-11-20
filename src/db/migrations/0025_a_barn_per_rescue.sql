-- Where the barn is becomes a fact about each rescue rather than about the
-- deployment (#113, ADR 0030): the two coordinates leave the environment for
-- these two columns, nullable, set by
-- `npm run bootstrap -- --org <id> --barn <lat>,<lon>`.
--
-- **Weather refuses for the existing rescue until that is run.** Nothing here
-- copies the old variables in, because a migration cannot read the box's
-- environment; `docs/deploy.md` makes it the step straight after this deploy.
ALTER TABLE "orgs" ADD COLUMN "barn_latitude" numeric;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "barn_longitude" numeric;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_barn_both_or_neither" CHECK (("orgs"."barn_latitude" is null) = ("orgs"."barn_longitude" is null));--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_barn_on_the_globe" CHECK ("orgs"."barn_latitude" between -90 and 90 and "orgs"."barn_longitude" between -180 and 180);