CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"raised_by" uuid NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"ending_reason" text
);
--> statement-breakpoint
ALTER TABLE "alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_raised_by_volunteers_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_ended_by_volunteers_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_horse" ON "alerts" USING btree ("org_id","horse_id");--> statement-breakpoint
CREATE POLICY "alerts_in_scope" ON "alerts" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));