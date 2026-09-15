ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'merged';
ALTER TYPE "ChangeRequestType" ADD VALUE IF NOT EXISTS 'account_merge';

ALTER TABLE "accounts"
  ADD COLUMN "merged_into_account_id" UUID,
  ADD COLUMN "merged_at" TIMESTAMP(3);

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_merged_into_account_id_fkey"
  FOREIGN KEY ("merged_into_account_id") REFERENCES "accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "accounts_merged_into_account_id_idx"
  ON "accounts"("merged_into_account_id");

ALTER TABLE "organization_memberships"
  ADD COLUMN "ended_at" TIMESTAMP(3),
  ADD COLUMN "ended_by" UUID,
  ADD COLUMN "end_reason" VARCHAR(500);

ALTER TABLE "role_assignments"
  ADD COLUMN "ended_at" TIMESTAMP(3),
  ADD COLUMN "ended_by" UUID,
  ADD COLUMN "end_reason" VARCHAR(500);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "organization_memberships"
    WHERE "active" AND "primary"
    GROUP BY "person_id" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'phase1 migration blocked: a person has multiple active primary organizations';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "role_assignments"
    WHERE "active" AND "role" = 'org_leader' AND "scope_type" = 'organization'
    GROUP BY "scope_id" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'phase1 migration blocked: an organization has multiple active leaders';
  END IF;

  IF (SELECT COUNT(*) FROM "organizations" WHERE "type" = 'company') > 1 THEN
    RAISE EXCEPTION 'phase1 migration blocked: multiple company roots exist';
  END IF;
END $$;

DROP INDEX IF EXISTS "organization_memberships_person_id_organization_id_key";
DROP INDEX IF EXISTS "role_assignments_account_id_role_scope_type_scope_id_key";
DROP INDEX IF EXISTS "role_assignments_company_role_key";

CREATE INDEX "organization_memberships_person_id_active_primary_idx"
  ON "organization_memberships"("person_id", "active", "primary");
CREATE INDEX "organization_memberships_organization_id_active_idx"
  ON "organization_memberships"("organization_id", "active");
CREATE INDEX "role_assignments_account_id_active_idx"
  ON "role_assignments"("account_id", "active");

CREATE UNIQUE INDEX "organization_memberships_one_active_primary_per_person"
  ON "organization_memberships"("person_id")
  WHERE "active" AND "primary";

CREATE UNIQUE INDEX "role_assignments_one_active_org_leader"
  ON "role_assignments"("scope_id")
  WHERE "active" AND "role" = 'org_leader' AND "scope_type" = 'organization';

CREATE UNIQUE INDEX "role_assignments_one_active_assignment"
  ON "role_assignments"(
    "account_id",
    "role",
    "scope_type",
    COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::UUID)
  )
  WHERE "active";

CREATE UNIQUE INDEX "organizations_one_company_root"
  ON "organizations"("type")
  WHERE "type" = 'company';
