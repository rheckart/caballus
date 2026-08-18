CREATE TABLE "shift_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"day" date NOT NULL,
	"text" text NOT NULL,
	"horse_id" uuid,
	"authored_by" uuid NOT NULL,
	"authored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"post_close" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shift_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "attestation_relationship" text;--> statement-breakpoint
ALTER TABLE "item_outcomes" ADD COLUMN "late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "assigned_to_volunteer_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "assigned_by" uuid;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
ALTER TABLE "shift_notes" ADD CONSTRAINT "shift_notes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_notes" ADD CONSTRAINT "shift_notes_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_notes" ADD CONSTRAINT "shift_notes_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_notes" ADD CONSTRAINT "shift_notes_authored_by_volunteers_id_fk" FOREIGN KEY ("authored_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_notes_day" ON "shift_notes" USING btree ("org_id","day");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_assigned_to_volunteer_id_volunteers_id_fk" FOREIGN KEY ("assigned_to_volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_assigned_by_volunteers_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closed_by_volunteers_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "shift_notes_in_scope" ON "shift_notes" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));