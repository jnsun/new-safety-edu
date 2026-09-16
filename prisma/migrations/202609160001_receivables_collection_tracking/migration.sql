ALTER TABLE "receivable_access_grants"
  ADD COLUMN "can_maintain_collection" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "receivable_ledgers"
  ADD COLUMN "dunning_date" DATE,
  ADD COLUMN "comm_method" VARCHAR(120),
  ADD COLUMN "feedback" VARCHAR(240),
  ADD COLUMN "latest_progress" VARCHAR(240),
  ADD COLUMN "next_plan" VARCHAR(240);
