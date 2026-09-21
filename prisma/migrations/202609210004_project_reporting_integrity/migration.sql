DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "project_monthly_reports"
    WHERE "status" <> 'voided'::"MonthlyReportStatus"
    GROUP BY "project_id", "report_month"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate current project monthly reports must be resolved before migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "department_month_statuses"
    WHERE "active"
    GROUP BY "organization_id", "reporting_year", "reporting_month"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate active department monthly submissions must be resolved before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "project_monthly_reports_one_current_per_month"
  ON "project_monthly_reports" ("project_id", "report_month")
  WHERE "status" <> 'voided'::"MonthlyReportStatus";

CREATE UNIQUE INDEX "department_month_statuses_one_active_per_month"
  ON "department_month_statuses" ("organization_id", "reporting_year", "reporting_month")
  WHERE "active";
