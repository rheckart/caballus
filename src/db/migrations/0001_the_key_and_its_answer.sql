CREATE TABLE "idempotency_keys" (
	"org_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"route" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" integer,
	"response" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_org_id_idempotency_key_pk" PRIMARY KEY("org_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_keys_recorded_at" ON "idempotency_keys" USING btree ("recorded_at");--> statement-breakpoint
CREATE POLICY "idempotency_keys_in_scope" ON "idempotency_keys" AS PERMISSIVE FOR ALL TO public USING (org_id::text = current_setting('app.org_id', true)) WITH CHECK (org_id::text = current_setting('app.org_id', true));