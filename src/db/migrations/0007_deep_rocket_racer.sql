CREATE TABLE "shift_pattern_roster" (
	"org_id" uuid NOT NULL,
	"pattern_id" uuid NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"position" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	CONSTRAINT "shift_pattern_roster_org_id_pattern_id_volunteer_id_pk" PRIMARY KEY("org_id","pattern_id","volunteer_id")
);
--> statement-breakpoint
ALTER TABLE "shift_pattern_roster" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_patterns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"weekday" text NOT NULL,
	"shift_type" text NOT NULL,
	"start_time" time NOT NULL,
	"target_headcount" integer NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "shift_patterns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_roster" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"position" text NOT NULL,
	"origin" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" uuid,
	"ended_at" timestamp with time zone,
	"ended_kind" text,
	"ended_reason" text,
	"ended_by" uuid
);
--> statement-breakpoint
ALTER TABLE "shift_roster" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"pattern_id" uuid,
	"day" date NOT NULL,
	"shift_type" text NOT NULL,
	"start_time" time NOT NULL,
	"target_headcount" integer NOT NULL,
	"staffing_mode" text NOT NULL,
	"purpose" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_pattern_roster" ADD CONSTRAINT "shift_pattern_roster_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_pattern_roster" ADD CONSTRAINT "shift_pattern_roster_pattern_id_shift_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."shift_patterns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_pattern_roster" ADD CONSTRAINT "shift_pattern_roster_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_pattern_roster" ADD CONSTRAINT "shift_pattern_roster_assigned_by_volunteers_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD CONSTRAINT "shift_patterns_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD CONSTRAINT "shift_patterns_created_by_volunteers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_roster" ADD CONSTRAINT "shift_roster_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_roster" ADD CONSTRAINT "shift_roster_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_roster" ADD CONSTRAINT "shift_roster_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_roster" ADD CONSTRAINT "shift_roster_added_by_volunteers_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_roster" ADD CONSTRAINT "shift_roster_ended_by_volunteers_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_pattern_id_shift_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."shift_patterns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_created_by_volunteers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_pattern_roster_volunteer" ON "shift_pattern_roster" USING btree ("volunteer_id");--> statement-breakpoint
CREATE INDEX "shift_patterns_weekday" ON "shift_patterns" USING btree ("org_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_roster_person" ON "shift_roster" USING btree ("org_id","shift_id","volunteer_id");--> statement-breakpoint
CREATE INDEX "shift_roster_volunteer" ON "shift_roster" USING btree ("org_id","volunteer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_occurrence" ON "shifts" USING btree ("org_id","pattern_id","day");--> statement-breakpoint
CREATE INDEX "shifts_day" ON "shifts" USING btree ("org_id","day");--> statement-breakpoint
CREATE POLICY "shift_pattern_roster_in_scope" ON "shift_pattern_roster" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "shift_patterns_in_scope" ON "shift_patterns" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "shift_roster_in_scope" ON "shift_roster" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "shifts_in_scope" ON "shifts" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));