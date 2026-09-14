CREATE TYPE "ReportProjectStatus" AS ENUM ('active', 'completed');
CREATE TYPE "ReportFieldType" AS ENUM ('text', 'number', 'textarea', 'select', 'date');

ALTER TABLE "organizations" ADD COLUMN "reporting_enabled" BOOLEAN NOT NULL DEFAULT false;
UPDATE "organizations" SET "reporting_enabled" = true WHERE "type" IN ('department', 'business_entity');

CREATE TABLE "report_project_types" (
  "id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "report_project_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "report_project_types_name_key" ON "report_project_types"("name");
CREATE INDEX "report_project_types_active_sort_order_idx" ON "report_project_types"("active", "sort_order");

ALTER TABLE "project_monthly_reports"
  ADD COLUMN "project_type_id" UUID,
  ADD COLUMN "construction_location" VARCHAR(300),
  ADD COLUMN "contract_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "duration_months" INTEGER,
  ADD COLUMN "department_entity" VARCHAR(160),
  ADD COLUMN "project_manager" VARCHAR(80),
  ADD COLUMN "contact_info" VARCHAR(120),
  ADD COLUMN "overall_progress" TEXT,
  ADD COLUMN "monthly_construction_status" TEXT,
  ADD COLUMN "equipment_models" TEXT,
  ADD COLUMN "onsite_vehicles" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "safety_inspection" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "safety_hazards" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "safety_hazard_detail" TEXT,
  ADD COLUMN "project_status" "ReportProjectStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "custom_data" JSONB NOT NULL DEFAULT '{}';

UPDATE "project_monthly_reports" SET "status" = 'submitted', "submitted_at" = COALESCE("submitted_at", "updated_at") WHERE "status" = 'draft';
ALTER TABLE "project_monthly_reports" ALTER COLUMN "status" SET DEFAULT 'submitted';
ALTER TABLE "project_monthly_reports" ADD CONSTRAINT "project_monthly_reports_nonnegative_values" CHECK ("onsite_count" >= 0 AND "onsite_vehicles" >= 0 AND "contract_amount" >= 0 AND ("duration_months" IS NULL OR "duration_months" >= 0));
ALTER TABLE "project_monthly_reports" ADD CONSTRAINT "project_monthly_reports_hazard_detail" CHECK (NOT "safety_hazards" OR NULLIF(BTRIM("safety_hazard_detail"), '') IS NOT NULL);
ALTER TABLE "project_monthly_reports" ADD CONSTRAINT "project_monthly_reports_project_type_id_fkey" FOREIGN KEY ("project_type_id") REFERENCES "report_project_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "report_fields" (
  "id" UUID NOT NULL,
  "field_key" VARCHAR(80) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "field_type" "ReportFieldType" NOT NULL,
  "options" JSONB NOT NULL DEFAULT '[]',
  "is_required" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "is_builtin" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "report_fields_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "report_fields_field_key_key" ON "report_fields"("field_key");
CREATE INDEX "report_fields_active_sort_order_idx" ON "report_fields"("is_active", "sort_order");

INSERT INTO "report_fields" ("id", "field_key", "label", "field_type", "is_required", "sort_order", "is_builtin", "updated_at") VALUES
('20000000-0000-4000-8000-000000000001', 'project_name', '项目名称', 'text', true, 10, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000002', 'project_type_id', '项目类型', 'select', false, 20, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000003', 'construction_location', '施工地点', 'text', true, 30, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000004', 'contract_amount', '合同额（万元）', 'number', false, 40, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000005', 'duration_months', '工期（月）', 'number', false, 50, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000006', 'department_entity', '归属实体', 'text', false, 60, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000007', 'project_manager', '项目负责人', 'text', true, 70, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000008', 'contact_info', '联系方式', 'text', false, 80, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000009', 'overall_progress', '项目总体进度', 'textarea', false, 90, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000010', 'monthly_construction_status', '本月施工情况', 'textarea', true, 100, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000011', 'equipment_models', '设备型号', 'textarea', false, 110, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000012', 'onsite_count', '现场人数', 'number', true, 120, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000013', 'onsite_vehicles', '现场车辆数', 'number', false, 130, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000014', 'safety_inspection', '是否安全自检', 'select', true, 140, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000015', 'safety_hazards', '是否存在安全隐患', 'select', true, 150, true, CURRENT_TIMESTAMP),
('20000000-0000-4000-8000-000000000016', 'safety_hazard_detail', '安全隐患详情', 'textarea', false, 160, true, CURRENT_TIMESTAMP);

CREATE TABLE "department_month_statuses" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "reporting_year" INTEGER NOT NULL,
  "reporting_month" INTEGER NOT NULL,
  "no_field_projects" BOOLEAN NOT NULL DEFAULT true,
  "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_by" UUID NOT NULL,
  "note" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "department_month_statuses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "department_month_statuses_month_check" CHECK ("reporting_month" BETWEEN 1 AND 12),
  CONSTRAINT "department_month_statuses_year_check" CHECK ("reporting_year" BETWEEN 2000 AND 9999)
);
CREATE UNIQUE INDEX "department_month_statuses_organization_id_reporting_year_reporting_month_key" ON "department_month_statuses"("organization_id", "reporting_year", "reporting_month");
CREATE INDEX "department_month_statuses_reporting_year_reporting_month_idx" ON "department_month_statuses"("reporting_year", "reporting_month");
ALTER TABLE "department_month_statuses" ADD CONSTRAINT "department_month_statuses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
