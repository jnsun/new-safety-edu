import assert from "node:assert/strict";
import { reportStats, validateReportFields } from "../src/project-reporting-core.js";

const fields = [{ fieldKey: "project_manager", label: "项目负责人", required: true, active: true, fieldType: "text" as const, options: [] }, { fieldKey: "custom_level", label: "风险等级", required: true, active: true, fieldType: "select" as const, options: ["低", "中", "高"] }];
assert.deepEqual(validateReportFields({ project_manager: "匿名负责人", custom_level: "中", safetyHazards: false }, fields), []);
assert.deepEqual(validateReportFields({ project_manager: "", custom_level: "未知", safetyHazards: true }, fields), ["项目负责人必填", "风险等级必须从配置选项中选择", "存在安全隐患时必须填写隐患详情"]);
assert.deepEqual(reportStats([{ id: "a" }, { id: "b" }, { id: "c" }], [{ reportingOrganizationId: "a", onsiteCount: 5, onsiteVehicles: 2, safetyHazards: true, safetyInspection: true }], ["b"]), { departmentTotal: 3, submittedDepartments: 1, noFieldDepartments: 1, missingDepartments: 1, projectCount: 1, onsitePeople: 5, onsiteVehicles: 2, hazardProjects: 1, inspectionRate: 100 });
console.log("project reporting check passed: dynamic validation and monthly statistics");
