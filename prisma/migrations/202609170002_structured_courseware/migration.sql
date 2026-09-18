ALTER TYPE "CoursewareType" ADD VALUE 'structured';

ALTER TABLE "courseware_versions"
  ADD COLUMN "structured_content" JSONB,
  ADD COLUMN "schema_version" INTEGER,
  ADD COLUMN "estimated_minutes" INTEGER;
