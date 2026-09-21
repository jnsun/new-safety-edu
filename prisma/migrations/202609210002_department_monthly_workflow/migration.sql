CREATE TYPE "DepartmentReportType" AS ENUM ('projects', 'no_projects');
CREATE TYPE "DepartmentSubmissionStatus" AS ENUM ('draft', 'submitted', 'rejected', 'confirmed', 'locked');
CREATE TYPE "ReportingPeriodStatus" AS ENUM ('closed', 'open', 'review', 'locked');

ALTER TABLE "project_monthly_reports" ALTER COLUMN "status" SET DEFAULT 'draft';

ALTER TABLE "department_month_statuses"
  ADD COLUMN "report_type" "DepartmentReportType" NOT NULL DEFAULT 'projects',
  ADD COLUMN "status" "DepartmentSubmissionStatus" NOT NULL DEFAULT 'draft',
  ADD COLUMN "expected_project_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "completed_project_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ADD COLUMN "submitted_by" UUID,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_by" UUID,
  ADD COLUMN "return_reason" VARCHAR(1000),
  ADD COLUMN "locked_at" TIMESTAMP(3),
  ADD COLUMN "locked_by" UUID,
  ALTER COLUMN "confirmed_at" DROP NOT NULL,
  ALTER COLUMN "confirmed_at" DROP DEFAULT,
  ALTER COLUMN "confirmed_by" DROP NOT NULL;

UPDATE "department_month_statuses"
SET "report_type" = CASE WHEN "no_field_projects" THEN 'no_projects'::"DepartmentReportType" ELSE 'projects'::"DepartmentReportType" END,
    "status" = 'confirmed',
    "submitted_at" = COALESCE("confirmed_at", "created_at"),
    "submitted_by" = "confirmed_by",
    "reviewed_at" = COALESCE("confirmed_at", "created_at"),
    "reviewed_by" = "confirmed_by";

ALTER TABLE "department_month_statuses"
  ADD CONSTRAINT "department_month_statuses_counts_check"
  CHECK ("expected_project_count" >= 0 AND "completed_project_count" >= 0 AND "completed_project_count" <= "expected_project_count");

CREATE TABLE "reporting_periods" (
  "id" UUID NOT NULL,
  "report_month" DATE NOT NULL,
  "deadline_at" TIMESTAMP(3),
  "status" "ReportingPeriodStatus" NOT NULL DEFAULT 'closed',
  "reopen_reason" VARCHAR(500),
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reporting_periods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reporting_periods_report_month_key" ON "reporting_periods"("report_month");
CREATE INDEX "reporting_periods_status_report_month_idx" ON "reporting_periods"("status", "report_month");
