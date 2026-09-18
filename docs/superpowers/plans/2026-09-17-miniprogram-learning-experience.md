# 小程序核心培训学习体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有培训业务状态机的前提下，完成三级教育优先的待办首页、行动优先的任务详情、单题考试、课件学习、签字和培训记录体验。

**Architecture:** Fastify 继续提供权威任务、学习、考试和签字状态；新增一个纯函数策略模块统一计算待办优先级和下一步。原生微信小程序只渲染服务端状态并提交动作，不复制权限或完成判定。

**Tech Stack:** Node.js 22、Fastify、Prisma、Zod、原生微信小程序 JavaScript/WXML/WXSS、现有 `node:assert/strict` 检查脚本。

**Spec:** `docs/superpowers/specs/2026-09-17-miniprogram-training-courseware-design.md`

## Global Constraints

- 三级教育只面向 active 正式员工，并使用现有业务唯一键幂等下发。
- 未完成三级教育只获得最高展示优先级，不阻断其他培训或项目入场教育。
- 不显示或推导“可上岗”“禁止上岗”“准入有效”等资格结论。
- 正确答案和评分规则在最终交卷前不得返回客户端。
- 小程序只展示服务端权威状态，不能自行完成任务、通过考试、解锁或完成签字。
- 不增加 UI 框架、跨端框架或大型测试体系。

## File Map

- `apps/api/src/training-todo-priority.ts`：待办排序、优先提示和下一步纯函数。
- `apps/api/src/routes/day2.ts`：本人任务、课程、考试和学习接口的最小字段补充。
- `apps/api/scripts/check-training-todo-priority.mts`：三级教育优先与非阻断规则检查。
- `apps/miniprogram/app.wxss`：学习端共享视觉 token 和通用状态样式。
- `apps/miniprogram/pages/todo/*`：任务指挥台。
- `apps/miniprogram/pages/task/*`：行动优先任务详情。
- `apps/miniprogram/pages/courseware/*`：课件阅读和完成反馈。
- `apps/miniprogram/pages/exam/*`：单题沉浸、导航、自动保存和恢复位置。
- `apps/miniprogram/pages/signature/*`：记录摘要、Canvas、预览与正式提交。
- `apps/miniprogram/pages/records/*`、`pages/record-detail/*`：本人培训档案列表与详情。
- `scripts/check-miniprogram-training-flow.mjs`：页面结构与危险客户端逻辑静态检查。

---

### Task 1: 三级教育待办优先策略

**Files:**
- Create: `apps/api/src/training-todo-priority.ts`
- Create: `apps/api/scripts/check-training-todo-priority.mts`
- Modify: `apps/api/src/routes/day2.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: assignment DTO 中的 `trainingType`、`status`、`dueAt`、`createdAt`。
- Produces: `decorateTodoPriority<T extends TodoPriorityInput>(row: T, now: Date): T & TodoPriorityResult`，结果包含 `priorityRank`、`priorityReason`、`isThreeLevelPriority`。

- [ ] **Step 1: 写失败检查脚本**

```ts
import assert from "node:assert/strict";
import { decorateTodoPriority, sortTodoAssignments } from "../src/training-todo-priority.js";

const three = decorateTodoPriority({ trainingType: "three_level", status: "learning", dueAt: null, createdAt: new Date("2026-09-01") }, new Date("2026-09-17"));
const overdue = decorateTodoPriority({ trainingType: "routine", status: "learning", dueAt: new Date("2026-09-10"), createdAt: new Date("2026-09-02") }, new Date("2026-09-17"));
assert.equal(three.isThreeLevelPriority, true);
assert.deepEqual(sortTodoAssignments([overdue, three]).map((row) => row.trainingType), ["three_level", "routine"]);
assert.equal(three.blocksOtherTraining, false);
console.log("TRAINING_TODO_PRIORITY_OK");
```

- [ ] **Step 2: 运行检查并确认失败**

Run: `pnpm --filter @safety/api exec tsx scripts/check-training-todo-priority.mts`
Expected: FAIL，提示 `training-todo-priority.js` 不存在。

- [ ] **Step 3: 实现纯函数和稳定排序**

```ts
export type TodoPriorityInput = {
  trainingType: "three_level" | "project_induction" | "routine" | "change_update";
  status: string;
  dueAt: Date | null;
  createdAt: Date;
};

export function decorateTodoPriority<T extends TodoPriorityInput>(row: T, now: Date) {
  const isThreeLevelPriority = row.trainingType === "three_level" && row.status !== "completed" && row.status !== "cancelled";
  const overdue = !!row.dueAt && row.dueAt.getTime() < now.getTime();
  const dueSoon = !!row.dueAt && row.dueAt.getTime() >= now.getTime() && row.dueAt.getTime() - now.getTime() <= 3 * 86_400_000;
  return { ...row, isThreeLevelPriority, priorityRank: isThreeLevelPriority ? 0 : overdue ? 1 : dueSoon ? 2 : 3, priorityReason: isThreeLevelPriority ? "请优先完成三级安全教育" : overdue ? "已逾期" : dueSoon ? "临近截止" : null, blocksOtherTraining: false };
}
```

- [ ] **Step 4: 在本人待办接口统一应用策略**

在 `GET /api/me/assignments?scope=todo` 返回前应用 `decorateTodoPriority` 与稳定排序；不得在小程序仅靠本地类型字符串猜测优先级。

- [ ] **Step 5: 注册并运行检查**

Run: `pnpm check:training-todo-priority && pnpm --filter @safety/api typecheck`
Expected: 输出 `TRAINING_TODO_PRIORITY_OK`，类型检查通过。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/training-todo-priority.ts apps/api/src/routes/day2.ts apps/api/scripts/check-training-todo-priority.mts apps/api/package.json package.json
git commit -m "feat(training): prioritize incomplete three-level assignments"
```

### Task 2: 待办首页与任务详情

**Files:**
- Modify: `apps/miniprogram/app.wxss`
- Modify: `apps/miniprogram/pages/todo/index.js`
- Modify: `apps/miniprogram/pages/todo/index.wxml`
- Modify: `apps/miniprogram/pages/todo/index.wxss`
- Modify: `apps/miniprogram/pages/task/index.js`
- Modify: `apps/miniprogram/pages/task/index.wxml`
- Modify: `apps/miniprogram/pages/task/index.wxss`

**Interfaces:**
- Consumes: `GET /api/me/assignments?scope=todo` 的 `priorityRank`、`priorityReason`、`isThreeLevelPriority` 和现有任务 DTO。
- Produces: 首页的 `primaryTask`、`remainingTasks`；任务详情的 `stageItems` 和唯一 `primaryAction`。

- [ ] **Step 1: 在页面 JS 中建立纯展示映射**

```js
function splitTasks(tasks) {
  return { primaryTask: tasks[0] || null, remainingTasks: tasks.slice(1) }
}

function buildStages(task) {
  return [
    { key: 'learning', label: '学习', state: task.progress.completed === task.progress.total ? 'done' : 'current' },
    { key: 'exam', label: '考试', state: task.examStage },
    { key: 'signature', label: '签字', state: task.signatureStage },
    { key: 'complete', label: '完成', state: task.status === 'completed' ? 'done' : 'waiting' }
  ]
}
```

- [ ] **Step 2: 改造待办 WXML 为任务指挥台**

必须包含三级教育优先横幅、主任务卡、截止/进度/下一步、其余任务列表、空状态和重试；日常挑战入口不在本任务中实现。

- [ ] **Step 3: 改造任务详情为行动优先结构**

顶部只保留一个主操作；课程列表、四阶段进度、补学说明、锁定说明、待项目确认和完成提示均使用服务端状态。

- [ ] **Step 4: 完成响应式与可触达样式**

所有主要触控区域最小高度 `88rpx`；正文最小字号 `28rpx`；颜色之外同时使用文字表达状态。

- [ ] **Step 5: 运行小程序静态检查**

Run: `pnpm check:miniprogram`
Expected: `MINIPROGRAM_PRODUCTION_CHECK=PASS`。

- [ ] **Step 6: 提交**

```bash
git add apps/miniprogram/app.wxss apps/miniprogram/pages/todo apps/miniprogram/pages/task
git commit -m "feat(miniprogram): add action-first training workspace"
```

### Task 3: 课件阅读与续学位置

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_learning_resume_state/migration.sql`
- Modify: `apps/api/src/routes/day2.ts`
- Modify: `apps/miniprogram/pages/courseware/index.js`
- Modify: `apps/miniprogram/pages/courseware/index.wxml`
- Modify: `apps/miniprogram/pages/courseware/index.wxss`

**Interfaces:**
- Consumes: 当前 `LearningProgress` 和课件读取接口。
- Produces: `LearningProgress.resumeState`；`PATCH /api/assignments/:id/coursewares/:versionId/resume` 接收 `{ blockKey, progressPercent }`。

- [ ] **Step 1: 增加恢复状态字段 migration**

```prisma
model LearningProgress {
  // existing fields
  resumeState Json? @map("resume_state")
}
```

只运行 `pnpm db:validate` 和在隔离开发库生成正式 migration；不得执行 `db push` 或 reset。

- [ ] **Step 2: 为恢复状态添加 Zod 校验与本人权限检查**

```ts
const resumeSchema = z.object({
  blockKey: z.string().trim().min(1).max(120),
  progressPercent: z.number().int().min(0).max(100)
});
```

更新必须限定 assignment 属于当前 `principal.personId`，不能同时写 `completedAt`。

- [ ] **Step 3: 小程序实现节流保存和恢复滚动位置**

每跨过一个内容块或进度变化至少 10% 时保存；保存失败显示“学习位置尚未同步”，但不得伪造成功。

- [ ] **Step 4: 重做阅读界面**

显示单元进度、预计剩余内容、易读正文、HTML 打开说明和底部主操作；只有到达末尾后才启用“完成本次学习”。

- [ ] **Step 5: 验证 schema 与构建**

Run: `pnpm db:validate && pnpm prisma:generate && pnpm --filter @safety/api build && pnpm check:miniprogram`
Expected: 全部退出码为 0。

- [ ] **Step 6: 提交**

```bash
git add prisma/schema.prisma prisma/migrations apps/api/src/routes/day2.ts apps/miniprogram/pages/courseware
git commit -m "feat(training): resume courseware learning position"
```

### Task 4: 单题沉浸考试

**Files:**
- Modify: `apps/miniprogram/pages/exam/index.js`
- Modify: `apps/miniprogram/pages/exam/index.wxml`
- Modify: `apps/miniprogram/pages/exam/index.wxss`

**Interfaces:**
- Consumes: 现有开始/恢复 attempt、保存答案和提交接口。
- Produces: `currentIndex`、`answeredCount`、`saveState` 和交卷检查 UI；不改变服务端评分契约。

- [ ] **Step 1: 将试卷映射为单题状态**

```js
function examViewState(questions, answers, currentIndex) {
  return {
    currentQuestion: questions[currentIndex] || null,
    answeredCount: questions.filter((q) => answers[q.id]?.length).length,
    canGoPrevious: currentIndex > 0,
    canGoNext: currentIndex < questions.length - 1
  }
}
```

- [ ] **Step 2: 保留现有自动保存并增加明确反馈**

选择答案后显示“保存中 → 已保存”；网络失败保留本地选择并提供重试。页面返回和小程序退出不得创建新 attempt。

- [ ] **Step 3: 改造 WXML/WXSS**

一屏一题、固定计时与进度、足够大的选项、上一题/下一题；最后一题进入答题检查，二次确认后调用现有幂等提交接口。

- [ ] **Step 4: 检查客户端不含正确答案**

Run: `rg -n "correct|answerKey|passScore" apps/miniprogram/pages/exam apps/miniprogram/utils`
Expected: 不存在从开始考试响应读取正确答案或评分规则的客户端逻辑。

- [ ] **Step 5: 运行检查并提交**

Run: `pnpm check:miniprogram`
Expected: PASS。

```bash
git add apps/miniprogram/pages/exam
git commit -m "feat(miniprogram): add single-question exam flow"
```

### Task 5: 签字与本人培训记录

**Files:**
- Modify: `apps/miniprogram/pages/signature/index.js`
- Modify: `apps/miniprogram/pages/signature/index.wxml`
- Modify: `apps/miniprogram/pages/signature/index.wxss`
- Modify: `apps/miniprogram/pages/records/index.js`
- Modify: `apps/miniprogram/pages/records/index.wxml`
- Modify: `apps/miniprogram/pages/records/index.wxss`
- Modify: `apps/miniprogram/pages/record-detail/index.js`
- Modify: `apps/miniprogram/pages/record-detail/index.wxml`
- Modify: `apps/miniprogram/pages/record-detail/index.wxss`

**Interfaces:**
- Consumes: 现有签字预览/提交与本人记录接口。
- Produces: 提交前预览确认、不可覆盖完成态、按学习/考试/签字/项目确认分组的记录详情。

- [ ] **Step 1: 签字页增加记录摘要与预览态**

Canvas 前显示培训名称、学习完成时间和考试结果；清空只作用于未提交画布；提交前必须预览并二次确认。

- [ ] **Step 2: 处理签字不可变状态**

当接口返回已有正式签字时只展示签字时间和成功状态，不渲染覆盖按钮；409 冲突刷新服务器状态。

- [ ] **Step 3: 改造记录列表与详情**

列表显示名称、类型、完成时间、最终成绩、通过和签字状态；详情按四个事实分区，不显示准入结论。

- [ ] **Step 4: 运行静态检查并提交**

Run: `pnpm check:miniprogram`
Expected: PASS。

```bash
git add apps/miniprogram/pages/signature apps/miniprogram/pages/records apps/miniprogram/pages/record-detail
git commit -m "feat(miniprogram): refine signatures and training records"
```

### Task 6: 核心学习流程专项检查

**Files:**
- Create: `scripts/check-miniprogram-training-flow.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Tasks 1—5 的页面与 API 源码。
- Produces: `pnpm check:miniprogram-training-flow`，成功输出 `MINIPROGRAM_TRAINING_FLOW_OK`。

- [ ] **Step 1: 编写静态契约检查**

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const todo = await readFile('apps/miniprogram/pages/todo/index.wxml', 'utf8')
const exam = await readFile('apps/miniprogram/pages/exam/index.wxml', 'utf8')
assert.match(todo, /请优先完成三级安全教育/)
assert.match(exam, /上一题/)
assert.match(exam, /下一题/)
console.log('MINIPROGRAM_TRAINING_FLOW_OK')
```

- [ ] **Step 2: 注册命令并运行最小验证**

Run: `pnpm check:training-todo-priority && pnpm check:miniprogram-training-flow && pnpm check:miniprogram && pnpm --filter @safety/api build`
Expected: 四项全部通过。

- [ ] **Step 3: 微信开发者工具人工验证**

验证三级教育置顶、不阻断其他任务、课件退出续学、考试退出恢复、补学、锁定、管理员解锁后继续、通过后签字和本人记录；不得写入生产数据。

- [ ] **Step 4: 提交**

```bash
git add scripts/check-miniprogram-training-flow.mjs package.json
git commit -m "chore(training): add miniprogram learning flow check"
```
