DROP INDEX IF EXISTS "project_members_project_id_person_id_key";

CREATE UNIQUE INDEX "role_assignments_one_active_person_assignment"
  ON "role_assignments"(
    "person_id",
    "role",
    "scope_type",
    COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::UUID)
  )
  WHERE "active" AND "person_id" IS NOT NULL;

CREATE UNIQUE INDEX "project_members_one_pending_membership"
  ON "project_members"("project_id", "person_id")
  WHERE "status" = 'pending';

CREATE UNIQUE INDEX "project_members_one_current_membership"
  ON "project_members"("project_id", "person_id")
  WHERE "status" IN ('active', 'approved');

CREATE UNIQUE INDEX "change_requests_one_pending_request_key"
  ON "change_requests"("type", "request_key")
  WHERE "status" = 'pending' AND "request_key" IS NOT NULL;
