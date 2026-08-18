ALTER TABLE "shifts" ADD COLUMN "short_declared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "short_declared_by" uuid;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "short_cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "short_cleared_by" uuid;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_short_declared_by_volunteers_id_fk" FOREIGN KEY ("short_declared_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_short_cleared_by_volunteers_id_fk" FOREIGN KEY ("short_cleared_by") REFERENCES "public"."volunteers"("id") ON DELETE no action ON UPDATE no action;