import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFile(resolve(root, path), "utf8");
const [schema, api, resolver, app, workflow, schedule, dashboard, courseware] = await Promise.all([
  read("prisma/schema.prisma"), read("apps/api/src/routes/day2.ts"), read("apps/api/src/training-workflow.ts"), read("apps/admin/src/App.tsx"), read("apps/admin/src/training/TrainingWorkflowPage.tsx"), read("apps/admin/src/training/TrainingPage.tsx"), read("apps/admin/src/Day4Pages.tsx"), read("apps/admin/src/courseware/CoursewarePage.tsx")
]);

for (const field of ["coursewareSnapshot", "paperSnapshot", "dispatchFingerprint", "dispatchResult"]) assert.match(schema, new RegExp(field), `missing ${field}`);
for (const route of ["/api/training-batches/preflight", 'app.post("/api/training-batches"']) assert.match(api, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing ${route}`);
for (const guard of ["PREFLIGHT_STALE", "IDEMPOTENCY_KEY_REUSED", "Serializable", "dispatchResult"]) assert.ok(api.includes(guard), `missing ${guard}`);
for (const rule of ["三级安全教育和项目入场教育必须考试", "UNPUBLISHED_COURSEWARE", "INSUFFICIENT_QUESTIONS", "NO_TARGETS", "完整的授权组织"]) assert.ok(resolver.includes(rule), `missing ${rule}`);
assert.ok(app.includes('path="/training/new"') && app.includes("TrainingWorkflowPage"), "real workflow route missing");
for (const step of ["基本信息", "学习内容", "考试设置", "保存与预览", "范围并下发"]) assert.ok(workflow.includes(step), `missing wizard step ${step}`);
for (const behavior of ["快速新建课件", "就地维护题库并新建试卷", "服务端覆盖预检", "确认下发", "离开培训制作", "查看本批次培训进度"]) assert.ok(workflow.includes(behavior), `missing behavior ${behavior}`);
for (const behavior of ["选择在确认后才会回填", "创建草稿", "发布版本", "回填培训", "training-learning-workspace", "training-readiness-list"]) assert.ok(workflow.includes(behavior), `missing refined workflow behavior ${behavior}`);
assert.ok(workflow.includes('value: "structured"') && workflow.includes('value: "single_html"'), "in-context authoring must retain structured and HTML courseware capabilities");
assert.ok(schedule.includes('navigate("/training/new")'), "training schedule entry is not wired");
assert.ok(dashboard.includes('navigate("/training/new")'), "dashboard entry is not wired");
assert.ok(courseware.includes('navigate("/training/new")'), "production center entry is not wired");
assert.ok(dashboard.includes('searchParams.get("batchId")'), "batch progress deep link missing");
console.log("TRAINING_WORKFLOW_POLICY=PASS");
