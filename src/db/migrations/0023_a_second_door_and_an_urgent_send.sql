ALTER TABLE "announcements" ADD COLUMN "urgent_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "urgent_sent_by" uuid;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "urgent_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "urgent_sent_by" uuid;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "sms_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "sms_consent_recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "sms_stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_urgent_sent_by_volunteers_id_fk" FOREIGN KEY ("urgent_sent_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_urgent_sent_by_volunteers_id_fk" FOREIGN KEY ("urgent_sent_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_sms_consent_recorded_by_volunteers_id_fk" FOREIGN KEY ("sms_consent_recorded_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ADR 0029 turns `volunteers.mobile` from decoration into a credential: a code
-- sent there signs somebody in, so it is compared exactly and held by at most
-- one live Volunteer. ADR 0009 collected it as free text and wrote down that
-- backfilling sixty of these later is the chore that never happens. This is
-- that chore, done here rather than left: without it a volunteer whose number
-- is stored as `(410) 555-0134` cannot use the second door, `isReachable`
-- counts them as reachable, and the raw string is what reaches the carrier.
--
-- The rules are `normaliseMobile` in `src/shared/mobile.ts`, in SQL. Anything
-- that cannot be read as a number becomes NULL — an unusable string in a
-- credential column is worse than an empty one, and a Coordinator re-entering
-- it is one screen.
UPDATE "volunteers" SET "mobile" = (
  CASE
    WHEN btrim("mobile") = '' THEN NULL
    WHEN btrim("mobile") LIKE '+%' THEN
      CASE
        WHEN length(regexp_replace("mobile", '\D', '', 'g')) BETWEEN 8 AND 15
          THEN '+' || regexp_replace("mobile", '\D', '', 'g')
      END
    WHEN length(regexp_replace("mobile", '\D', '', 'g')) = 10
      THEN '+1' || regexp_replace("mobile", '\D', '', 'g')
    WHEN length(regexp_replace("mobile", '\D', '', 'g')) = 11
      AND regexp_replace("mobile", '\D', '', 'g') LIKE '1%'
      THEN '+' || regexp_replace("mobile", '\D', '', 'g')
  END
) WHERE "mobile" IS NOT NULL;--> statement-breakpoint
-- Two live Volunteers may have shared a number while it was decoration; the
-- index below would abort the whole migration on one. The **first** row by
-- creation keeps it and the rest are cleared, so the migration runs and the
-- collision is a thing a Coordinator fixes rather than a deploy that stops.
UPDATE "volunteers" SET "mobile" = NULL WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "org_id", "mobile" ORDER BY "created_at", "id"
    ) AS "rank"
    FROM "volunteers" WHERE "mobile" IS NOT NULL AND "removed_at" IS NULL
  ) "ranked" WHERE "ranked"."rank" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "volunteers_mobile_in_org" ON "volunteers" USING btree ("org_id","mobile") WHERE removed_at is null;