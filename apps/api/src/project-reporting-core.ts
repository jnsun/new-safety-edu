export type ReportFieldRule = { fieldKey: string; label: string; required: boolean; active: boolean; fieldType: "text" | "number" | "textarea" | "select" | "date"; options: unknown };

export function validateReportFields(values: Record<string, unknown>, fields: ReportFieldRule[]) {
  const errors: string[] = [];
  for (const field of fields) {
    if (!field.active) continue; const value = values[field.fieldKey]; const empty = value === undefined || value === null || String(value).trim() === "";
    if (field.required && empty) errors.push(`${field.label}必填`);
    if (!empty && field.fieldType === "number" && (!Number.isFinite(Number(value)) || Number(value) < 0)) errors.push(`${field.label}必须为非负数`);
    if (!empty && field.fieldType === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) errors.push(`${field.label}日期格式应为 YYYY-MM-DD`);
    if (!empty && field.fieldType === "select" && Array.isArray(field.options) && field.options.length && !field.options.includes(value)) errors.push(`${field.label}必须从配置选项中选择`);
  }
  if (values.safetyHazards === true && !String(values.safetyHazardDetail ?? "").trim()) errors.push("存在安全隐患时必须填写隐患详情");
  return errors;
}

export function reportStats(reportingOrganizations: Array<{ id: string }>, reports: Array<{ reportingOrganizationId: string; onsiteCount: number; onsiteVehicles: number; safetyHazards: boolean; safetyInspection: boolean }>, confirmedOrganizationIds: string[]) {
  const submitted = new Set(reports.map((row) => row.reportingOrganizationId)); const confirmed = new Set(confirmedOrganizationIds); const total = reportingOrganizations.length;
  return { departmentTotal: total, submittedDepartments: submitted.size, noFieldDepartments: [...confirmed].filter((id) => !submitted.has(id)).length, missingDepartments: reportingOrganizations.filter((row) => !submitted.has(row.id) && !confirmed.has(row.id)).length, projectCount: reports.length, onsitePeople: reports.reduce((sum, row) => sum + row.onsiteCount, 0), onsiteVehicles: reports.reduce((sum, row) => sum + row.onsiteVehicles, 0), hazardProjects: reports.filter((row) => row.safetyHazards).length, inspectionRate: reports.length ? Math.round(reports.filter((row) => row.safetyInspection).length / reports.length * 100) : 0 };
}
