CREATE TABLE "item_outcomes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_outcomes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "item_outcomes" ADD CONSTRAINT "item_outcomes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_outcomes" ADD CONSTRAINT "item_outcomes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_outcomes" ADD CONSTRAINT "item_outcomes_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_outcomes" ADD CONSTRAINT "item_outcomes_claimed_by_volunteers_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_outcomes_item" ON "item_outcomes" USING btree ("org_id","item_id");--> statement-breakpoint
CREATE POLICY "item_outcomes_in_scope" ON "item_outcomes" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));