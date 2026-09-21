ALTER TABLE "training_batches"
  ADD COLUMN "description" VARCHAR(1000),
  ADD COLUMN "courseware_snapshot" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "dispatch_fingerprint" VARCHAR(64),
  ADD COLUMN "dispatch_result" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX "training_batches_dispatch_fingerprint_idx"
  ON "training_batches" ("dispatch_fingerprint");
