-- An Account belongs to one rescue (#111, ADR 0030): every Better Auth `user`
-- is rewritten to the opaque key of the Volunteer that claimed it, so no
-- `user.email` in the database is a deliverable address after this runs.
--
-- **This ships in a later deploy than the code that reads it**, and the order
-- is load-bearing. The release before #111 signs in by the real address, and
-- `deploy/deploy.sh` can roll an image back after migrations have run: that
-- release against rewritten rows would mint a fresh `user` for every sign-in,
-- and `claimAccount` refuses it. The release that resolves the identifier from
-- the Volunteer (`accountIdentifier` in `src/server/auth/volunteers.ts`) signs
-- in on both sides of this migration, so it goes out first, on unmigrated
-- data. Rolling back past this migration means rolling back to that release,
-- never earlier — `docs/deploy.md` says so where a rollback is described.
--
-- The key is `accountKey` in `src/server/auth/volunteers.ts`, spelled here in
-- SQL: the Volunteer's id at `account.invalid`. Two spellings of one rule, so
-- `src/server/auth/account-keys.test.ts` asserts they agree.
--
-- **Sessions survive.** A session points at `user.id` and never at an address,
-- so nobody is signed out by this deploy.

-- One `user` linked to Volunteers in two organisations cannot be keyed by
-- either: whichever key it took, the other rescue's Volunteer would be signing
-- in on somebody else's Account. Unreachable with one rescue, which is the
-- only state this has ever run against — and if it is ever not, that is a
-- person's decision about two rescues' records, so the migration stops and
-- says so rather than choosing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "volunteer_accounts" GROUP BY "user_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A Better Auth user is claimed by more than one Volunteer; '
      'it cannot be keyed by one of them (ADR 0030). Resolve by hand before migrating.';
  END IF;
END
$$;--> statement-breakpoint

-- A `user` nobody claimed: left behind by a sign-in whose claim threw, and
-- reachable by nothing once identifiers resolve from the Volunteer. Deleted
-- rather than keyed, because there is no Volunteer to key it by; its sessions
-- go with it on the cascade, and they resolved to nobody already.
DELETE FROM "user"
WHERE "id" NOT IN (SELECT "user_id" FROM "volunteer_accounts");--> statement-breakpoint

-- Every claimed one, revoked links included: the gate refuses a revoked
-- Volunteer before an identifier is asked for, and a revoked Account keyed by
-- a real address would still be a `user.email` somebody could receive at.
UPDATE "user"
SET "email" = "volunteer_accounts"."volunteer_id"::text || '@account.invalid',
    "updated_at" = now()
FROM "volunteer_accounts"
WHERE "volunteer_accounts"."user_id" = "user"."id"
  AND "user"."email" <> "volunteer_accounts"."volunteer_id"::text || '@account.invalid';
