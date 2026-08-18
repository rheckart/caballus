CREATE TABLE "feed_schedule_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"amount" text NOT NULL,
	"route" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feed_schedule_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "feed_schedule_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"shift_type" text NOT NULL,
	"valid_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "feed_schedule_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "horse_measurements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" numeric NOT NULL,
	"method" text,
	"taken_on" date NOT NULL,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "horse_measurements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"supplier_id" uuid,
	"prescription" boolean DEFAULT false NOT NULL,
	"reorder_point_days" integer,
	"ordering_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feed_schedule_lines" ADD CONSTRAINT "feed_schedule_lines_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_schedule_lines" ADD CONSTRAINT "feed_schedule_lines_version_id_feed_schedule_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."feed_schedule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_schedule_lines" ADD CONSTRAINT "feed_schedule_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_schedule_versions" ADD CONSTRAINT "feed_schedule_versions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_schedule_versions" ADD CONSTRAINT "feed_schedule_versions_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_schedule_versions" ADD CONSTRAINT "feed_schedule_versions_created_by_volunteers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_measurements" ADD CONSTRAINT "horse_measurements_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_measurements" ADD CONSTRAINT "horse_measurements_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_measurements" ADD CONSTRAINT "horse_measurements_recorded_by_volunteers_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_schedule_lines_version" ON "feed_schedule_lines" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "feed_schedule_versions_current" ON "feed_schedule_versions" USING btree ("horse_id","shift_type","valid_from");--> statement-breakpoint
CREATE INDEX "horse_measurements_horse" ON "horse_measurements" USING btree ("horse_id","kind","taken_on");--> statement-breakpoint
CREATE INDEX "products_supplier" ON "products" USING btree ("supplier_id");--> statement-breakpoint
CREATE POLICY "feed_schedule_lines_in_scope" ON "feed_schedule_lines" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "feed_schedule_versions_in_scope" ON "feed_schedule_versions" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "horse_measurements_in_scope" ON "horse_measurements" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "products_in_scope" ON "products" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "suppliers_in_scope" ON "suppliers" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));