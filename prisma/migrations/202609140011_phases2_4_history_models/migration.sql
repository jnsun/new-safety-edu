ALTER TYPE "MonthlyReportStatus" ADD VALUE IF NOT EXISTS 'withdrawn';
ALTER TYPE "MonthlyReportStatus" ADD VALUE IF NOT EXISTS 'voided';
ALTER TYPE "CertificateLifecycleStatus" ADD VALUE IF NOT EXISTS 'voided';
CREATE TYPE "HistoricalRecordStatus" AS ENUM ('active', 'voided');

ALTER TABLE "projects"
  ADD COLUMN "project_type" VARCHAR(120), ADD COLUMN "location" VARCHAR(300),
  ADD COLUMN "contract_amount" DECIMAL(14,2), ADD COLUMN "planned_start_at" DATE,
  ADD COLUMN "planned_end_at" DATE, ADD COLUMN "manager_name" VARCHAR(80),
  ADD COLUMN "manager_phone" VARCHAR(20);

ALTER TABLE "training_batches" ADD COLUMN "paper_snapshot" JSONB;
ALTER TABLE "training_assignments" ADD COLUMN "extra_attempts" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "training_automation_configs" (
  "id" UUID NOT NULL, "type" "TrainingType" NOT NULL, "scope_type" "ScopeType" NOT NULL,
  "scope_id" UUID, "template_id" UUID NOT NULL, "paper_id" UUID NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "training_automation_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "training_automation_configs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "training_templates"("id") ON UPDATE CASCADE,
  CONSTRAINT "training_automation_configs_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "exam_papers"("id") ON UPDATE CASCADE
);
CREATE INDEX "training_automation_configs_type_scope_type_scope_id_active_idx" ON "training_automation_configs"("type","scope_type","scope_id","active");

ALTER TABLE "project_monthly_reports"
  ADD COLUMN "project_snapshot" JSONB NOT NULL DEFAULT '{}', ADD COLUMN "field_snapshot" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "withdrawn_by" UUID,
  ADD COLUMN "withdrawn_at" TIMESTAMP(3), ADD COLUMN "withdrawal_reason" VARCHAR(500),
  ADD COLUMN "voided_by" UUID, ADD COLUMN "voided_at" TIMESTAMP(3), ADD COLUMN "void_reason" VARCHAR(500);

CREATE TABLE "project_monthly_report_revisions" (
  "id" UUID NOT NULL, "report_id" UUID NOT NULL, "revision" INTEGER NOT NULL,
  "before_snapshot" JSONB NOT NULL, "changed_by" UUID NOT NULL, "reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_monthly_report_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_monthly_report_revisions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "project_monthly_reports"("id") ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "project_monthly_report_revisions_report_id_revision_key" ON "project_monthly_report_revisions"("report_id","revision");

CREATE TABLE "project_monthly_report_attachments" (
  "id" UUID NOT NULL, "report_id" UUID NOT NULL, "file_id" UUID NOT NULL, "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_monthly_report_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_monthly_report_attachments_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "project_monthly_reports"("id") ON UPDATE CASCADE,
  CONSTRAINT "project_monthly_report_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "project_monthly_report_attachments_file_id_key" ON "project_monthly_report_attachments"("file_id");

ALTER TABLE "department_month_statuses" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "invalidated_at" TIMESTAMP(3), ADD COLUMN "invalidated_by" UUID, ADD COLUMN "invalid_reason" VARCHAR(500);

CREATE TABLE "report_settings" (
  "id" VARCHAR(32) NOT NULL DEFAULT 'default', "deadline_day" INTEGER NOT NULL DEFAULT 5, "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "report_settings_pkey" PRIMARY KEY ("id"), CONSTRAINT "report_settings_deadline_day_check" CHECK ("deadline_day" BETWEEN 1 AND 28)
);

ALTER TABLE "certificate_types" ADD COLUMN "requires_annual_training" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "person_certificates" ADD COLUMN "voided_at" TIMESTAMP(3), ADD COLUMN "voided_by" UUID, ADD COLUMN "void_reason" VARCHAR(500);
ALTER TABLE "organization_qualifications" ADD COLUMN "voided_at" TIMESTAMP(3), ADD COLUMN "voided_by" UUID, ADD COLUMN "void_reason" VARCHAR(500);
ALTER TABLE "certificate_training_records" ADD COLUMN "status" "HistoricalRecordStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "correction_of_id" UUID, ADD COLUMN "voided_at" TIMESTAMP(3), ADD COLUMN "voided_by" UUID,
  ADD COLUMN "void_reason" VARCHAR(500);
ALTER TABLE "certificate_training_records" ADD CONSTRAINT "certificate_training_records_correction_of_id_fkey"
  FOREIGN KEY ("correction_of_id") REFERENCES "certificate_training_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "certificate_annual_training_statuses" (
  "id" UUID NOT NULL, "person_certificate_id" UUID NOT NULL, "year" INTEGER NOT NULL,
  "status" "CertificateTrainingStatus" NOT NULL DEFAULT 'pending', "reason" VARCHAR(500), "set_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "certificate_annual_training_statuses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "certificate_annual_training_statuses_person_certificate_id_fkey" FOREIGN KEY ("person_certificate_id") REFERENCES "person_certificates"("id") ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "certificate_annual_training_statuses_person_certificate_id_year_key" ON "certificate_annual_training_statuses"("person_certificate_id","year");
CREATE INDEX "certificate_annual_training_statuses_year_status_idx" ON "certificate_annual_training_statuses"("year","status");

DROP INDEX IF EXISTS "project_monthly_reports_project_id_report_month_key";
DROP INDEX IF EXISTS "department_month_statuses_organization_id_reporting_year_reporting_month_key";
