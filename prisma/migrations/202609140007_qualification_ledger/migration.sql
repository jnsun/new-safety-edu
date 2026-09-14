CREATE TYPE "CertificateCategory" AS ENUM ('company', 'personal');
CREATE TYPE "CertificateLifecycleStatus" AS ENUM ('active', 'replaced', 'revoked');
CREATE TYPE "CertificateTrainingStatus" AS ENUM ('trained', 'not_required', 'pending');

CREATE TABLE "certificate_types" (
  "id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "category" "CertificateCategory" NOT NULL,
  "subtype_1_label" VARCHAR(80),
  "subtype_1_options" JSONB NOT NULL DEFAULT '[]',
  "subtype_2_label" VARCHAR(80),
  "subtype_2_options" JSONB NOT NULL DEFAULT '[]',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "certificate_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "certificate_types_name_key" ON "certificate_types"("name");
CREATE INDEX "certificate_types_category_active_sort_order_idx" ON "certificate_types"("category", "active", "sort_order");

ALTER TABLE "person_certificates"
  ADD COLUMN "type_id" UUID,
  ADD COLUMN "subtype_1_value" VARCHAR(120),
  ADD COLUMN "subtype_2_value" VARCHAR(120),
  ADD COLUMN "valid_from" DATE,
  ADD COLUMN "is_long_term" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "holder_position" VARCHAR(120),
  ADD COLUMN "status" "CertificateLifecycleStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "training_status" "CertificateTrainingStatus" DEFAULT 'pending',
  ADD COLUMN "remark" VARCHAR(2000),
  ADD COLUMN "renewed_from_id" UUID,
  ADD COLUMN "renewed_at" TIMESTAMP(3),
  ADD COLUMN "created_by" UUID;

ALTER TABLE "organization_qualifications"
  ADD COLUMN "type_id" UUID,
  ADD COLUMN "subtype_1_value" VARCHAR(120),
  ADD COLUMN "subtype_2_value" VARCHAR(120),
  ADD COLUMN "valid_from" DATE,
  ADD COLUMN "is_long_term" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "status" "CertificateLifecycleStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "remark" VARCHAR(2000),
  ADD COLUMN "renewed_from_id" UUID,
  ADD COLUMN "renewed_at" TIMESTAMP(3),
  ADD COLUMN "created_by" UUID;

ALTER TABLE "person_certificates" ADD CONSTRAINT "person_certificates_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "certificate_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "person_certificates" ADD CONSTRAINT "person_certificates_renewed_from_id_fkey" FOREIGN KEY ("renewed_from_id") REFERENCES "person_certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_qualifications" ADD CONSTRAINT "organization_qualifications_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "certificate_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_qualifications" ADD CONSTRAINT "organization_qualifications_renewed_from_id_fkey" FOREIGN KEY ("renewed_from_id") REFERENCES "organization_qualifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "certificate_attachments" (
  "id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "person_certificate_id" UUID,
  "organization_qualification_id" UUID,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "certificate_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "certificate_attachments_exactly_one_owner" CHECK (
    (("person_certificate_id" IS NOT NULL)::int + ("organization_qualification_id" IS NOT NULL)::int) = 1
  )
);
CREATE UNIQUE INDEX "certificate_attachments_file_id_key" ON "certificate_attachments"("file_id");
ALTER TABLE "certificate_attachments" ADD CONSTRAINT "certificate_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "certificate_attachments" ADD CONSTRAINT "certificate_attachments_person_certificate_id_fkey" FOREIGN KEY ("person_certificate_id") REFERENCES "person_certificates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "certificate_attachments" ADD CONSTRAINT "certificate_attachments_organization_qualification_id_fkey" FOREIGN KEY ("organization_qualification_id") REFERENCES "organization_qualifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "certificate_training_records" (
  "id" UUID NOT NULL,
  "person_certificate_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "training_date" DATE NOT NULL,
  "content" VARCHAR(1000) NOT NULL,
  "training_organization" VARCHAR(160),
  "hours" DECIMAL(6,2),
  "result" VARCHAR(120),
  "remark" VARCHAR(1000),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "certificate_training_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "certificate_training_records_year_check" CHECK ("year" BETWEEN 2000 AND 9999),
  CONSTRAINT "certificate_training_records_hours_check" CHECK ("hours" IS NULL OR "hours" >= 0)
);
CREATE INDEX "certificate_training_records_person_certificate_id_year_idx" ON "certificate_training_records"("person_certificate_id", "year");
ALTER TABLE "certificate_training_records" ADD CONSTRAINT "certificate_training_records_person_certificate_id_fkey" FOREIGN KEY ("person_certificate_id") REFERENCES "person_certificates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "certificate_settings" (
  "id" VARCHAR(32) NOT NULL DEFAULT 'default',
  "warn_days" INTEGER NOT NULL DEFAULT 90,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "certificate_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "certificate_settings_warn_days_check" CHECK ("warn_days" BETWEEN 1 AND 365)
);

INSERT INTO "certificate_settings" ("id", "warn_days", "updated_at") VALUES ('default', 90, CURRENT_TIMESTAMP);

INSERT INTO "certificate_types" ("id", "name", "category", "subtype_1_label", "subtype_1_options", "subtype_2_label", "subtype_2_options", "sort_order", "updated_at") VALUES
('10000000-0000-4000-8000-000000000001', '安全生产许可证', 'company', NULL, '[]', NULL, '[]', 10, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000002', '爆破作业单位许可证', 'company', NULL, '[]', NULL, '[]', 20, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000003', '应急预案备案登记表', 'company', NULL, '[]', NULL, '[]', 30, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000004', '安全生产部标准化二级', 'company', NULL, '[]', NULL, '[]', 40, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000005', '安全生产责任保险', 'company', NULL, '[]', NULL, '[]', 50, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000006', '爆破作业人员许可证', 'personal', '人员类别', '["爆破员","保管员","安全员","爆破工程技术人员初级·D","爆破工程技术人员中级·C"]', NULL, '[]', 60, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000007', '非煤矿山安全管理人员证书', 'personal', '证书类别', '["主要负责人","安全管理人员"]', '学习地点', '["太原","运城"]', 70, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000008', '特种作业人员资格证', 'personal', '培训机构', '["应急局","住建局"]', '作业类别', '["低压电工作业","焊接与热切割作业"]', 80, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000009', '安全生产考核合格证书', 'personal', '类别', '["A类人员","B类人员","C类人员"]', NULL, '[]', 90, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000010', '注册安全工程师', 'personal', '专业类别', '["金属非金属矿山安全","其他安全"]', NULL, '[]', 100, CURRENT_TIMESTAMP);
