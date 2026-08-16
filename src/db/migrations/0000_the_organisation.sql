CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"time_zone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orgs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "orgs_in_scope" ON "orgs" AS PERMISSIVE FOR ALL TO public USING (id::text = current_setting('app.org_id', true)) WITH CHECK (id::text = current_setting('app.org_id', true));