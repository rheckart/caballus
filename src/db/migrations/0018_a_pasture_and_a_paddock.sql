-- A Pasture and a Paddock are different places (ADR 0002's amendment, #57).
--
-- `field` is renamed rather than kept as a fourth value: a horse turned out is
-- in a Pasture *and* the Paddock attached to it, and a horse holds at most one
-- Space per kind, so the one kind could never have said both. Nothing is in
-- production, so this is a rewrite of a text column and no data is at risk —
-- and `kind` is stored on `horse_space_assignments` independently of the
-- Space's own, so both have to move together or the primary key would disagree
-- with the join.
UPDATE "spaces" SET "kind" = 'pasture' WHERE "kind" = 'field';
--> statement-breakpoint
UPDATE "horse_space_assignments" SET "kind" = 'pasture' WHERE "kind" = 'field';
