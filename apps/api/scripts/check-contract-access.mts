import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decideContractAccess, contractProjectWhere, selectSingleContractGrant } from "../src/contract-access.js";
import { canReadPrivateFile, type PrivateFileFacts } from "../src/private-file-policy.js";
import { contractStageTransitions, quoteContractCsvCell } from "../src/routes/contracts.js";
import { isSafetyEligibleProject, safetyEligibleProjectWhere } from "../src/contract-project-eligibility.js";

const grant = { role: "editor" as const, canCreateProject: true, canEditProject: true, canManageContracts: true, canUploadAttachments: true, canChangeStage: true, canExport: false, canViewAll: false, canManageAccess: false };
const scoped = decideContractAccess({ accountActive: true, personActive: true, grant, organizationIds: ["org-b", "org-a", "org-a"] });
assert.equal(scoped.canEnter, true);
assert.deepEqual(scoped.organizationIds, ["org-a", "org-b"]);
assert.equal(scoped.canManageContracts, true);
assert.deepEqual(contractProjectWhere(scoped), { contractStage: { not: null }, OR: [{ responsibleOrganizationId: { in: ["org-a", "org-b"] } }, { contractSubcontracts: { some: { owningOrganizationId: { in: ["org-a", "org-b"] } } } }] });

const safetyAdminWithoutContractGrant = decideContractAccess({ accountActive: true, personActive: true, grant: null, organizationIds: ["org-a"] });
assert.equal(safetyAdminWithoutContractGrant.canEnter, false);
assert.equal(safetyAdminWithoutContractGrant.canViewAll, false);
assert.equal(selectSingleContractGrant([]), null);
assert.equal(selectSingleContractGrant([grant, grant]), null, "重复有效授权必须 fail closed");

const readonly = decideContractAccess({ accountActive: true, personActive: true, grant: { ...grant, role: "readonly", canExport: true }, organizationIds: ["org-a"] });
assert.equal(readonly.canEnter, true);
assert.equal(readonly.canEditProject, false);
assert.equal(readonly.canManageContracts, false);
assert.equal(readonly.canExport, true);

assert.deepEqual(contractStageTransitions.bid_preparation, ["contract_registration", "terminated"]);
assert.equal(contractStageTransitions.submitted_review.includes("report_drafting"), true);
assert.deepEqual(contractStageTransitions.closed, []);
assert.equal(quoteContractCsvCell("=HYPERLINK(\"https://example.invalid\")"), "\"'=HYPERLINK(\"\"https://example.invalid\"\")\"");
assert.equal(quoteContractCsvCell("normal"), "\"normal\"");
assert.equal(isSafetyEligibleProject({ contractStage: null, contractDataSource: null, contractBidStatus: null, mainContractId: null }), true);
assert.equal(isSafetyEligibleProject({ contractStage: "bid_preparation", contractDataSource: "existing_project", contractBidStatus: "bidding", mainContractId: null }), true, "既有安全项目不得因纳入合同模块被锁定");
assert.equal(isSafetyEligibleProject({ contractStage: "bid_preparation", contractDataSource: "manual", contractBidStatus: "won", mainContractId: null }), false, "未签主合同不能进入安全域");
assert.equal(isSafetyEligibleProject({ contractStage: "contract_registration", contractDataSource: "manual", contractBidStatus: "won", mainContractId: "main-id", mainContract: { signedAt: null } }), false, "仅登记未签署的主合同不能放行");
assert.equal(isSafetyEligibleProject({ contractStage: "contract_registration", contractDataSource: "manual", contractBidStatus: "won", mainContractId: "main-id", mainContract: { signedAt: new Date("2026-09-25") } }), true);
assert.equal(Array.isArray(safetyEligibleProjectWhere.OR) && safetyEligibleProjectWhere.OR.length, 3);

const emptyFacts: PrivateFileFacts = { uploadedBy: "other", linked: true, photos: [], signatures: [], personCertificates: [], organizationQualifications: [], monthlyReports: [], coursewares: [], trainingAttachments: [], requestAttachments: [], receivableAttachments: [], receivableImportBatches: [], contractAttachments: [{ readable: false }] };
assert.equal(canReadPrivateFile({ accountId: "admin", personId: "person", roles: [{ role: "company_admin", scopeType: "company", scopeId: null }] }, emptyFacts), false, "公司管理员不能绕过合同附件权限");
assert.equal(canReadPrivateFile({ accountId: "reader", personId: "person", roles: [] }, { ...emptyFacts, contractAttachments: [{ readable: true }] }), true);
assert.equal(canReadPrivateFile({ accountId: "reader", personId: "person", roles: [], receivablesAccess: { role: "readonly", canReadLedger: false, canViewAll: false, readDepartmentIds: [] } }, { ...emptyFacts, contractAttachments: [{ readable: true }], receivableAttachments: [{ financeDepartmentId: "finance", status: "active" }] }), false, "合同关联不能绕过财务文件保护");

const schema = await readFile(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
assert.match(schema, /mainContractId\s+String\?/);
assert.match(schema, /mainContractId\s+String\?[^\n]*@unique/, "一份主合同必须只能关联一个项目");
assert.match(schema, /project\s+Project\?/);
assert.match(schema, /contractBidStatus\s+ContractBidStatus\?/);
assert.match(schema, /model ContractAccessGrant/);

process.stdout.write("CONTRACT_ACCESS_OK\n");
