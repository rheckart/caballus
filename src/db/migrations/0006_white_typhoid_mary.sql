CREATE TABLE "threshold_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"horse_id" uuid,
	"kind" text NOT NULL,
	"stance" text NOT NULL,
	"value_f" numeric,
	"metric" text NOT NULL,
	"provider" text NOT NULL,
	"valid_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "threshold_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "weather_condition_resolutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"condition" text NOT NULL,
	"horse_id" uuid,
	"scope" text NOT NULL,
	"holds" boolean,
	"unresolved" text,
	"metric" text NOT NULL,
	"threshold_value_f" numeric,
	"threshold_source" text,
	"reading_value_f" numeric,
	"at_hour" integer
);
--> statement-breakpoint
ALTER TABLE "weather_condition_resolutions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "weather_reading_hours" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"day" date NOT NULL,
	"hour" integer NOT NULL,
	"air_temp_f" numeric,
	"apparent_temp_f" numeric,
	"precipitation" boolean
);
--> statement-breakpoint
ALTER TABLE "weather_reading_hours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "weather_readings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"fell_back_from" text,
	"fell_back_because" text,
	"stale" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid
);
--> statement-breakpoint
ALTER TABLE "weather_readings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "threshold_versions" ADD CONSTRAINT "threshold_versions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threshold_versions" ADD CONSTRAINT "threshold_versions_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threshold_versions" ADD CONSTRAINT "threshold_versions_created_by_volunteers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_condition_resolutions" ADD CONSTRAINT "weather_condition_resolutions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_condition_resolutions" ADD CONSTRAINT "weather_condition_resolutions_reading_id_weather_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."weather_readings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_condition_resolutions" ADD CONSTRAINT "weather_condition_resolutions_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_reading_hours" ADD CONSTRAINT "weather_reading_hours_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_reading_hours" ADD CONSTRAINT "weather_reading_hours_reading_id_weather_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."weather_readings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_readings" ADD CONSTRAINT "weather_readings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_readings" ADD CONSTRAINT "weather_readings_recorded_by_volunteers_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "threshold_versions_current" ON "threshold_versions" USING btree ("org_id","kind","horse_id","valid_from");--> statement-breakpoint
CREATE INDEX "weather_condition_resolutions_reading" ON "weather_condition_resolutions" USING btree ("reading_id","condition");--> statement-breakpoint
CREATE INDEX "weather_reading_hours_reading" ON "weather_reading_hours" USING btree ("reading_id","at");--> statement-breakpoint
CREATE INDEX "weather_readings_day" ON "weather_readings" USING btree ("org_id","day","recorded_at");--> statement-breakpoint
CREATE POLICY "threshold_versions_in_scope" ON "threshold_versions" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "weather_condition_resolutions_in_scope" ON "weather_condition_resolutions" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "weather_reading_hours_in_scope" ON "weather_reading_hours" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "weather_readings_in_scope" ON "weather_readings" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));