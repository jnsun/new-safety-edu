# 项目与合同模块 Release Candidate 最终收口核查

日期：2026-09-25。隔离分支：`codex/baseline-ui-test`，基线 `0d6a7493`。**本文是前一轮核查快照，文中的 PARTIAL 与未提交结论不代表最终 Gate 状态。** 本轮继续验收的 Prisma 分类见 [CONTRACT-SCHEMA-DIFF-SCOPE.md](./CONTRACT-SCHEMA-DIFF-SCOPE.md)；最终 Gate 和 commit 结果以本轮交付报告为准。原 `E:\codex\new-safety-edu` 工作区未提交修改不属于隔离核查范围，也没有被覆盖。

## 三项业务边界闭环

| 边界 | 权威来源与服务端约束 | 权限与验证 | 结果 |
| --- | --- | --- | --- |
| 合同搜索组织范围 | `Project.responsibleOrganizationId` 与分包可见关系经 `contractProjectWhere` 限定，列表的名称、编号、主合同编号、甲方和 UUID 搜索与范围条件取交集；详情按同一可见范围判定；导出独立要求 `canExport` 并应用范围。授权清单与变更是全局操作，只有公司管理员或显式 `canViewAll` 的合同授权管理员可操作。 | 隔离 PostgreSQL 的 API 烟测覆盖同组织可见、异组织名称/编号/UUID/主合同编号/甲方不可见、详情 404、导出范围、候选项目 ID 不泄露；局部合同管理员读取 grant 清单为 403，公司管理员为 200。 | API PASS；真实测试站管理员角色尚未操作验收。 |
| 分包实体不能改写主项目 | `Project.responsibleOrganizationId`、负责人和 `mainContractId` 是主项目权威字段；`ContractSubcontract.owningOrganizationId` 只建立分包关系。读可含分包实体，写必须匹配责任实体或明确 `canViewAll`。 | API 烟测验证分包实体读到关联项目但 PATCH 主项目为 403；在隔离库用 Prisma 创建、修改、删除及多个分包关系，逐步断言主项目权威字段不变、主合同关系不变。 | 服务端写隔离和模型不变量 PASS；当前产品没有分包编辑/删除 API 或 UI，因此这两项只完成模型层回归，不能标成操作流程 PASS。 |
| 未签主合同门禁 | 对新纳入合同模块的项目，统一使用 `mainContract.signedAt != null`；旧安全项目按既有行为保留，不回写或删除历史培训/月报事实。 | API 烟测覆盖投标中、仅登记未签、签署后安全和月报项目清单；`day1`、微信和月报入口的调用点已与统一判断所需选择字段对齐。 | 针对性 API PASS；真实学员端跨入口流程未完整操作验收。 |

合同阶段使用现有 `contractStage` 枚举与主合同的 `signedAt` 日期，不另造“合同状态”字段。登记主合同会推进到 `contract_registration`，但不等于已经签署。历史安全/月报数据未迁移或改写。

## 真实操作证据与边界

使用本机隔离 PostgreSQL `127.0.0.1:55433/contract_test` 和合成账号，通过实际管理端浏览器完成：正常菜单进入合同台账、必填提示、新建项目、编辑位置、登记未签主合同、补签、按主合同编号查询、无结果空状态、详情重载。操作经过 Web → API → Prisma → 隔离库；刷新后项目位置、责任实体、合同编号、签署日期及金额与库记录一致。合成项目编号 `UI-2026-001`。未向测试站写入业务数据。

尚未完成浏览器逐项验收：实际分页跳转、多角色只读/无权限页面、网络错误及重试、分包界面全链路、全部状态和日期/金额边界。因此 **Contract UI operations = PARTIAL**，不能凭构建和一次创建流程宣称 PASS。隔离库烟测涵盖服务端分页和无权写入，但不等于浏览器点击验收。

## Prisma / migration 核查

- 本机空白 PostgreSQL 17 隔离库顺序应用全部 **44/44** migration 成功。`202609240001_contract_management` 新增四枚举、六张合同表及项目可空字段、索引、外键；无旧数据删除、旧字段丢弃或旧数据回填。
- 全量 migration 后与当前 Prisma schema 的 diff **不为空**：既有非合同域存在考试题关联索引差异、多个 UUID 默认值差异、课件资产外键名称及挑战索引名称差异。合同表、字段、约束未发现缺项。分类：历史 schema drift 与命名表达差异；未见本次合同迁移要求的危险 DROP TABLE / DROP COLUMN。**Prisma diff = PARTIAL**，不得称全库无漂移，也不得把这些旧差异混入合同迁移。
- 测试站只读预检：已完成 migration 43 个，待执行仅 `202609240001_contract_management`；已有项目 2 个；合同六表、四枚举、项目新增列和目标索引/约束均不存在。新增项目列可空，新表为空，因此旧数据无新增 NOT NULL、唯一键或外键冲突路径。结构与数据兼容性结论：**SAFE（理论可迁移，未执行）**。没有输出人员或合同业务内容。

## 目标运行镜像

在测试服务器上使用隔离工作树最新源码临时归档构建 `api` 与 `web` **检查镜像**（最终标签 `contract-rc-check-v3`），未替换正在运行的服务、未运行 migration。最终 API Docker build 与 Web Docker build 成功；首次构建曾暴露 `day1` 两个调用点未选 `mainContract.signedAt`，已修复后重建通过。镜像内 Node `22.23.3`、Prisma Client/CLI `6.19.3`、Linux x64、`debian-openssl-3.0.x` 引擎均可解析，迁移 CLI 可执行。未将该检查镜像接入隔离数据库做启动/读写操作，所以 **Runtime image = PARTIAL**（构建与引擎 PASS，启动链未验）。现有运行容器中的 Corepack 缓存权限报错不影响新镜像构建，但部署脚本若在非构建阶段调用 `pnpm` 仍需核对。远端实际运行容器仍是 `test-0d6a749`；本机临时 API、Vite 与 PostgreSQL 已停止，隔离数据保留以便复验。

## Release Candidate 矩阵

| 项目 | 结果 | 证据 / 未完成点 |
| --- | --- | --- |
| Schema | PASS | Prisma validate/generate；合同结构在隔离库落地。 |
| Migration 44/44 | PASS | 本机空白 PostgreSQL 顺序执行。 |
| Prisma diff | PARTIAL | 合同对象一致；全库历史差异仍存在。 |
| API build | PASS | 本机与目标 Docker 构建通过。 |
| Admin build | PASS | 本机与目标 Docker 构建通过。 |
| Contract API smoke | PASS | 隔离库端到端烟测通过，包含权限及状态门禁。 |
| Contract UI operations | PARTIAL | 创建/编辑/登记/补签/刷新已实操；分页、错误、多角色与分包 UI 未逐项验。 |
| Organization scope | PARTIAL | 隔离库 API 搜索/详情/候选/导出/授权清单通过；测试站真实角色未验。 |
| Subcontract isolation | PARTIAL | API 写隔离与模型增改删通过；无分包编辑/删除产品操作可验。 |
| Unsigned-contract gating | PARTIAL | 安全/月报针对性 API 通过；所有实际学习/报送入口未完整验。 |
| Test DB preflight | PASS | 只读，结论 SAFE；尚未执行迁移。 |
| Runtime image | PARTIAL | 目标主机构建、Node/Prisma 引擎通过；未运行新镜像 API。 |

**提交门槛未满足，故没有 staged diff 或合同正式 commit。** 后续先补浏览器真实角色/错误/分页与跨入口验收，完成新镜像隔离启动及历史 Prisma drift 处置决定；再重新核对 `RELEASE-SCOPE-AUDIT.md` 与精确 staged diff。不得使用 `git add .`，也不得把五页 UI 或其他系统改动并入合同 commit。
