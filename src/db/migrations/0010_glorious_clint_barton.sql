CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"shift_id" uuid,
	"category" text NOT NULL,
	"description" text,
	"arrived_at" timestamp with time zone NOT NULL,
	"arrived_recorded_by" uuid NOT NULL,
	"departed_at" timestamp with time zone,
	"departed_recorded_by" uuid,
	"supervising_adult_id" uuid,
	"supervising_adult_phone" text
);
--> statement-breakpoint
ALTER TABLE "attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_arrived_recorded_by_volunteers_id_fk" FOREIGN KEY ("arrived_recorded_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_departed_recorded_by_volunteers_id_fk" FOREIGN KEY ("departed_recorded_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_supervising_adult_id_volunteers_id_fk" FOREIGN KEY ("supervising_adult_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_volunteer" ON "attendance" USING btree ("org_id","volunteer_id","arrived_at");--> statement-breakpoint
CREATE INDEX "attendance_shift" ON "attendance" USING btree ("org_id","shift_id");--> statement-breakpoint
CREATE POLICY "attendance_in_scope" ON "attendance" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));