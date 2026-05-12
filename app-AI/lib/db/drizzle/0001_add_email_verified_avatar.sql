ALTER TABLE "users" ADD COLUMN "is_email_verified" boolean DEFAULT false NOT NULL;
ALTER TABLE "users" ADD COLUMN "avatar_url" text;
