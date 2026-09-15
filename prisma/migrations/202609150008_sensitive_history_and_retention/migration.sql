ALTER TYPE "SensitiveExportScopeType" ADD VALUE IF NOT EXISTS 'self';

CREATE TABLE "person_photo_history" (
  "id" UUID NOT NULL,
  "person_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "changed_by" UUID,
  "ended_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "person_photo_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "person_photo_history_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "person_photo_history_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "person_photo_history_person_id_active_idx" ON "person_photo_history"("person_id", "active");
CREATE INDEX "person_photo_history_file_id_idx" ON "person_photo_history"("file_id");
INSERT INTO "person_photo_history" ("id", "person_id", "file_id", "active", "created_at")
SELECT gen_random_uuid(), "id", "photo_file_id", true, "created_at" FROM "persons" WHERE "photo_file_id" IS NOT NULL;
