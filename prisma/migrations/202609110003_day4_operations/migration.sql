CREATE TYPE "OutboxStatus" AS ENUM ('pending', 'sent', 'skipped', 'failed');

ALTER TABLE "project_confirmations" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "project_confirmations_assignment_id_round_key" ON "project_confirmations"("assignment_id", "round");

ALTER TABLE "notifications" ADD COLUMN "dedupe_key" VARCHAR(180);
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

ALTER TABLE "change_requests" ADD COLUMN "review_note" VARCHAR(500);

CREATE TABLE "notification_outbox" (
  "id" UUID NOT NULL,
  "notification_id" UUID NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_outbox_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "notification_outbox_notification_id_key" ON "notification_outbox"("notification_id");
