ALTER TABLE "accounts"
  ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "login_locked_until" TIMESTAMP(3);

ALTER TABLE "refresh_sessions"
  ADD COLUMN "login_method" VARCHAR(20),
  ADD COLUMN "absolute_expires_at" TIMESTAMP(3);

UPDATE "refresh_sessions"
SET "absolute_expires_at" = "expires_at"
WHERE "absolute_expires_at" IS NULL;

ALTER TABLE "refresh_sessions"
  ALTER COLUMN "absolute_expires_at" SET NOT NULL;

CREATE TABLE "auth_security_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID,
  "account_identifier_hash" VARCHAR(64),
  "event_type" VARCHAR(80) NOT NULL,
  "login_method" VARCHAR(20),
  "client_kind" VARCHAR(20),
  "source_hash" VARCHAR(64),
  "outcome" VARCHAR(40) NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_security_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_security_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "auth_security_events_account_id_created_at_idx" ON "auth_security_events"("account_id", "created_at");
CREATE INDEX "auth_security_events_event_type_created_at_idx" ON "auth_security_events"("event_type", "created_at");

ALTER TABLE "phone_verification_codes" ADD COLUMN "source_hash" VARCHAR(64);
CREATE INDEX "phone_verification_codes_source_hash_created_at_idx" ON "phone_verification_codes"("source_hash", "created_at");
