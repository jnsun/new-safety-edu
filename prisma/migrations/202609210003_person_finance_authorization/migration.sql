ALTER TABLE "receivable_settings"
  ADD COLUMN "reporter_editable_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "receivable_access_grants"
  ADD COLUMN "person_id" UUID,
  ADD COLUMN "can_edit_base_info" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "can_upload_attachments" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "editable_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "receivable_access_grants" AS grant
SET "person_id" = account."person_id"
FROM "accounts" AS account
WHERE grant."account_id" = account."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "receivable_access_grants" WHERE "person_id" IS NULL) THEN
    RAISE EXCEPTION 'receivable access grant cannot be mapped to a person';
  END IF;
  IF EXISTS (
    SELECT "person_id"
    FROM "receivable_access_grants"
    WHERE "active" = true AND "revoked_at" IS NULL
    GROUP BY "person_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'person has multiple active receivable access grants';
  END IF;
END $$;

ALTER TABLE "receivable_access_grants"
  ALTER COLUMN "person_id" SET NOT NULL,
  ALTER COLUMN "account_id" DROP NOT NULL,
  ADD CONSTRAINT "receivable_access_grants_person_id_fkey"
    FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "receivable_access_grants_person_id_active_idx"
  ON "receivable_access_grants"("person_id", "active");

CREATE UNIQUE INDEX "receivable_access_grants_one_current_per_person"
  ON "receivable_access_grants"("person_id")
  WHERE "active" = true AND "revoked_at" IS NULL;

UPDATE "receivable_access_grants"
SET "can_edit_base_info" = CASE WHEN "role" = 'reporter' THEN true ELSE false END,
    "can_upload_attachments" = CASE WHEN "role" = 'reporter' AND "can_maintain_collection" THEN true ELSE false END,
    "editable_fields" = CASE
      WHEN "role" = 'reporter' THEN ARRAY['projectName','customerName','customerType','creditorUnit','workNature','sector','projectStatus','settlementMethod','debtStatus','collectionOwner','collectionNotes','dunningDate','communicationMethod','counterpartyFeedback','latestProgress','nextPlan']::TEXT[]
      ELSE ARRAY[]::TEXT[]
    END;

UPDATE "receivable_settings"
SET "reporter_editable_fields" = ARRAY['projectName','customerName','customerType','creditorUnit','workNature','sector','projectStatus','settlementMethod','debtStatus','collectionOwner','collectionNotes','dunningDate','communicationMethod','counterpartyFeedback','latestProgress','nextPlan']::TEXT[];
