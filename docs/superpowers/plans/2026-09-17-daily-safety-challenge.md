# 日常安全挑战、积分与排行榜 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加独立于正式培训的每日安全答题、不可篡改积分流水、个人月榜和按 active 人员人均积分计算的部门月榜。

**Architecture:** 复用现有 Question/QuestionVersion，通过启用配置选择挑战题；服务端创建每日固定题目快照并计算首次答题积分。积分写入带业务唯一键的流水，排行榜只从有效流水与月度组织快照聚合。

**Tech Stack:** Fastify、Prisma/PostgreSQL、Zod、React/Ant Design、原生微信小程序、现有 `node:assert/strict` 检查脚本。

**Spec:** `docs/superpowers/specs/2026-09-17-miniprogram-training-courseware-design.md`

## Global Constraints

- 积分只来自日常安全挑战，不来自正式培训、考试、补学、签字或项目确认。
- 每日默认 5 题；每题首次答对 2 分，答错不扣分，每日普通答题最多 10 分。
- 重复练习不重复得分；客户端不能提交积分数值。
- 部门榜按 active 人员人均积分排名并展示参与率；少于 3 人只展示不参与奖励排名。
- 外协单位不进入内部部门榜。
- 当前版本不建设奖励、商城、兑换、库存或发奖功能。

## File Map

- `prisma/schema.prisma`、新 migration：挑战启用配置、每日 attempt、答案、积分流水和月结快照。
- `apps/api/src/daily-challenge-policy.ts`：选题、计分、去重和月度边界纯函数。
- `apps/api/src/challenge-leaderboard.ts`：个人榜、本人邻近排名和部门人均榜。
- `apps/api/src/routes/daily-challenge.ts`：本人挑战、答题、积分和排行榜 API。
- `apps/admin/src/challenge/*`：题目启用、分类、难度和异常积分作废。
- `apps/miniprogram/pages/challenge/*`：每日答题。
- `apps/miniprogram/pages/leaderboard/*`：个人榜和部门榜。
- `apps/miniprogram/pages/todo/*`、`pages/profile/*`：挑战与积分入口。

---

### Task 1: 挑战数据模型与约束

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_daily_safety_challenge/migration.sql`
- Create: `apps/api/scripts/check-daily-challenge-schema.mts`

**Interfaces:**
- Produces: `ChallengeAttempt`、`ChallengeAnswer`、`ChallengePointLedger`、`ChallengeMonthlyOrganizationSnapshot`。

- [ ] **Step 1: 写 schema 约束检查**

检查同一 person/date 只有一个有效 attempt、同一 attempt/question 只有一个首次答案、积分 source key 唯一、作废保留原流水。

- [ ] **Step 2: 扩展 Question 并增加模型**

```prisma
model Question {
  // existing fields
  challengeEnabled    Boolean @default(false) @map("challenge_enabled")
  challengeCategory   String? @map("challenge_category") @db.VarChar(80)
  challengeDifficulty String? @map("challenge_difficulty") @db.VarChar(20)
}

model ChallengePointLedger {
  id                     String   @id @default(uuid()) @db.Uuid
  personId               String   @map("person_id") @db.Uuid
  organizationIdSnapshot String?  @map("organization_id_snapshot") @db.Uuid
  sourceType             String   @map("source_type") @db.VarChar(40)
  sourceKey              String   @unique @map("source_key") @db.VarChar(180)
  points                 Int
  occurredAt             DateTime @default(now()) @map("occurred_at")
  voidedAt               DateTime? @map("voided_at")
  voidedBy               String?  @map("voided_by") @db.Uuid
  voidReason             String?  @map("void_reason") @db.VarChar(500)
}
```

- [ ] **Step 3: 增加必要外键、月份索引和不可重复约束**

积分必须关联现有 Person；组织快照允许组织后续变更，但不能根据客户端输入生成。

- [ ] **Step 4: 验证并提交**

Run: `pnpm db:validate && pnpm prisma:generate && pnpm --filter @safety/api exec tsx scripts/check-daily-challenge-schema.mts`
Expected: PASS。

```bash
git add prisma/schema.prisma prisma/migrations apps/api/scripts/check-daily-challenge-schema.mts
git commit -m "feat(challenge): add daily challenge and point ledger schema"
```

### Task 2: 服务端选题与计分策略

**Files:**
- Create: `apps/api/src/daily-challenge-policy.ts`
- Create: `apps/api/scripts/check-daily-challenge-policy.mts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `selectDailyQuestions(candidates, seed, limit)`、`scoreFirstAnswer(input)`、`challengeMonthRange(date, timeZone)`。

- [ ] **Step 1: 写失败策略检查**

```ts
assert.equal(scoreFirstAnswer({ correct: true, alreadyAnswered: false, dailyAwarded: 8 }), 2);
assert.equal(scoreFirstAnswer({ correct: true, alreadyAnswered: true, dailyAwarded: 4 }), 0);
assert.equal(scoreFirstAnswer({ correct: false, alreadyAnswered: false, dailyAwarded: 4 }), 0);
assert.equal(scoreFirstAnswer({ correct: true, alreadyAnswered: false, dailyAwarded: 10 }), 0);
```

- [ ] **Step 2: 实现确定性选题**

使用服务端 HMAC seed（personId + 自然日）从符合 active、challengeEnabled 和 scope 的 QuestionVersion 中选择最多 5 题；候选不足时返回真实数量，不复制题目凑数。

- [ ] **Step 3: 实现首次答题计分**

计分函数不接受客户端 points；答案提交事务中创建 answer，再以 `challenge-answer:<answerId>` 为 sourceKey 插入流水。

- [ ] **Step 4: 验证并提交**

Run: `pnpm --filter @safety/api exec tsx scripts/check-daily-challenge-policy.mts && pnpm --filter @safety/api typecheck`
Expected: PASS。

```bash
git add apps/api/src/daily-challenge-policy.ts apps/api/scripts/check-daily-challenge-policy.mts apps/api/package.json
git commit -m "feat(challenge): add server-authoritative scoring policy"
```

### Task 3: 本人挑战与积分 API

**Files:**
- Create: `apps/api/src/routes/daily-challenge.ts`
- Modify: `apps/api/src/server.ts`
- Create: `apps/api/scripts/check-daily-challenge-routes.mts`

**Interfaces:**
- Produces: `GET /api/me/daily-challenge`、`POST /api/me/daily-challenge/answers`、`GET /api/me/challenge-points`。

- [ ] **Step 1: 写路由契约检查**

断言响应不包含 `correct`，提交 body 只允许 `{ attemptId, questionVersionId, answer }`，重复提交返回已有结果且不重复积分。

- [ ] **Step 2: 创建或恢复当天 attempt**

题目 snapshot 不含正确答案；同一天再次进入返回同一 attempt、题目顺序和已有答案。

- [ ] **Step 3: 提交答案并事务计分**

服务端从 QuestionVersion 读取正确答案，在一个事务中写答案、积分流水和审计；返回是否正确、解析、本题得分和今日累计。

- [ ] **Step 4: 运行验证并提交**

Run: `pnpm --filter @safety/api exec tsx scripts/check-daily-challenge-routes.mts && pnpm --filter @safety/api build`
Expected: PASS。

```bash
git add apps/api/src/routes/daily-challenge.ts apps/api/src/server.ts apps/api/scripts/check-daily-challenge-routes.mts
git commit -m "feat(challenge): add daily question and answer APIs"
```

### Task 4: 排行榜与月度快照

**Files:**
- Create: `apps/api/src/challenge-leaderboard.ts`
- Modify: `apps/api/src/routes/daily-challenge.ts`
- Create: `apps/api/scripts/check-challenge-leaderboard.mts`

**Interfaces:**
- Produces: `GET /api/challenge/leaderboards?month=YYYY-MM&type=person|organization`。
- Produces: 个人前 20 + 本人邻近排名；部门人均积分 + 参与率 + 小样本标记。

- [ ] **Step 1: 写公平性检查**

构造 30 人 300 分部门与 5 人 100 分部门，断言人均分别为 10 与 20；少于 3 人 `rewardEligible=false`；外协单位被排除。

- [ ] **Step 2: 实现个人榜排序**

先按积分降序，再按达到该积分的最早时间升序；只返回姓名、部门、积分、名次和名次变化。

- [ ] **Step 3: 实现部门榜与月结**

进行中月份使用当前 active 人数；月份结束后写入人数、参与人数、总积分和排名快照，历史查询只读快照。

- [ ] **Step 4: 验证并提交**

Run: `pnpm --filter @safety/api exec tsx scripts/check-challenge-leaderboard.mts && pnpm --filter @safety/api build`
Expected: PASS。

```bash
git add apps/api/src/challenge-leaderboard.ts apps/api/src/routes/daily-challenge.ts apps/api/scripts/check-challenge-leaderboard.mts
git commit -m "feat(challenge): add monthly personal and organization rankings"
```

### Task 5: Admin 挑战题配置与异常积分作废

**Files:**
- Create: `apps/admin/src/challenge/ChallengeQuestionSettings.tsx`
- Create: `apps/admin/src/challenge/PointLedgerPage.tsx`
- Modify: `apps/admin/src/Day2Pages.tsx`
- Modify: `apps/api/src/routes/daily-challenge.ts`
- Create: `apps/api/scripts/check-challenge-admin-policy.mts`

**Interfaces:**
- Produces: 题目启用、分类、难度、适用范围；异常积分只能作废且要求原因。

- [ ] **Step 1: 写管理员权限检查**

公司管理员可配置全公司挑战题和作废异常流水；组织管理员只查看本组织统计，不可直接给分或跨 scope 修改。

- [ ] **Step 2: 增加管理 API**

题目配置必须引用现有 Question；作废使用 `updateMany({ where: { id, voidedAt: null } })` 并写操作者、原因和审计，不删除原流水。

- [ ] **Step 3: 增加 Admin 页面**

在题库模块中增加“日常挑战”配置，不创建第二套题库页面；积分流水页支持月份、部门和人员筛选，只提供“作废异常积分”。

- [ ] **Step 4: 验证并提交**

Run: `pnpm --filter @safety/api exec tsx scripts/check-challenge-admin-policy.mts && pnpm --filter @safety/admin build`
Expected: PASS。

```bash
git add apps/admin/src/challenge apps/admin/src/Day2Pages.tsx apps/api/src/routes/daily-challenge.ts apps/api/scripts/check-challenge-admin-policy.mts
git commit -m "feat(admin): configure challenge questions and point audits"
```

### Task 6: 小程序每日挑战和排行榜

**Files:**
- Create: `apps/miniprogram/pages/challenge/index.js`
- Create: `apps/miniprogram/pages/challenge/index.json`
- Create: `apps/miniprogram/pages/challenge/index.wxml`
- Create: `apps/miniprogram/pages/challenge/index.wxss`
- Create: `apps/miniprogram/pages/leaderboard/index.js`
- Create: `apps/miniprogram/pages/leaderboard/index.json`
- Create: `apps/miniprogram/pages/leaderboard/index.wxml`
- Create: `apps/miniprogram/pages/leaderboard/index.wxss`
- Modify: `apps/miniprogram/app.json`
- Modify: `apps/miniprogram/pages/todo/*`
- Modify: `apps/miniprogram/pages/profile/*`

**Interfaces:**
- Consumes: Tasks 3—4 API。
- Produces: 必做任务之后的挑战入口、单题答题反馈、个人榜/部门榜和本人累计积分。

- [ ] **Step 1: 注册页面与入口**

待办存在时，挑战卡始终位于正式任务之后；没有任务时可提升但不得使用“必须完成”文案。Profile 显示累计积分和排行榜入口。

- [ ] **Step 2: 实现每日单题挑战**

答案提交后才显示正确/错误和解析；重复进入恢复当天进度；完成后显示今日得分且不引导刷分。

- [ ] **Step 3: 实现个人榜与部门榜**

个人榜显示前 20 和本人邻近名次；部门榜显示人均积分、参与人数/总人数、参与率和小样本标记。

- [ ] **Step 4: 验证并提交**

Run: `pnpm check:miniprogram`
Expected: PASS。

```bash
git add apps/miniprogram/app.json apps/miniprogram/pages/challenge apps/miniprogram/pages/leaderboard apps/miniprogram/pages/todo apps/miniprogram/pages/profile
git commit -m "feat(miniprogram): add daily safety challenge and rankings"
```

### Task 7: 日常挑战最小完整验证

**Files:**
- Create: `apps/api/scripts/smoke-daily-challenge.mts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `pnpm smoke:daily-challenge`，使用匿名隔离数据并自动清理。

- [ ] **Step 1: 编写 smoke 场景**

覆盖：每日题目固定、正确首次得分、错误不扣分、重复提交不得分、每日上限、个人榜、部门人均榜、小样本、跨 scope 拒绝、积分作废保留审计。

- [ ] **Step 2: 运行最终验证**

Run: `pnpm db:validate && pnpm prisma:generate && pnpm --filter @safety/api build && pnpm --filter @safety/admin build && pnpm check:miniprogram && pnpm smoke:daily-challenge`
Expected: 全部退出码为 0。

- [ ] **Step 3: 微信开发者工具人工验收**

验证挑战入口低于正式待办、当天恢复、答题解析、个人榜、部门榜、本人累计积分，以及正式培训成绩和记录未受影响。

- [ ] **Step 4: 提交**

```bash
git add apps/api/scripts/smoke-daily-challenge.mts apps/api/package.json package.json
git commit -m "chore(challenge): add daily challenge smoke check"
```
