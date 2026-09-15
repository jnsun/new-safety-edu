ALTER TYPE "PersonStatus" ADD VALUE IF NOT EXISTS 'merged';
ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'withdrawn';
ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'ended';
ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE "ChangeRequestStatus" ADD VALUE IF NOT EXISTS 'withdrawn';
ALTER TYPE "ChangeRequestStatus" ADD VALUE IF NOT EXISTS 'failed';

ALTER TABLE "accounts"
  ADD COLUMN "username_normalized" VARCHAR(80),
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "password_login_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "last_login_at" TIMESTAMP(3);

UPDATE "accounts"
SET "username_normalized" = lower("username"),
    "password_login_enabled" = ("password_hash" IS NOT NULL)
WHERE "username" IS NOT NULL OR "password_hash" IS NOT NULL;

ALTER TABLE "persons"
  ADD COLUMN "merged_into_person_id" UUID,
  ADD COLUMN "merged_at" TIMESTAMP(3),
  ADD COLUMN "merged_by" UUID,
  ADD COLUMN "merge_reason" VARCHAR(500);

ALTER TABLE "persons"
  ADD CONSTRAINT "persons_merged_into_person_id_fkey"
  FOREIGN KEY ("merged_into_person_id") REFERENCES "persons"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "role_assignments" ADD COLUMN "person_id" UUID;

UPDATE "role_assignments" AS role
SET "person_id" = account."person_id"
FROM "accounts" AS account
WHERE account."id" = role."account_id";

ALTER TABLE "role_assignments"
  ADD CONSTRAINT "role_assignments_person_id_fkey"
  FOREIGN KEY ("person_id") REFERENCES "persons"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "role_assignments"
  DROP CONSTRAINT "role_assignments_account_id_fkey",
  ADD CONSTRAINT "role_assignments_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "wechat_bindings"
  ADD COLUMN "ended_at" TIMESTAMP(3),
  ADD COLUMN "ended_by" UUID,
  ADD COLUMN "end_reason" VARCHAR(500);

ALTER TABLE "refresh_sessions"
  ADD COLUMN "client_kind" VARCHAR(20),
  ADD COLUMN "family_id" UUID,
  ADD COLUMN "rotated_from_id" UUID,
  ADD COLUMN "last_used_at" TIMESTAMP(3),
  ADD COLUMN "user_agent" VARCHAR(500);

ALTER TABLE "refresh_sessions"
  ADD CONSTRAINT "refresh_sessions_rotated_from_id_fkey"
  FOREIGN KEY ("rotated_from_id") REFERENCES "refresh_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_members"
  ADD COLUMN "previous_membership_id" UUID,
  ADD COLUMN "ended_at" TIMESTAMP(3),
  ADD COLUMN "ended_by" UUID,
  ADD COLUMN "end_reason" VARCHAR(500);

ALTER TABLE "project_members"
  ADD CONSTRAINT "project_members_previous_membership_id_fkey"
  FOREIGN KEY ("previous_membership_id") REFERENCES "project_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "change_requests"
  ADD COLUMN "request_key" VARCHAR(160),
  ADD COLUMN "before_summary" JSONB,
  ADD COLUMN "after_summary" JSONB;

ALTER TABLE "audit_logs"
  ADD COLUMN "request_id" VARCHAR(120),
  ADD COLUMN "actor_role" VARCHAR(40),
  ADD COLUMN "actor_scope_type" VARCHAR(40),
  ADD COLUMN "actor_scope_id" UUID,
  ADD COLUMN "result" VARCHAR(40);

CREATE TABLE "username_history" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "username" VARCHAR(80) NOT NULL,
  "username_normalized" VARCHAR(80) NOT NULL,
  "ended_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changed_by" UUID,
  "reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "username_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "username_history_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

DO $$
BEGIN
  IF EXISTS (
    SELECT lower("username")
    FROM "accounts"
    WHERE "username" IS NOT NULL
    GROUP BY lower("username")
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'person-account migration blocked: case-insensitive duplicate usernames exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "role_assignments"
    WHERE "active"
      AND "person_id" IS NULL
      AND NOT ("role" = 'company_admin' AND "scope_type" = 'company' AND "scope_id" IS NULL)
  ) THEN
    RAISE EXCEPTION 'person-account migration blocked: an active role has no linked person';
  END IF;

  IF EXISTS (
    SELECT "account_id", "app_id"
    FROM "wechat_bindings"
    WHERE "active"
    GROUP BY "account_id", "app_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'person-account migration blocked: an account has multiple active WeChat bindings for one AppID';
  END IF;

  IF EXISTS (
    SELECT "project_id", "person_id"
    FROM "project_members"
    WHERE "status" IN ('pending', 'active')
    GROUP BY "project_id", "person_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'person-account migration blocked: duplicate current project memberships exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "accounts_username_normalized_key"
  ON "accounts"("username_normalized");
CREATE INDEX "persons_merged_into_person_id_idx"
  ON "persons"("merged_into_person_id");
CREATE INDEX "role_assignments_person_id_active_idx"
  ON "role_assignments"("person_id", "active");
CREATE UNIQUE INDEX "wechat_bindings_one_active_account_per_app"
  ON "wechat_bindings"("account_id", "app_id") WHERE "active";
CREATE UNIQUE INDEX "refresh_sessions_rotated_from_id_key"
  ON "refresh_sessions"("rotated_from_id");
CREATE INDEX "project_members_project_id_person_id_status_idx"
  ON "project_members"("project_id", "person_id", "status");
CREATE INDEX "project_members_previous_membership_id_idx"
  ON "project_members"("previous_membership_id");
CREATE UNIQUE INDEX "username_history_username_normalized_key"
  ON "username_history"("username_normalized");
CREATE INDEX "username_history_account_id_ended_at_idx"
  ON "username_history"("account_id", "ended_at");
CREATE INDEX "audit_logs_request_id_idx"
  ON "audit_logs"("request_id");

ALTER TABLE "persons"
  ADD CONSTRAINT "persons_merge_target_not_self"
  CHECK ("merged_into_person_id" IS NULL OR "merged_into_person_id" <> "id");
