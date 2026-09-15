CREATE TYPE "SensitiveExportStatus" AS ENUM ('pending', 'processing', 'ready', 'failed', 'downloaded', 'expired');
CREATE TYPE "SensitiveExportScopeType" AS ENUM ('company', 'organization', 'project');

CREATE TABLE "sensitive_export_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "requested_by" UUID NOT NULL,
  "scope_type" "SensitiveExportScopeType" NOT NULL,
  "scope_id" UUID,
  "scope_snapshot" JSONB NOT NULL,
  "categories" JSONB NOT NULL,
  "request_key" VARCHAR(64) NOT NULL,
  "status" "SensitiveExportStatus" NOT NULL DEFAULT 'pending',
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
  CONSTRAINT "sensitive_export_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sensitive_export_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sensitive_export_scope_id_check" CHECK (("scope_type" = 'company' AND "scope_id" IS NULL) OR ("scope_type" <> 'company' AND "scope_id" IS NOT NULL))
);

CREATE INDEX "sensitive_export_jobs_requested_by_created_at_idx" ON "sensitive_export_jobs"("requested_by", "created_at");
CREATE INDEX "sensitive_export_jobs_status_expires_at_idx" ON "sensitive_export_jobs"("status", "expires_at");
CREATE UNIQUE INDEX "sensitive_export_jobs_one_active_request" ON "sensitive_export_jobs"("requested_by", "request_key") WHERE "status" IN ('pending', 'processing', 'ready');
