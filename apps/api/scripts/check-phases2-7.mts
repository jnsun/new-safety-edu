import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile("../../prisma/schema.prisma", "utf8");
const training = await readFile("src/routes/day2.ts", "utf8");
const reports = await readFile("src/routes/project-reporting.ts", "utf8");
const qualifications = await readFile("src/routes/qualifications.ts", "utf8");

for (const token of ["model TrainingAutomationConfig", "paperSnapshot", "extraAttempts", "model ProjectMonthlyReportRevision", "withdrawn", "voided", "projectSnapshot", "fieldSnapshot", "model ProjectMonthlyReportAttachment", "requiresAnnualTraining", "model CertificateAnnualTrainingStatus"]) assert.ok(schema.includes(token), `schema missing ${token}`);
assert.ok(!training.includes("orderBy: { createdAt: \"asc\" } });\n  const paper = await prisma.examPaper.findFirst"), "automatic dispatch must not pick the first template/paper");
assert.ok(!reports.includes("projectMonthlyReport.delete("), "monthly reports must never be physically deleted");
assert.ok(!reports.includes("departmentMonthStatus.deleteMany"), "no-project confirmations must be invalidated, not deleted");
assert.ok(!qualifications.includes("certificateTrainingRecord.delete("), "annual training records must never be physically deleted");
assert.ok(!qualifications.includes("function trainingDefault(typeName"), "annual training must not be inferred from Chinese names");
console.log("PHASES2_7_SOURCE_CHECK=PASS");
