CREATE TABLE "horse_space_assignments" (
	"org_id" uuid NOT NULL,
	"horse_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"space_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	CONSTRAINT "horse_space_assignments_org_id_horse_id_kind_pk" PRIMARY KEY("org_id","horse_id","kind")
);
--> statement-breakpoint
ALTER TABLE "horse_space_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "horses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"halter_colour" text,
	"blanket_size" text,
	"height" text,
	"photo_url" text,
	"departed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "horses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "horse_space_assignments" ADD CONSTRAINT "horse_space_assignments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_space_assignments" ADD CONSTRAINT "horse_space_assignments_horse_id_horses_id_fk" FOREIGN KEY ("horse_id") REFERENCES "public"."horses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_space_assignments" ADD CONSTRAINT "horse_space_assignments_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horse_space_assignments" ADD CONSTRAINT "horse_space_assignments_assigned_by_volunteers_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horses" ADD CONSTRAINT "horses_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "horse_space_assignments_space" ON "horse_space_assignments" USING btree ("space_id");--> statement-breakpoint
CREATE POLICY "horse_space_assignments_in_scope" ON "horse_space_assignments" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "horses_in_scope" ON "horses" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "spaces_in_scope" ON "spaces" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));