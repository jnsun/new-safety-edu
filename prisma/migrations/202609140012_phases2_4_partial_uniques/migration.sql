CREATE UNIQUE INDEX "training_automation_configs_one_active_context"
  ON "training_automation_configs"("type","scope_type",COALESCE("scope_id",'00000000-0000-0000-0000-000000000000'::UUID)) WHERE "active";
CREATE UNIQUE INDEX "project_monthly_reports_one_nonvoid_month"
  ON "project_monthly_reports"("project_id","report_month") WHERE "status" <> 'voided';
CREATE INDEX "project_monthly_reports_project_id_report_month_status_idx" ON "project_monthly_reports"("project_id","report_month","status");
CREATE UNIQUE INDEX "department_month_statuses_one_active_month"
  ON "department_month_statuses"("organization_id","reporting_year","reporting_month") WHERE "active";
CREATE INDEX "department_month_statuses_organization_id_reporting_year_reporting_month_active_idx"
  ON "department_month_statuses"("organization_id","reporting_year","reporting_month","active");
