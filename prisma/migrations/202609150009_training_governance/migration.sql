ALTER TABLE "questions" ADD COLUMN "current_version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "question_versions" (
  "id" UUID NOT NULL,
  "question_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "type" "QuestionType" NOT NULL,
  "prompt" TEXT NOT NULL,
  "options" JSONB NOT NULL,
  "correct" JSONB NOT NULL,
  "explanation" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "question_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "question_versions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "question_versions_question_id_version_key" ON "question_versions"("question_id", "version");
CREATE INDEX "question_versions_question_id_created_at_idx" ON "question_versions"("question_id", "created_at");

INSERT INTO "question_versions" ("id", "question_id", "version", "type", "prompt", "options", "correct", "explanation", "created_at")
SELECT gen_random_uuid(), "id", 1, "type", "prompt", "options", "correct", "explanation", "created_at" FROM "questions";

ALTER TABLE "exam_paper_items" ADD COLUMN "question_version_id" UUID;
UPDATE "exam_paper_items" epi SET "question_version_id" = qv."id"
FROM "question_versions" qv WHERE qv."question_id" = epi."question_id" AND qv."version" = 1;
ALTER TABLE "exam_paper_items" ADD CONSTRAINT "exam_paper_items_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "question_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "exam_paper_items_question_version_id_idx" ON "exam_paper_items"("question_version_id");

CREATE TABLE "courseware_publish_grants" (
  "id" UUID NOT NULL,
  "person_id" UUID NOT NULL,
  "scope_type" "ScopeType" NOT NULL,
  "scope_id" UUID,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "granted_by" UUID NOT NULL,
  "ended_at" TIMESTAMP(3),
  "ended_by" UUID,
  "end_reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "courseware_publish_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "courseware_publish_grants_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "courseware_publish_grants_person_id_active_idx" ON "courseware_publish_grants"("person_id", "active");
CREATE INDEX "courseware_publish_grants_scope_type_scope_id_active_idx" ON "courseware_publish_grants"("scope_type", "scope_id", "active");
CREATE UNIQUE INDEX "courseware_publish_grants_one_active" ON "courseware_publish_grants"("person_id", "scope_type", COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "active" = true;
