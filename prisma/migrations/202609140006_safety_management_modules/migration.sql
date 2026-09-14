CREATE TYPE "MonthlyReportStatus" AS ENUM ('draft', 'submitted');

ALTER TABLE "accounts" ADD COLUMN "verified_phone" VARCHAR(20);
CREATE UNIQUE INDEX "accounts_verified_phone_key" ON "accounts"("verified_phone");

CREATE TABLE "person_certificates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "person_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "category" VARCHAR(80),
  "certificate_no_cipher" TEXT,
  "certificate_no_iv" TEXT,
  "certificate_no_tag" TEXT,
  "certificate_no_last4" VARCHAR(8),
  "issuing_authority" VARCHAR(160),
  "issued_at" DATE,
  "expires_at" DATE,
  "file_id" UUID,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "person_certificates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_qualifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "category" VARCHAR(80),
  "certificate_no_cipher" TEXT,
  "certificate_no_iv" TEXT,
  "certificate_no_tag" TEXT,
  "certificate_no_last4" VARCHAR(8),
  "issuing_authority" VARCHAR(160),
  "issued_at" DATE,
  "expires_at" DATE,
  "scope" TEXT,
  "file_id" UUID,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_qualifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_monthly_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "reporting_organization_id" UUID NOT NULL,
  "report_month" DATE NOT NULL,
  "status" "MonthlyReportStatus" NOT NULL DEFAULT 'draft',
  "progress_summary" TEXT NOT NULL,
  "onsite_count" INTEGER NOT NULL DEFAULT 0,
  "safety_hazard_count" INTEGER NOT NULL DEFAULT 0,
  "rectified_hazard_count" INTEGER NOT NULL DEFAULT 0,
  "safety_investment" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "incident_count" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "submitted_by" UUID,
  "submitted_at" TIMESTAMP(3),
  "updated_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_monthly_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "phone_verification_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "phone_hash" VARCHAR(64) NOT NULL,
  "code_hash" VARCHAR(64) NOT NULL,
  "purpose" VARCHAR(40) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "phone_verification_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "person_certificates_person_id_active_expires_at_idx" ON "person_certificates"("person_id", "active", "expires_at");
CREATE INDEX "organization_qualifications_organization_id_active_expires_at_idx" ON "organization_qualifications"("organization_id", "active", "expires_at");
CREATE UNIQUE INDEX "project_monthly_reports_project_id_report_month_key" ON "project_monthly_reports"("project_id", "report_month");
CREATE INDEX "project_monthly_reports_reporting_organization_id_report_month_idx" ON "project_monthly_reports"("reporting_organization_id", "report_month");
CREATE INDEX "phone_verification_codes_phone_hash_purpose_created_at_idx" ON "phone_verification_codes"("phone_hash", "purpose", "created_at");

ALTER TABLE "person_certificates" ADD CONSTRAINT "person_certificates_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "person_certificates" ADD CONSTRAINT "person_certificates_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organization_qualifications" ADD CONSTRAINT "organization_qualifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_qualifications" ADD CONSTRAINT "organization_qualifications_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_monthly_reports" ADD CONSTRAINT "project_monthly_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_monthly_reports" ADD CONSTRAINT "project_monthly_reports_reporting_organization_id_fkey" FOREIGN KEY ("reporting_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
