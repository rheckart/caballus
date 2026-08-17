CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_volunteer_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text,
	"before" text,
	"after" text,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "audit_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "medication_authority" (
	"org_id" uuid NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "medication_authority_org_id_volunteer_id_pk" PRIMARY KEY("org_id","volunteer_id")
);
--> statement-breakpoint
ALTER TABLE "medication_authority" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "release_signatures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"release_version_id" uuid NOT NULL,
	"signed_on" date NOT NULL,
	"by_parent" boolean DEFAULT false NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid
);
--> statement-breakpoint
ALTER TABLE "release_signatures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "release_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"label" text NOT NULL,
	"valid_from" date NOT NULL,
	"obsoletes_prior" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid
);
--> statement-breakpoint
ALTER TABLE "release_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "volunteer_consents" (
	"org_id" uuid NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"consented_on" date NOT NULL,
	"parent_name" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_consents_org_id_volunteer_id_pk" PRIMARY KEY("org_id","volunteer_id")
);
--> statement-breakpoint
ALTER TABLE "volunteer_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "volunteer_roles" ADD COLUMN "granted_by" uuid;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "date_of_birth_provenance" text;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "date_of_birth_recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "date_of_birth_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "oriented_on" date;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "orientation_recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "volunteers" ADD COLUMN "orientation_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_actor_volunteer_id_volunteers_id_fk" FOREIGN KEY ("actor_volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_authority" ADD CONSTRAINT "medication_authority_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_authority" ADD CONSTRAINT "medication_authority_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_authority" ADD CONSTRAINT "medication_authority_granted_by_volunteers_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_authority" ADD CONSTRAINT "medication_authority_revoked_by_volunteers_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_signatures" ADD CONSTRAINT "release_signatures_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_signatures" ADD CONSTRAINT "release_signatures_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_signatures" ADD CONSTRAINT "release_signatures_release_version_id_release_versions_id_fk" FOREIGN KEY ("release_version_id") REFERENCES "public"."release_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_signatures" ADD CONSTRAINT "release_signatures_recorded_by_volunteers_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_signatures" ADD CONSTRAINT "release_signatures_revoked_by_volunteers_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_versions" ADD CONSTRAINT "release_versions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_versions" ADD CONSTRAINT "release_versions_published_by_volunteers_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_consents" ADD CONSTRAINT "volunteer_consents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_consents" ADD CONSTRAINT "volunteer_consents_volunteer_id_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_consents" ADD CONSTRAINT "volunteer_consents_recorded_by_volunteers_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entries_entity" ON "audit_entries" USING btree ("org_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_entries_recorded_at" ON "audit_entries" USING btree ("org_id","recorded_at");--> statement-breakpoint
CREATE INDEX "release_signatures_volunteer" ON "release_signatures" USING btree ("org_id","volunteer_id");--> statement-breakpoint
CREATE INDEX "release_versions_valid_from" ON "release_versions" USING btree ("org_id","valid_from");--> statement-breakpoint
ALTER TABLE "volunteer_roles" ADD CONSTRAINT "volunteer_roles_granted_by_volunteers_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_date_of_birth_recorded_by_volunteers_id_fk" FOREIGN KEY ("date_of_birth_recorded_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_orientation_recorded_by_volunteers_id_fk" FOREIGN KEY ("orientation_recorded_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "audit_entries_in_scope" ON "audit_entries" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "medication_authority_in_scope" ON "medication_authority" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "release_signatures_in_scope" ON "release_signatures" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "release_versions_in_scope" ON "release_versions" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "volunteer_consents_in_scope" ON "volunteer_consents" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));