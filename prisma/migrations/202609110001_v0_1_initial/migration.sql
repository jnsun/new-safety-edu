-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('pending', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('employee', 'contractor', 'temporary_individual');

-- CreateEnum
CREATE TYPE "PersonStatus" AS ENUM ('pending', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('company', 'business_entity', 'department', 'contractor');

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('company_admin', 'org_admin', 'project_admin', 'learner');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('company', 'organization', 'project', 'person');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('active', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('pending', 'active', 'rejected', 'removed');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('photo', 'signature', 'courseware', 'attachment');

-- CreateEnum
CREATE TYPE "CoursewareType" AS ENUM ('rich_text', 'single_html');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('draft', 'published', 'retired');

-- CreateEnum
CREATE TYPE "TrainingType" AS ENUM ('three_level', 'project_induction', 'routine', 'change_update');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('single_choice', 'multiple_choice', 'true_false');

-- CreateEnum
CREATE TYPE "PaperMode" AS ENUM ('fixed', 'random');

-- CreateEnum
CREATE TYPE "BatchSource" AS ENUM ('online', 'offline', 'reconfirmation');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('pending_learning', 'learning', 'pending_exam', 'remediation_required', 'locked', 'pending_signature', 'confirmation_pending', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('in_progress', 'submitted', 'expired');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('unread', 'read');

-- CreateEnum
CREATE TYPE "ChangeRequestType" AS ENUM ('binding', 'profile_change', 'registration', 'binding_change');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "username" VARCHAR(80),
    "password_hash" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "person_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "type" "PersonType" NOT NULL,
    "status" "PersonStatus" NOT NULL DEFAULT 'pending',
    "national_id_cipher" TEXT NOT NULL,
    "national_id_iv" TEXT NOT NULL,
    "national_id_tag" TEXT NOT NULL,
    "national_id_hash" VARCHAR(64) NOT NULL,
    "national_id_last4" CHAR(4) NOT NULL,
    "photo_file_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wechat_bindings" (
    "id" UUID NOT NULL,
    "app_id" VARCHAR(64) NOT NULL,
    "openid" VARCHAR(128) NOT NULL,
    "unionid" VARCHAR(128),
    "account_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "bound_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wechat_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "parent_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignments" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "role" "RoleName" NOT NULL,
    "scope_type" "ScopeType" NOT NULL,
    "scope_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "responsible_organization_id" UUID NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "kind" "FileKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coursewares" (
    "id" UUID NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "type" "CoursewareType" NOT NULL,
    "scope_type" "ScopeType" NOT NULL,
    "scope_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coursewares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courseware_versions" (
    "id" UUID NOT NULL,
    "courseware_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "rich_text" TEXT,
    "file_id" UUID,
    "content_hash" VARCHAR(64) NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courseware_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "type" "TrainingType" NOT NULL,
    "scope_type" "ScopeType" NOT NULL,
    "scope_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_template_items" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "courseware_version_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_banks" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "scope_type" "ScopeType" NOT NULL,
    "scope_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "bank_id" UUID NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correct" JSONB NOT NULL,
    "explanation" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_papers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "mode" "PaperMode" NOT NULL,
    "bank_id" UUID,
    "random_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_papers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_paper_items" (
    "id" UUID NOT NULL,
    "paper_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "score" DECIMAL(6,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_paper_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_batches" (
    "id" UUID NOT NULL,
    "business_key" VARCHAR(180) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "type" "TrainingType" NOT NULL,
    "source" "BatchSource" NOT NULL DEFAULT 'online',
    "template_id" UUID,
    "project_id" UUID,
    "paper_id" UUID,
    "due_at" TIMESTAMP(3),
    "duration_min" INTEGER NOT NULL DEFAULT 30,
    "pass_score" DECIMAL(6,2) NOT NULL DEFAULT 80,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "offline_detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_assignments" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'pending_learning',
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_progress" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "courseware_version_id" UUID NOT NULL,
    "opened_at" TIMESTAMP(3),
    "reached_end_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "remediation_round" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_attempts" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'in_progress',
    "snapshot" JSONB NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "score" DECIMAL(6,2),
    "passed" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_answers" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "answer" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signatures" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "record_hash" VARCHAR(64) NOT NULL,
    "device_info" JSONB,
    "correction_of_id" UUID,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_confirmations" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "confirmed_by" UUID NOT NULL,
    "note" TEXT,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "assignment_id" UUID,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'unread',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_requests" (
    "id" UUID NOT NULL,
    "person_id" UUID,
    "account_id" UUID,
    "project_id" UUID,
    "type" "ChangeRequestType" NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "object_type" VARCHAR(80) NOT NULL,
    "object_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_username_key" ON "accounts"("username");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_person_id_key" ON "accounts"("person_id");

-- CreateIndex
CREATE INDEX "persons_phone_status_idx" ON "persons"("phone", "status");

-- CreateIndex
CREATE UNIQUE INDEX "persons_national_id_hash_key" ON "persons"("national_id_hash");

-- CreateIndex
CREATE UNIQUE INDEX "wechat_bindings_app_id_openid_key" ON "wechat_bindings"("app_id", "openid");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_parent_id_name_key" ON "organizations"("parent_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_person_id_organization_id_key" ON "organization_memberships"("person_id", "organization_id");

-- CreateIndex
CREATE INDEX "role_assignments_role_scope_type_scope_id_active_idx" ON "role_assignments"("role", "scope_type", "scope_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignments_account_id_role_scope_type_scope_id_key" ON "role_assignments"("account_id", "role", "scope_type", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_person_id_key" ON "project_members"("project_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "courseware_versions_courseware_id_version_key" ON "courseware_versions"("courseware_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "training_template_items_template_id_courseware_version_id_key" ON "training_template_items"("template_id", "courseware_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_paper_items_paper_id_question_id_key" ON "exam_paper_items"("paper_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "training_batches_business_key_key" ON "training_batches"("business_key");

-- CreateIndex
CREATE UNIQUE INDEX "training_assignments_batch_id_person_id_key" ON "training_assignments"("batch_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_progress_assignment_id_courseware_version_id_remed_key" ON "learning_progress"("assignment_id", "courseware_version_id", "remediation_round");

-- CreateIndex
CREATE UNIQUE INDEX "exam_attempts_assignment_id_attempt_number_key" ON "exam_attempts"("assignment_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "exam_answers_attempt_id_question_id_key" ON "exam_answers"("attempt_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "signatures_assignment_id_correction_of_id_key" ON "signatures"("assignment_id", "correction_of_id");

-- CreateIndex
CREATE INDEX "audit_logs_object_type_object_id_idx" ON "audit_logs"("object_type", "object_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_account_id_key_key" ON "user_preferences"("account_id", "key");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_photo_file_id_fkey" FOREIGN KEY ("photo_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wechat_bindings" ADD CONSTRAINT "wechat_bindings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_responsible_organization_id_fkey" FOREIGN KEY ("responsible_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courseware_versions" ADD CONSTRAINT "courseware_versions_courseware_id_fkey" FOREIGN KEY ("courseware_id") REFERENCES "coursewares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courseware_versions" ADD CONSTRAINT "courseware_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_template_items" ADD CONSTRAINT "training_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "training_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_template_items" ADD CONSTRAINT "training_template_items_courseware_version_id_fkey" FOREIGN KEY ("courseware_version_id") REFERENCES "courseware_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "question_banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_papers" ADD CONSTRAINT "exam_papers_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "question_banks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_paper_items" ADD CONSTRAINT "exam_paper_items_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "exam_papers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_paper_items" ADD CONSTRAINT "exam_paper_items_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_batches" ADD CONSTRAINT "training_batches_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "training_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_batches" ADD CONSTRAINT "training_batches_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_batches" ADD CONSTRAINT "training_batches_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "exam_papers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "training_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "training_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_courseware_version_id_fkey" FOREIGN KEY ("courseware_version_id") REFERENCES "courseware_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "training_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "exam_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "training_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_correction_of_id_fkey" FOREIGN KEY ("correction_of_id") REFERENCES "signatures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_confirmations" ADD CONSTRAINT "project_confirmations_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "training_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "training_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- V0.1 invariants not expressible in Prisma schema.
CREATE UNIQUE INDEX "persons_active_phone_key" ON "persons"("phone") WHERE "status" = 'active';
CREATE UNIQUE INDEX "role_assignments_company_role_key" ON "role_assignments"("account_id", "role") WHERE "scope_type" = 'company' AND "scope_id" IS NULL;
CREATE UNIQUE INDEX "signatures_original_assignment_key" ON "signatures"("assignment_id") WHERE "correction_of_id" IS NULL;

ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_scope_shape_check"
CHECK (("scope_type" = 'company' AND "scope_id" IS NULL) OR ("scope_type" <> 'company' AND "scope_id" IS NOT NULL));

CREATE FUNCTION "prevent_signature_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'formal signatures are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "signatures_append_only"
BEFORE UPDATE OR DELETE ON "signatures"
FOR EACH ROW EXECUTE FUNCTION "prevent_signature_mutation"();

CREATE FUNCTION "protect_final_business_records"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'training_assignments' AND OLD."status" = 'completed' AND NEW."status" <> 'completed' THEN
    RAISE EXCEPTION 'completed assignments cannot be reopened';
  END IF;
  IF TG_TABLE_NAME = 'exam_attempts' AND OLD."status" = 'submitted' THEN
    RAISE EXCEPTION 'submitted exam attempts are immutable';
  END IF;
  IF TG_TABLE_NAME = 'courseware_versions' AND OLD."status" = 'published' THEN
    RAISE EXCEPTION 'published courseware versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "training_assignments_no_completion_regression"
BEFORE UPDATE ON "training_assignments" FOR EACH ROW EXECUTE FUNCTION "protect_final_business_records"();
CREATE TRIGGER "exam_attempts_submitted_immutable"
BEFORE UPDATE ON "exam_attempts" FOR EACH ROW EXECUTE FUNCTION "protect_final_business_records"();
CREATE TRIGGER "courseware_versions_published_immutable"
BEFORE UPDATE ON "courseware_versions" FOR EACH ROW EXECUTE FUNCTION "protect_final_business_records"();
