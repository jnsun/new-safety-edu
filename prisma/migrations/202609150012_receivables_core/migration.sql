CREATE TYPE "ReceivableGrantRole" AS ENUM ('admin', 'reporter', 'readonly');
CREATE TYPE "ReceivableRecordStatus" AS ENUM ('active', 'voided');
CREATE TYPE "ReceivableDetailSource" AS ENUM ('manual', 'opening_import');
CREATE TYPE "ReceivableImportStatus" AS ENUM ('previewed', 'applied', 'failed', 'rolled_back');
CREATE TYPE "ReceivableExportStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'expired');

CREATE TABLE "receivable_settings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "finance_organization_id" UUID,
  "configuration_confirmed_at" TIMESTAMP(3),
  "configuration_confirmed_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "receivable_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivable_departments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(160) NOT NULL,
  "code" VARCHAR(40),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "deactivated_at" TIMESTAMP(3),
  "deactivated_by" UUID,
  "deactivate_reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "receivable_departments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivable_access_grants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "role" "ReceivableGrantRole" NOT NULL,
  "can_create" BOOLEAN NOT NULL DEFAULT FALSE,
  "can_export" BOOLEAN NOT NULL DEFAULT FALSE,
  "can_view_all" BOOLEAN NOT NULL DEFAULT FALSE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "granted_by" UUID NOT NULL,
  "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  "revoked_by" UUID,
  "revoke_reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "receivable_access_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivable_grant_departments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "grant_id" UUID NOT NULL,
  "finance_department_id" UUID NOT NULL,
  "can_read" BOOLEAN NOT NULL DEFAULT TRUE,
  "can_write" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "receivable_grant_departments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivable_dictionary_options" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "category" VARCHAR(80) NOT NULL,
  "value" VARCHAR(240) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "deactivated_at" TIMESTAMP(3),
  "deactivated_by" UUID,
  "deactivate_reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "receivable_dictionary_options_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivable_import_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "original_file_id" UUID NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "status" "ReceivableImportStatus" NOT NULL DEFAULT 'previewed',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "row_count" INTEGER NOT NULL DEFAULT 0,
  "error_count" INTEGER NOT NULL DEFAULT 0,
  "requested_by" UUID NOT NULL,
  "applied_at" TIMESTAMP(3),
  "applied_by" UUID,
  "rolled_back_at" TIMESTAMP(3),
  "rolled_back_by" UUID,
  "rollback_reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "receivable_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivable_ledgers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "finance_department_id" UUID NOT NULL,
  "contract_no" VARCHAR(160) NOT NULL,
  "contract_no_normalized" VARCHAR(160) NOT NULL,
  "project_name" VARCHAR(240),
  "customer_name" VARCHAR(240),
  "customer_type" VARCHAR(120),
  "creditor_unit" VARCHAR(120),
  "work_nature" VARCHAR(160),
  "sector" VARCHAR(160),
  "project_status" VARCHAR(120),
  "settlement_method" VARCHAR(120),
  "contract_amount" DECIMAL(18,4),
  "final_amount" DECIMAL(18,4),
  "writeoff_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "opening_charge_date" DATE,
  "debt_status" VARCHAR(120),
  "collection_owner" VARCHAR(120),
  "collection_notes" TEXT,
  "status" "ReceivableRecordStatus" NOT NULL DEFAULT 'active',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "voided_at" TIMESTAMP(3),
  "voided_by" UUID,
  "void_reason" VARCHAR(500),
  "created_by" UUID NOT NULL,
  "updated_by" UUID,
  "created_by_import_batch_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "receivable_ledgers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivable_ledger_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ledger_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "before_snapshot" JSONB NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "changed_by" UUID NOT NULL,
  "import_batch_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "receivable_ledger_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivable_invoices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ledger_id" UUID NOT NULL,
  "invoice_no" VARCHAR(120),
  "invoice_date" DATE NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "note" TEXT,
  "source" "ReceivableDetailSource" NOT NULL DEFAULT 'manual',
  "status" "ReceivableRecordStatus" NOT NULL DEFAULT 'active',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "voided_at" TIMESTAMP(3),
  "voided_by" UUID,
  "void_reason" VARCHAR(500),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "receivable_invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivable_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ledger_id" UUID NOT NULL,
  "receipt_date" DATE NOT NULL,
  "reference_no" VARCHAR(120),
  "amount" DECIMAL(18,4) NOT NULL,
  "note" TEXT,
  "source" "ReceivableDetailSource" NOT NULL DEFAULT 'manual',
  "status" "ReceivableRecordStatus" NOT NULL DEFAULT 'active',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "voided_at" TIMESTAMP(3),
  "voided_by" UUID,
  "void_reason" VARCHAR(500),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "receivable_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivable_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ledger_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "category" VARCHAR(120) NOT NULL,
  "status" "ReceivableRecordStatus" NOT NULL DEFAULT 'active',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "uploaded_by" UUID NOT NULL,
  "voided_at" TIMESTAMP(3),
  "voided_by" UUID,
  "void_reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "receivable_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivable_import_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL,
  "row_number" INTEGER NOT NULL,
  "contract_no_normalized" VARCHAR(160),
  "normalized_data" JSONB NOT NULL,
  "errors" JSONB,
  "decision" VARCHAR(20),
  "result" VARCHAR(40),
  "ledger_id" UUID,
  "target_revision" INTEGER,
  "applied_revision" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "receivable_import_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receivable_export_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "requested_by" UUID NOT NULL,
  "status" "ReceivableExportStatus" NOT NULL DEFAULT 'pending',
  "scope_snapshot" JSONB NOT NULL,
  "filter_snapshot" JSONB NOT NULL,
  "row_count" INTEGER,
  "storage_key" VARCHAR(300),
  "size" INTEGER,
  "sha256" VARCHAR(64),
  "download_token_hash" VARCHAR(64),
  "download_expires_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "downloaded_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "error" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "receivable_export_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "receivable_settings_finance_organization_id_key" ON "receivable_settings"("finance_organization_id");
CREATE UNIQUE INDEX "receivable_departments_name_key" ON "receivable_departments"("name");
CREATE UNIQUE INDEX "receivable_departments_code_key" ON "receivable_departments"("code");
CREATE INDEX "receivable_departments_active_sort_order_idx" ON "receivable_departments"("active", "sort_order");
CREATE UNIQUE INDEX "receivable_access_grants_one_active_account" ON "receivable_access_grants"("account_id") WHERE "active" = TRUE;
CREATE INDEX "receivable_access_grants_account_id_active_idx" ON "receivable_access_grants"("account_id", "active");
CREATE INDEX "receivable_access_grants_role_active_idx" ON "receivable_access_grants"("role", "active");
CREATE UNIQUE INDEX "receivable_grant_departments_grant_id_finance_department_id_key" ON "receivable_grant_departments"("grant_id", "finance_department_id");
CREATE INDEX "receivable_grant_departments_finance_department_id_idx" ON "receivable_grant_departments"("finance_department_id");
CREATE UNIQUE INDEX "receivable_dictionary_options_category_value_key" ON "receivable_dictionary_options"("category", "value");
CREATE INDEX "receivable_dictionary_options_category_active_sort_order_idx" ON "receivable_dictionary_options"("category", "active", "sort_order");
CREATE UNIQUE INDEX "receivable_import_batches_original_file_id_key" ON "receivable_import_batches"("original_file_id");
CREATE INDEX "receivable_import_batches_status_created_at_idx" ON "receivable_import_batches"("status", "created_at");
CREATE INDEX "receivable_import_batches_requested_by_created_at_idx" ON "receivable_import_batches"("requested_by", "created_at");
CREATE UNIQUE INDEX "receivable_ledgers_contract_no_normalized_key" ON "receivable_ledgers"("contract_no_normalized");
CREATE INDEX "receivable_ledgers_finance_department_id_status_idx" ON "receivable_ledgers"("finance_department_id", "status");
CREATE INDEX "receivable_ledgers_status_debt_status_idx" ON "receivable_ledgers"("status", "debt_status");
CREATE INDEX "receivable_ledgers_created_by_import_batch_id_idx" ON "receivable_ledgers"("created_by_import_batch_id");
CREATE UNIQUE INDEX "receivable_ledger_revisions_ledger_id_revision_key" ON "receivable_ledger_revisions"("ledger_id", "revision");
CREATE INDEX "receivable_ledger_revisions_import_batch_id_idx" ON "receivable_ledger_revisions"("import_batch_id");
CREATE INDEX "receivable_invoices_ledger_id_status_invoice_date_idx" ON "receivable_invoices"("ledger_id", "status", "invoice_date");
CREATE INDEX "receivable_receipts_ledger_id_status_receipt_date_idx" ON "receivable_receipts"("ledger_id", "status", "receipt_date");
CREATE UNIQUE INDEX "receivable_attachments_file_id_key" ON "receivable_attachments"("file_id");
CREATE INDEX "receivable_attachments_ledger_id_status_idx" ON "receivable_attachments"("ledger_id", "status");
CREATE UNIQUE INDEX "receivable_import_items_batch_id_row_number_key" ON "receivable_import_items"("batch_id", "row_number");
CREATE INDEX "receivable_import_items_ledger_id_idx" ON "receivable_import_items"("ledger_id");
CREATE INDEX "receivable_import_items_contract_no_normalized_idx" ON "receivable_import_items"("contract_no_normalized");
CREATE INDEX "receivable_export_jobs_requested_by_created_at_idx" ON "receivable_export_jobs"("requested_by", "created_at");
CREATE INDEX "receivable_export_jobs_status_expires_at_idx" ON "receivable_export_jobs"("status", "expires_at");

ALTER TABLE "receivable_settings" ADD CONSTRAINT "receivable_settings_singleton" CHECK ("id" = 1);
ALTER TABLE "receivable_departments" ADD CONSTRAINT "receivable_departments_revision_positive" CHECK ("revision" > 0);
ALTER TABLE "receivable_access_grants" ADD CONSTRAINT "receivable_access_grants_revision_positive" CHECK ("revision" > 0);
ALTER TABLE "receivable_grant_departments" ADD CONSTRAINT "receivable_grant_departments_write_implies_read" CHECK (NOT "can_write" OR "can_read");
ALTER TABLE "receivable_dictionary_options" ADD CONSTRAINT "receivable_dictionary_options_revision_positive" CHECK ("revision" > 0);
ALTER TABLE "receivable_import_batches" ADD CONSTRAINT "receivable_import_batch_counts_nonnegative" CHECK ("row_count" >= 0 AND "error_count" >= 0);
ALTER TABLE "receivable_import_batches" ADD CONSTRAINT "receivable_import_batches_revision_positive" CHECK ("revision" > 0);
ALTER TABLE "receivable_ledgers" ADD CONSTRAINT "receivable_ledger_amounts_nonnegative" CHECK (("contract_amount" IS NULL OR "contract_amount" >= 0) AND ("final_amount" IS NULL OR "final_amount" >= 0) AND "writeoff_amount" >= 0);
ALTER TABLE "receivable_ledgers" ADD CONSTRAINT "receivable_ledgers_revision_positive" CHECK ("revision" > 0);
ALTER TABLE "receivable_ledger_revisions" ADD CONSTRAINT "receivable_ledger_revisions_revision_positive" CHECK ("revision" > 0);
ALTER TABLE "receivable_invoices" ADD CONSTRAINT "receivable_invoice_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "receivable_invoices" ADD CONSTRAINT "receivable_invoices_revision_positive" CHECK ("revision" > 0);
ALTER TABLE "receivable_receipts" ADD CONSTRAINT "receivable_receipt_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "receivable_receipts" ADD CONSTRAINT "receivable_receipts_revision_positive" CHECK ("revision" > 0);
ALTER TABLE "receivable_attachments" ADD CONSTRAINT "receivable_attachments_revision_positive" CHECK ("revision" > 0);

ALTER TABLE "receivable_settings" ADD CONSTRAINT "receivable_settings_finance_organization_id_fkey" FOREIGN KEY ("finance_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_settings" ADD CONSTRAINT "receivable_settings_configuration_confirmed_by_fkey" FOREIGN KEY ("configuration_confirmed_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_departments" ADD CONSTRAINT "receivable_departments_deactivated_by_fkey" FOREIGN KEY ("deactivated_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_access_grants" ADD CONSTRAINT "receivable_access_grants_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_access_grants" ADD CONSTRAINT "receivable_access_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_access_grants" ADD CONSTRAINT "receivable_access_grants_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_grant_departments" ADD CONSTRAINT "receivable_grant_departments_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "receivable_access_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_grant_departments" ADD CONSTRAINT "receivable_grant_departments_finance_department_id_fkey" FOREIGN KEY ("finance_department_id") REFERENCES "receivable_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_dictionary_options" ADD CONSTRAINT "receivable_dictionary_options_deactivated_by_fkey" FOREIGN KEY ("deactivated_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_import_batches" ADD CONSTRAINT "receivable_import_batches_original_file_id_fkey" FOREIGN KEY ("original_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_import_batches" ADD CONSTRAINT "receivable_import_batches_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_import_batches" ADD CONSTRAINT "receivable_import_batches_applied_by_fkey" FOREIGN KEY ("applied_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_import_batches" ADD CONSTRAINT "receivable_import_batches_rolled_back_by_fkey" FOREIGN KEY ("rolled_back_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_ledgers" ADD CONSTRAINT "receivable_ledgers_finance_department_id_fkey" FOREIGN KEY ("finance_department_id") REFERENCES "receivable_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_ledgers" ADD CONSTRAINT "receivable_ledgers_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_ledgers" ADD CONSTRAINT "receivable_ledgers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_ledgers" ADD CONSTRAINT "receivable_ledgers_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_ledgers" ADD CONSTRAINT "receivable_ledgers_created_by_import_batch_id_fkey" FOREIGN KEY ("created_by_import_batch_id") REFERENCES "receivable_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_ledger_revisions" ADD CONSTRAINT "receivable_ledger_revisions_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "receivable_ledgers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_ledger_revisions" ADD CONSTRAINT "receivable_ledger_revisions_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_ledger_revisions" ADD CONSTRAINT "receivable_ledger_revisions_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "receivable_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_invoices" ADD CONSTRAINT "receivable_invoices_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "receivable_ledgers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_invoices" ADD CONSTRAINT "receivable_invoices_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_invoices" ADD CONSTRAINT "receivable_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_receipts" ADD CONSTRAINT "receivable_receipts_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "receivable_ledgers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_receipts" ADD CONSTRAINT "receivable_receipts_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_receipts" ADD CONSTRAINT "receivable_receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_attachments" ADD CONSTRAINT "receivable_attachments_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "receivable_ledgers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_attachments" ADD CONSTRAINT "receivable_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_attachments" ADD CONSTRAINT "receivable_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_attachments" ADD CONSTRAINT "receivable_attachments_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_import_items" ADD CONSTRAINT "receivable_import_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "receivable_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_import_items" ADD CONSTRAINT "receivable_import_items_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "receivable_ledgers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_export_jobs" ADD CONSTRAINT "receivable_export_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
