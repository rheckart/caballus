CREATE TABLE "days_of_supply_readings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"days_remaining" numeric NOT NULL,
	"counted_on" date NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "days_of_supply_readings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reorder_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"reorder_id" uuid NOT NULL,
	"text" text NOT NULL,
	"authored_by" uuid NOT NULL,
	"authored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reorder_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reorders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"escalation_id" uuid,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"closing_note" text
);
--> statement-breakpoint
ALTER TABLE "reorders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "days_of_supply_readings" ADD CONSTRAINT "days_of_supply_readings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "days_of_supply_readings" ADD CONSTRAINT "days_of_supply_readings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "days_of_supply_readings" ADD CONSTRAINT "days_of_supply_readings_recorded_by_volunteers_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_comments" ADD CONSTRAINT "reorder_comments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_comments" ADD CONSTRAINT "reorder_comments_reorder_id_reorders_id_fk" FOREIGN KEY ("reorder_id") REFERENCES "public"."reorders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_comments" ADD CONSTRAINT "reorder_comments_authored_by_volunteers_id_fk" FOREIGN KEY ("authored_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorders" ADD CONSTRAINT "reorders_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorders" ADD CONSTRAINT "reorders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorders" ADD CONSTRAINT "reorders_escalation_id_escalations_id_fk" FOREIGN KEY ("escalation_id") REFERENCES "public"."escalations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorders" ADD CONSTRAINT "reorders_opened_by_volunteers_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorders" ADD CONSTRAINT "reorders_closed_by_volunteers_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "days_of_supply_readings_product" ON "days_of_supply_readings" USING btree ("org_id","product_id","counted_on");--> statement-breakpoint
CREATE INDEX "reorder_comments_reorder" ON "reorder_comments" USING btree ("org_id","reorder_id");--> statement-breakpoint
CREATE INDEX "reorders_product" ON "reorders" USING btree ("org_id","product_id");--> statement-breakpoint
CREATE INDEX "reorders_open" ON "reorders" USING btree ("org_id","closed_at");--> statement-breakpoint
CREATE POLICY "days_of_supply_readings_in_scope" ON "days_of_supply_readings" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "reorder_comments_in_scope" ON "reorder_comments" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "reorders_in_scope" ON "reorders" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));