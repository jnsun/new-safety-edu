CREATE TABLE "courseware_version_assets" (
  "courseware_version_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "courseware_version_assets_pkey" PRIMARY KEY ("courseware_version_id", "file_id")
);

CREATE INDEX "courseware_version_assets_file_id_idx" ON "courseware_version_assets"("file_id");

ALTER TABLE "courseware_version_assets"
  ADD CONSTRAINT "courseware_version_assets_version_fkey"
  FOREIGN KEY ("courseware_version_id") REFERENCES "courseware_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "courseware_version_assets"
  ADD CONSTRAINT "courseware_version_assets_file_fkey"
  FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
