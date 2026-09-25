CREATE TYPE "ContractGrantRole" AS ENUM ('admin', 'editor', 'readonly');
CREATE TYPE "ContractBidStatus" AS ENUM ('bidding', 'won', 'lost', 'abandoned');
CREATE TYPE "ContractProjectStage" AS ENUM ('bid_preparation', 'contract_registration', 'field_work', 'indoor_sorting', 'report_drafting', 'submitted_review', 'accepted', 'warranty_payment', 'closed', 'terminated');
CREATE TYPE "ContractAttachmentOwnerType" AS ENUM ('bid', 'project', 'main_contract', 'supplement', 'subcontract');

CREATE TABLE "contract_main_contracts" (
    "id" UUID NOT NULL,
    "contract_no" VARCHAR(120) NOT NULL,
    "raw_contract_no" VARCHAR(200),
    "party_a" VARCHAR(240) NOT NULL,
    "amount_yuan" DECIMAL(18,2),
    "annual_amount_yuan" DECIMAL(18,2),
    "signed_at" DATE,
    "handler_name" VARCHAR(80),
    "source_note" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contract_main_contracts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_main_contracts_contract_no_key" ON "contract_main_contracts"("contract_no");

ALTER TABLE "projects"
  ADD COLUMN "contract_bid_status" "ContractBidStatus",
  ADD COLUMN "contract_stage" "ContractProjectStage",
  ADD COLUMN "contract_business_sector" VARCHAR(120),
  ADD COLUMN "contract_registered_at" DATE,
  ADD COLUMN "contract_data_source" VARCHAR(80),
  ADD COLUMN "main_contract_id" UUID;

ALTER TABLE "projects" ADD CONSTRAINT "projects_main_contract_id_fkey"
  FOREIGN KEY ("main_contract_id") REFERENCES "contract_main_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "projects_main_contract_id_key" ON "projects"("main_contract_id");

CREATE TABLE "contract_supplements" (
    "id" UUID NOT NULL,
    "main_contract_id" UUID NOT NULL,
    "contract_no" VARCHAR(120) NOT NULL,
    "amount_delta_yuan" DECIMAL(18,2),
    "signed_at" DATE,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contract_supplements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contract_supplements_main_contract_id_fkey" FOREIGN KEY ("main_contract_id") REFERENCES "contract_main_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "contract_supplements_contract_no_key" ON "contract_supplements"("contract_no");
CREATE INDEX "contract_supplements_main_contract_id_idx" ON "contract_supplements"("main_contract_id");

CREATE TABLE "contract_subcontracts" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "contract_no" VARCHAR(120) NOT NULL,
    "subcontractor_name" VARCHAR(240) NOT NULL,
    "amount_yuan" DECIMAL(18,2),
    "scope" VARCHAR(1000),
    "signed_at" DATE,
    "owning_organization_id" UUID NOT NULL,
    "handler_name" VARCHAR(80),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contract_subcontracts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contract_subcontracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contract_subcontracts_owning_organization_id_fkey" FOREIGN KEY ("owning_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "contract_subcontracts_contract_no_key" ON "contract_subcontracts"("contract_no");
CREATE INDEX "contract_subcontracts_project_id_idx" ON "contract_subcontracts"("project_id");
CREATE INDEX "contract_subcontracts_owning_organization_id_idx" ON "contract_subcontracts"("owning_organization_id");

CREATE TABLE "contract_project_status_history" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "from_stage" "ContractProjectStage",
    "to_stage" "ContractProjectStage" NOT NULL,
    "reason" VARCHAR(500),
    "changed_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_project_status_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contract_project_status_history_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contract_project_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "contract_project_status_history_project_id_created_at_idx" ON "contract_project_status_history"("project_id", "created_at");

CREATE TABLE "contract_access_grants" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "account_id" UUID,
    "role" "ContractGrantRole" NOT NULL,
    "can_create_project" BOOLEAN NOT NULL DEFAULT false,
    "can_edit_project" BOOLEAN NOT NULL DEFAULT false,
    "can_manage_contracts" BOOLEAN NOT NULL DEFAULT false,
    "can_upload_attachments" BOOLEAN NOT NULL DEFAULT false,
    "can_change_stage" BOOLEAN NOT NULL DEFAULT false,
    "can_export" BOOLEAN NOT NULL DEFAULT false,
    "can_view_all" BOOLEAN NOT NULL DEFAULT false,
    "can_manage_access" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "granted_by" UUID NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grant_reason" VARCHAR(500) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" UUID,
    "revoke_reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contract_access_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contract_access_grants_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contract_access_grants_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contract_access_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contract_access_grants_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "contract_access_grants_person_id_active_idx" ON "contract_access_grants"("person_id", "active");
CREATE INDEX "contract_access_grants_account_id_active_idx" ON "contract_access_grants"("account_id", "active");
CREATE INDEX "contract_access_grants_role_active_idx" ON "contract_access_grants"("role", "active");
CREATE UNIQUE INDEX "contract_access_grants_one_active_person_idx" ON "contract_access_grants"("person_id") WHERE "active" = true AND "revoked_at" IS NULL;

CREATE TABLE "contract_attachments" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "owner_type" "ContractAttachmentOwnerType" NOT NULL,
    "owner_id" UUID,
    "category" VARCHAR(80),
    "note" VARCHAR(500),
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contract_attachments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contract_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contract_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "contract_attachments_project_id_created_at_idx" ON "contract_attachments"("project_id", "created_at");
CREATE INDEX "contract_attachments_file_id_idx" ON "contract_attachments"("file_id");
CREATE INDEX "contract_attachments_owner_type_owner_id_idx" ON "contract_attachments"("owner_type", "owner_id");
