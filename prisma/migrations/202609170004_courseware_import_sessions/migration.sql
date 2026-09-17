CREATE TYPE "CoursewareImportStatus" AS ENUM ('previewed', 'confirming', 'confirmed', 'failed', 'expired');

ALTER TABLE "coursewares"
  ADD COLUMN "code" VARCHAR(120);

CREATE UNIQUE INDEX "coursewares_code_key" ON "coursewares"("code");

CREATE TABLE "courseware_import_sessions" (
  "id" UUID NOT NULL,
  "source_file_id" UUID,
  "original_filename" VARCHAR(240) NOT NULL,
  "source_hash" CHAR(64) NOT NULL,
  "template_version" INTEGER NOT NULL,
  "parsed_result" JSONB NOT NULL,
  "preview_result" JSONB NOT NULL,
  "confirmation_key" CHAR(64) NOT NULL,
  "status" "CoursewareImportStatus" NOT NULL DEFAULT 'previewed',
  "created_by" UUID NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "confirmed_at" TIMESTAMP(3),
  "confirm_result" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "courseware_import_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courseware_import_sessions_confirmation_key_key" ON "courseware_import_sessions"("confirmation_key");
CREATE UNIQUE INDEX "courseware_import_sessions_id_source_hash_key" ON "courseware_import_sessions"("id", "source_hash");
CREATE INDEX "courseware_import_sessions_created_by_status_expires_at_idx" ON "courseware_import_sessions"("created_by", "status", "expires_at");
CREATE INDEX "courseware_import_sessions_source_hash_created_at_idx" ON "courseware_import_sessions"("source_hash", "created_at");
CREATE INDEX "courseware_import_sessions_source_file_id_idx" ON "courseware_import_sessions"("source_file_id");

ALTER TABLE "courseware_versions"
  ADD COLUMN "import_session_id" UUID,
  ADD COLUMN "import_course_code" VARCHAR(120);

CREATE UNIQUE INDEX "courseware_versions_import_session_id_import_course_code_key"
  ON "courseware_versions"("import_session_id", "import_course_code");

ALTER TABLE "courseware_import_sessions"
  ADD CONSTRAINT "courseware_import_sessions_source_file_id_fkey"
  FOREIGN KEY ("source_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "courseware_import_sessions"
  ADD CONSTRAINT "courseware_import_sessions_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "courseware_versions"
  ADD CONSTRAINT "courseware_versions_import_session_id_fkey"
  FOREIGN KEY ("import_session_id") REFERENCES "courseware_import_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
