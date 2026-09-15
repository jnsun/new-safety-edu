ALTER TABLE "role_assignments"
  ALTER COLUMN "account_id" DROP NOT NULL,
  ADD COLUMN "activation_pending" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "role_assignments"
  ADD CONSTRAINT "role_assignments_activation_state_check"
  CHECK (
    NOT ("active" AND "activation_pending")
    AND (NOT "active" OR "account_id" IS NOT NULL)
    AND (NOT "activation_pending" OR ("person_id" IS NOT NULL AND "account_id" IS NULL))
    AND ("person_id" IS NOT NULL OR ("role" = 'company_admin' AND "scope_type" = 'company'))
  );

CREATE UNIQUE INDEX "role_assignments_one_pending_person_assignment"
  ON "role_assignments"(
    "person_id",
    "role",
    "scope_type",
    COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::UUID)
  )
  WHERE "activation_pending" AND "person_id" IS NOT NULL;
