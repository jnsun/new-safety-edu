# Contract Schema Diff Scope

核查日期：2026-09-25。隔离分支 `codex/baseline-ui-test`，基线 `0d6a7493`。此表只评价合同 RC 引入的结构差异，不把既有其他业务的 Prisma drift 混入合同迁移。

## 复现方法与结论

在同一临时 PostgreSQL 17 实例中，从 `HEAD` 提取合同开发前的 `prisma/`，将其 43 个 migration 应用于空白 `contract_baseline`；将当前 44 个 migration 应用于另一个空白 `contract_test`。分别执行 `prisma migrate diff --from-url ... --to-schema-datamodel ... --script`。两次退出码均为 0，输出**逐字相同**。当前库 `prisma migrate status` 为 44/44、schema up to date。临时库不含测试站或生产站数据。

| 类别 | Diff / 数据库对象 | 合同相关 | 本轮引入 | 处理 |
| --- | --- | --- | --- | --- |
| A | `contract_main_contracts`、`contract_supplements`、`contract_subcontracts`、`contract_attachments`、`contract_project_status_history`、`contract_access_grants`，相关 enum/FK/index/unique 与 `projects` 合同字段 | YES | 预期新增 | **PASS**：迁移后无未解释 diff |
| B | 项目安全准入、月报准入及组织范围涉及的 `projects` 既有字段/关系 | YES（门禁依赖） | 本轮只新增可空合同字段与关联；既有对象未改结构 | **PASS**：schema/migration 一致，diff 无此类对象 |
| C | `exam_paper_items_question_version_id_idx` 被 diff 建议删除 | NO | NO | `KNOWN_HISTORICAL_DRIFT`，43 migration 基线已存在 |
| C | `auth_security_events.id`、`change_request_attachments.id`、12 个 `receivable_*` 表的 `id`、`sensitive_export_jobs.id` 被 diff 建议删除默认值 | NO | NO | `KNOWN_HISTORICAL_DRIFT`，基线与当前 diff 相同 |
| C | `courseware_version_assets` 两个外键仅建议改名 | NO | NO | `KNOWN_HISTORICAL_DRIFT`，基线与当前 diff 相同 |
| C | `challenge_monthly_organization_snapshots`、`challenge_point_ledgers` 两个索引仅建议改名 | NO | NO | `KNOWN_HISTORICAL_DRIFT`，基线与当前 diff 相同 |

合同 migration 不执行这些旧对象的修复；没有 `DROP TABLE`、旧列删除或既有数据回填。上述历史差异应另立技术债，不阻塞合同域的 Prisma Gate。证明范围限于 schema/migration 对比及隔离库运行，不能据此宣称全库零漂移。
