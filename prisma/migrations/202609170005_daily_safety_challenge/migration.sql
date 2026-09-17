ALTER TABLE "questions"
  ADD COLUMN "challenge_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "challenge_category" VARCHAR(80),
  ADD COLUMN "challenge_difficulty" VARCHAR(20);

CREATE TABLE "challenge_attempts" (
  "id" UUID NOT NULL,
  "person_id" UUID NOT NULL,
  "challenge_date" DATE NOT NULL,
  "question_snapshot" JSONB NOT NULL,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "challenge_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "challenge_answers" (
  "id" UUID NOT NULL,
  "attempt_id" UUID NOT NULL,
  "question_version_id" UUID NOT NULL,
  "answer" JSONB NOT NULL,
  "correct" BOOLEAN NOT NULL,
  "points_awarded" INTEGER NOT NULL DEFAULT 0,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "challenge_answers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "challenge_answers_points_check" CHECK ("points_awarded" IN (0, 2))
);

CREATE TABLE "challenge_point_ledgers" (
  "id" UUID NOT NULL,
  "person_id" UUID NOT NULL,
  "organization_id_snapshot" UUID,
  "answer_id" UUID,
  "source_type" VARCHAR(40) NOT NULL,
  "source_key" VARCHAR(180) NOT NULL,
  "points" INTEGER NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voided_at" TIMESTAMP(3),
  "voided_by" UUID,
  "void_reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "challenge_point_ledgers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "challenge_point_ledgers_points_check" CHECK ("points" > 0),
  CONSTRAINT "challenge_point_ledgers_void_check" CHECK (("voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL) OR ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND length(trim("void_reason")) >= 2))
);

CREATE TABLE "challenge_monthly_organization_snapshots" (
  "id" UUID NOT NULL,
  "month" DATE NOT NULL,
  "organization_id" UUID NOT NULL,
  "active_person_count" INTEGER NOT NULL,
  "participant_count" INTEGER NOT NULL,
  "total_points" INTEGER NOT NULL,
  "average_points" DECIMAL(12,4) NOT NULL,
  "rank" INTEGER NOT NULL,
  "reward_eligible" BOOLEAN NOT NULL,
  "finalized_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "challenge_monthly_organization_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "challenge_monthly_organization_snapshot_counts_check" CHECK ("active_person_count" >= 0 AND "participant_count" >= 0 AND "participant_count" <= "active_person_count" AND "total_points" >= 0 AND "average_points" >= 0 AND "rank" > 0),
  CONSTRAINT "challenge_monthly_organization_snapshot_month_check" CHECK (EXTRACT(DAY FROM "month") = 1)
);

CREATE UNIQUE INDEX "challenge_attempts_person_id_challenge_date_key" ON "challenge_attempts"("person_id", "challenge_date");
CREATE INDEX "challenge_attempts_challenge_date_created_at_idx" ON "challenge_attempts"("challenge_date", "created_at");
CREATE UNIQUE INDEX "challenge_answers_attempt_id_question_version_id_key" ON "challenge_answers"("attempt_id", "question_version_id");
CREATE INDEX "challenge_answers_question_version_id_idx" ON "challenge_answers"("question_version_id");
CREATE UNIQUE INDEX "challenge_point_ledgers_answer_id_key" ON "challenge_point_ledgers"("answer_id");
CREATE UNIQUE INDEX "challenge_point_ledgers_source_key_key" ON "challenge_point_ledgers"("source_key");
CREATE INDEX "challenge_point_ledgers_person_id_occurred_at_idx" ON "challenge_point_ledgers"("person_id", "occurred_at");
CREATE INDEX "challenge_point_ledgers_organization_id_snapshot_occurred_at_idx" ON "challenge_point_ledgers"("organization_id_snapshot", "occurred_at");
CREATE INDEX "challenge_point_ledgers_voided_at_occurred_at_idx" ON "challenge_point_ledgers"("voided_at", "occurred_at");
CREATE UNIQUE INDEX "challenge_monthly_organization_snapshots_month_organization_id_key" ON "challenge_monthly_organization_snapshots"("month", "organization_id");
CREATE INDEX "challenge_monthly_organization_snapshots_month_rank_idx" ON "challenge_monthly_organization_snapshots"("month", "rank");

ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenge_answers" ADD CONSTRAINT "challenge_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "challenge_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenge_answers" ADD CONSTRAINT "challenge_answers_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "question_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenge_point_ledgers" ADD CONSTRAINT "challenge_point_ledgers_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenge_point_ledgers" ADD CONSTRAINT "challenge_point_ledgers_organization_id_snapshot_fkey" FOREIGN KEY ("organization_id_snapshot") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenge_point_ledgers" ADD CONSTRAINT "challenge_point_ledgers_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "challenge_answers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenge_point_ledgers" ADD CONSTRAINT "challenge_point_ledgers_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenge_monthly_organization_snapshots" ADD CONSTRAINT "challenge_monthly_organization_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
