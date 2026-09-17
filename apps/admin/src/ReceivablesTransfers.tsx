import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Form,
  Input,
  message,
  Modal,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { UploadFile } from "antd";
import { api, apiResponse, json } from "./api";
import {
  canApplyReceivablesImport,
  groupReceivablesImportIssues,
  preserveReceivablesConflictDraft,
  receivablesDownloadFilename,
  receivablesErrorKind,
  receivablesExportCategoryIds,
  receivablesExportDownloadRequest,
  receivablesImportNeedsOpeningBalanceDate,
  receivablesImportStage,
  receivablesQueryKey,
  receivablesScopeQueryPrefix,
  receivablesScopedQueryKey,
  updateReceivablesImportDecision,
  usableReceivablesData,
  type ReceivablesAccess,
  type ReceivablesExportCategoryFilters,
  type ReceivablesExportList,
  type ReceivablesExportPreview,
  type ReceivablesFilters,
  type ReceivablesImportBatch,
  type ReceivablesImportField,
  type ReceivablesImportInspection,
  type ReceivablesImportPreview,
  type ReceivablesReferenceCategory,
  type ReceivablesReferenceData,
} from "./receivables-types";

const stageIndex = {
  upload: 0,
  blocking_errors: 1,
  duplicate_decisions: 2,
  impact_preview: 3,
  confirm_apply: 4,
} as const;
const stageItems = [
  "上传与映射",
  "阻断错误",
  "重复决策",
  "影响预览",
  "确认应用",
].map((title) => ({ title }));
const batchLabels = {
  previewed: "待应用",
  applied: "已应用",
  failed: "失败",
  rolled_back: "已回滚",
} as const;
const exportLabels = {
  pending: "排队中",
  processing: "生成中",
  completed: "可下载",
  failed: "失败",
  expired: "已过期",
} as const;
const exportCategoryLabels = {
  financeDepartment: "财务归属部门",
  creditorUnit: "单位",
  customerType: "客户属性",
  workNature: "工作性质",
  sector: "板块",
  projectStatus: "项目状态",
  settlementMethod: "决算方式",
  debtStatus: "债权状态",
  communicationMethod: "沟通方式",
  counterpartyFeedback: "对方反馈",
  latestProgress: "最新进展",
  nextPlan: "下一步计划",
  status: "记录状态",
} as const;
const importFieldLabels: Record<ReceivablesImportField, string> = {
  financeDepartmentId: "财务归属部门",
  contractNo: "合同编号",
  projectName: "项目名称",
  customerName: "客户名称",
  customerType: "客户属性",
  creditorUnit: "单位",
  workNature: "工作性质",
  sector: "八大板块",
  projectStatus: "项目状态",
  settlementMethod: "决算方式",
  contractAmount: "合同金额（万元）",
  finalAmount: "决算金额（万元）",
  openingChargeDate: "最新挂账时间",
  debtStatus: "债权状态",
  collectionOwner: "清收责任人",
  collectionNotes: "催收备注",
  dunningDate: "最新催收时间",
  communicationMethod: "沟通方式",
  counterpartyFeedback: "对方反馈",
  latestProgress: "最新进展",
  nextPlan: "下一步计划",
  openingInvoiceAmount: "期初开票金额（万元）",
  openingInvoiceDate: "期初开票日期",
  openingReceiptAmount: "期初到账金额（万元）",
  openingReceiptDate: "期初到账日期",
};
const importIssueRecovery: Record<string, string> = {
  DEPARTMENT_NOT_FOUND:
    "请先在“财务归属部门”中建立与 Excel 一致的部门名称或代码。",
  DEPARTMENT_AMBIGUOUS: "请调整重复的部门名称或代码后重新上传。",
  DICTIONARY_VALUE_INVALID: "请先在“业务字典”对应分类中新增或启用该选项。",
  OPENING_BALANCE_DATE_REQUIRED: "请在最终应用前填写期初余额日期。",
  FORMULA_RESULT_MISSING: "请用 Excel 打开文件，重新计算并保存后再上传。",
};

export function ReceivablesTransfers({
  accountId,
  scopeFingerprint,
  access,
  section,
}: {
  accountId: string;
  scopeFingerprint: string;
  access: ReceivablesAccess;
  section: "create" | "imports" | "exports";
}) {
  if (section === "create")
    return (
      <ReceivablesCreate
        accountId={accountId}
        scopeFingerprint={scopeFingerprint}
        access={access}
      />
    );
  return section === "imports" ? (
    <ReceivablesImports
      accountId={accountId}
      scopeFingerprint={scopeFingerprint}
      access={access}
    />
  ) : (
    <ReceivablesExports
      accountId={accountId}
      scopeFingerprint={scopeFingerprint}
      access={access}
    />
  );
}

function ReceivablesCreate({
  accountId,
  scopeFingerprint,
  access,
}: {
  accountId: string;
  scopeFingerprint: string;
  access: ReceivablesAccess;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const reference = useQuery({
    queryKey: receivablesScopedQueryKey(
      accountId,
      scopeFingerprint,
      "reference-data",
    ),
    queryFn: () =>
      api<ReceivablesReferenceData>("/api/receivables/reference-data"),
    retry: false,
  });
  const data = usableReceivablesData(reference);
  const options = (category: ReceivablesReferenceCategory) =>
    (data?.dictionaries[category] ?? []).map((item) => ({
      value: item.value,
      label: item.value,
    }));
  const create = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      api<{ id: string }>(
        "/api/receivables/ledgers",
        json(
          "POST",
          Object.fromEntries(
            Object.entries(values).map(([key, value]) => [
              key,
              ["financeDepartmentId", "contractNo"].includes(key)
                ? value
                : typeof value === "string"
                  ? value.trim() || null
                  : (value ?? null),
            ]),
          ),
        ),
      ),
    onSuccess: async (ledger) => {
      message.success("台账已新增");
      form.resetFields();
      await qc.invalidateQueries({
        queryKey: receivablesScopeQueryPrefix(accountId, scopeFingerprint),
      });
      navigate(`/receivables/ledger?ledgerId=${encodeURIComponent(ledger.id)}`);
    },
    onError: (error: Error) => message.error(error.message),
  });
  if (!access.canCreateLedger)
    return <Alert type="error" showIcon message="当前账号没有新增台账权限" />;
  return (
    <div className="receivables-page">
      <div className="receivables-work-intro">
        金额事实与催收信息分区录入，保存后直接进入正式台账并保留历史。
      </div>
      <Card className="receivables-entry-card receivables-work-card" title="新建台账">
        <Form
          className="receivables-entry-form"
          form={form}
          layout="vertical"
          onFinish={(values) => create.mutate(values)}
        >
          <section className="receivables-entry-section">
            <Typography.Title level={5}>基础信息</Typography.Title>
          <Form.Item
            name="financeDepartmentId"
            label="财务归属部门"
            rules={[{ required: true }]}
          >
            <Select
              options={(data?.departments ?? [])
                .filter((item) => item.canWrite)
                .map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Form.Item
            name="contractNo"
            label="合同编号"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="projectName" label="项目名称">
            <Input />
          </Form.Item>
          <Form.Item name="customerName" label="客户名称">
            <Input />
          </Form.Item>
          <Form.Item name="customerType" label="客户属性">
            <Select allowClear options={options("client_attr")} />
          </Form.Item>
          <Form.Item name="creditorUnit" label="单位">
            <Select allowClear options={options("unit")} />
          </Form.Item>
          <Form.Item name="workNature" label="工作性质">
            <Select allowClear options={options("work_nature")} />
          </Form.Item>
          <Form.Item name="sector" label="八大板块">
            <Select allowClear options={options("sector")} />
          </Form.Item>
          <Form.Item name="projectStatus" label="项目状态">
            <Select allowClear options={options("project_status")} />
          </Form.Item>
          <Form.Item name="settlementMethod" label="决算方式">
            <Select allowClear options={options("final_method")} />
          </Form.Item>
          </section>
          {access.canManageAll && (
            <section className="receivables-entry-section receivables-entry-section-money">
              <Typography.Title level={5}>金额信息</Typography.Title>
              <Form.Item name="contractAmount" label="合同金额（万元）">
                <Input inputMode="decimal" />
              </Form.Item>
              <Form.Item name="finalAmount" label="决算金额（万元）">
                <Input inputMode="decimal" />
              </Form.Item>
              <Form.Item name="openingChargeDate" label="期初挂账日期">
                <Input type="date" />
              </Form.Item>
            </section>
          )}
          <section className="receivables-entry-section">
            <Typography.Title level={5}>催收信息</Typography.Title>
          <Form.Item name="debtStatus" label="债权状态">
            <Select allowClear options={options("debt_status")} />
          </Form.Item>
          <Form.Item name="collectionOwner" label="清收责任人">
            <Input />
          </Form.Item>
          <Form.Item name="collectionNotes" label="催收备注">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="dunningDate" label="最新催收时间">
            <Input type="date" />
          </Form.Item>
          <Form.Item name="communicationMethod" label="沟通方式">
            <Select allowClear options={options("comm_method")} />
          </Form.Item>
          <Form.Item name="counterpartyFeedback" label="对方反馈">
            <Select allowClear options={options("feedback")} />
          </Form.Item>
          <Form.Item name="latestProgress" label="最新进展">
            <Select allowClear options={options("progress_note")} />
          </Form.Item>
          <Form.Item name="nextPlan" label="下一步计划">
            <Select allowClear options={options("next_plan")} />
          </Form.Item>
          </section>
          <Space className="receivables-form-actions">
            <Button htmlType="button" onClick={() => form.resetFields()}>
              清空
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={create.isPending}
              disabled={!data}
            >
              新增记录
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}

function ReceivablesImports({
  accountId,
  scopeFingerprint,
  access,
}: {
  accountId: string;
  scopeFingerprint: string;
  access: ReceivablesAccess;
}) {
  const qc = useQueryClient();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [openingBalanceDate, setOpeningBalanceDate] = useState("");
  const [inspection, setInspection] = useState<ReceivablesImportInspection>();
  const [columnMappings, setColumnMappings] = useState<
    Partial<Record<string, ReceivablesImportField>>
  >({});
  const [preview, setPreview] = useState<ReceivablesImportPreview>();
  const [decisions, setDecisions] = useState<Record<number, "skip" | "update">>(
    {},
  );
  const [confirmStage, setConfirmStage] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [rollback, setRollback] = useState<ReceivablesImportBatch>();
  const [applyConflict, setApplyConflict] =
    useState<
      ReturnType<
        typeof preserveReceivablesConflictDraft<
          { decisions: Record<number, "skip" | "update">; revision: number },
          ReceivablesImportBatch
        >
      >
    >();
  const [applyReconfirm, setApplyReconfirm] = useState(false);
  const [rollbackConflict, setRollbackConflict] =
    useState<
      ReturnType<
        typeof preserveReceivablesConflictDraft<
          { reason: string; revision: number },
          ReceivablesImportBatch
        >
      >
    >();
  const [rollbackForm] = Form.useForm();
  const historyKey = receivablesScopedQueryKey(
    accountId,
    scopeFingerprint,
    "imports",
  );
  const history = useQuery({
    queryKey: historyKey,
    queryFn: () => api<ReceivablesImportBatch[]>("/api/receivables/imports"),
    enabled: access.canImport,
    retry: false,
  });
  const currentHistory = usableReceivablesData(history);
  const resetPreview = () => {
    setPreview(undefined);
    setDecisions({});
    setConfirmStage(false);
    setConfirmed(false);
    setApplyConflict(undefined);
    setApplyReconfirm(false);
    setFileList([]);
    setOpeningBalanceDate("");
    setInspection(undefined);
    setColumnMappings({});
  };
  const closeRollback = () => {
    setRollback(undefined);
    setRollbackConflict(undefined);
    rollbackForm.resetFields();
  };
  const revoked = (error: Error) => {
    message.error(error.message);
    if (receivablesErrorKind(error) === "revoked") {
      resetPreview();
      setRollback(undefined);
      setRollbackConflict(undefined);
      qc.removeQueries({
        queryKey: receivablesScopeQueryPrefix(accountId, scopeFingerprint),
      });
      void qc.invalidateQueries({
        queryKey: receivablesQueryKey(accountId, "access"),
      });
    }
  };
  useEffect(() => {
    if (history.error && receivablesErrorKind(history.error) === "revoked")
      revoked(history.error);
  }, [history.error]);
  const inspect = useMutation({
    mutationFn: async (file: File) => {
      const data = new FormData();
      data.append("file", file);
      return api<ReceivablesImportInspection>(
        "/api/receivables/imports/inspect",
        { method: "POST", body: data },
      );
    },
    onSuccess: (result) => {
      setInspection(result);
      setColumnMappings({});
    },
    onError: revoked,
  });
  const upload = useMutation({
    mutationFn: async () => {
      const file = fileList[0]?.originFileObj;
      if (!file) throw new Error("请选择 XLSX 文件");
      if (!inspection) throw new Error("请先等待字段识别完成");
      const data = new FormData();
      if (openingBalanceDate)
        data.append("openingBalanceDate", openingBalanceDate);
      data.append("columnMappings", JSON.stringify(columnMappings));
      data.append("file", file);
      return api<ReceivablesImportPreview>("/api/receivables/imports/preview", {
        method: "POST",
        body: data,
      });
    },
    onSuccess: (result) => {
      setPreview(result);
      setDecisions({});
      setConfirmStage(false);
      setConfirmed(false);
      message.success("文件校验完成");
      void history.refetch();
    },
    onError: revoked,
  });
  const duplicates =
    preview?.rows.filter((row) => !!row.ledgerId && !row.errors?.length) ?? [];
  const stage = preview
    ? receivablesImportStage(preview, decisions, confirmStage)
    : "upload";
  const effect = useMemo(
    () =>
      preview
        ? {
            create: preview.rows.filter(
              (row) => !row.ledgerId && !row.errors?.length,
            ).length,
            update: duplicates.filter(
              (row) => decisions[row.rowNumber] === "update",
            ).length,
            skip: duplicates.filter(
              (row) => decisions[row.rowNumber] === "skip",
            ).length,
          }
        : { create: 0, update: 0, skip: 0 },
    [decisions, duplicates, preview],
  );
  const errorGroups = useMemo(
    () => groupReceivablesImportIssues(preview?.errors ?? []),
    [preview?.errors],
  );
  const warningGroups = useMemo(
    () => groupReceivablesImportIssues(preview?.warnings ?? []),
    [preview?.warnings],
  );
  const needsOpeningBalanceDate =
    !!preview && receivablesImportNeedsOpeningBalanceDate(preview);
  const apply = useMutation({
    mutationFn: () =>
      api(
        `/api/receivables/imports/${preview!.batchId}/apply`,
        json("POST", {
          revision: preview!.revision,
          openingBalanceDate: openingBalanceDate || undefined,
          decisions: Object.entries(decisions).map(([rowNumber, decision]) => ({
            rowNumber: Number(rowNumber),
            decision,
          })),
        }),
      ),
    onSuccess: async () => {
      message.success("导入已应用");
      resetPreview();
      await qc.invalidateQueries({
        queryKey: receivablesScopeQueryPrefix(accountId, scopeFingerprint),
      });
    },
    onError: async (error: Error) => {
      if (
        ["revision_conflict", "stale"].includes(receivablesErrorKind(error)) &&
        preview
      ) {
        const draft = {
          decisions: { ...decisions },
          revision: preview.revision,
        };
        const refreshed = await history.refetch();
        const latest = refreshed.data?.find(
          (batch) => batch.id === preview.batchId,
        );
        if (latest) {
          setApplyConflict(preserveReceivablesConflictDraft(draft, latest));
          setPreview((current) =>
            current ? { ...current, revision: latest.revision } : current,
          );
          setApplyReconfirm(false);
          setConfirmed(false);
          setConfirmStage(false);
        }
      }
      revoked(error);
    },
  });
  const rollbackMutation = useMutation({
    mutationFn: (values: {
      reason: string;
      confirm: boolean;
      reconfirm?: boolean;
    }) =>
      api(
        `/api/receivables/imports/${rollback!.id}/rollback`,
        json("POST", { revision: rollback!.revision, reason: values.reason }),
      ),
    onSuccess: async () => {
      message.success("批次已回滚");
      closeRollback();
      await qc.invalidateQueries({
        queryKey: receivablesScopeQueryPrefix(accountId, scopeFingerprint),
      });
    },
    onError: async (error: Error) => {
      if (
        ["revision_conflict", "stale"].includes(receivablesErrorKind(error)) &&
        rollback
      ) {
        const reason = String(rollbackForm.getFieldValue("reason") ?? "");
        const refreshed = await history.refetch();
        const latest = refreshed.data?.find(
          (batch) => batch.id === rollback.id,
        );
        if (latest) {
          setRollback(latest);
          setRollbackConflict(
            preserveReceivablesConflictDraft(
              { reason, revision: rollback.revision },
              latest,
            ),
          );
          rollbackForm.setFieldsValue({
            reason,
            confirm: false,
            reconfirm: false,
          });
        }
      }
      revoked(error);
    },
  });
  if (!access.canImport)
    return <Alert type="error" showIcon message="当前账号没有导入权限" />;
  return (
    <div className="receivables-page receivables-transfer-workspace">
      <div className="page-title receivables-page-title">
        <div>
          <Typography.Title level={3}>导入批次</Typography.Title>
          <Typography.Text type="secondary">
            上传、校验、逐条处理重复项，确认影响后再应用。
          </Typography.Text>
        </div>
      </div>
      <Card className="receivables-transfer-card" title="新建导入">
        <Steps current={stageIndex[stage]} items={stageItems} responsive={false} />
        <div className="receivables-transfer-stage">
          {!preview && (
            <div className="receivables-import-upload">
              <div className="receivables-import-start">
                <Space className="receivables-transfer-actions" wrap>
                  <Upload
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  maxCount={1}
                  fileList={fileList}
                  beforeUpload={(file) => {
                    setFileList([
                      {
                        uid: file.uid,
                        name: file.name,
                        status: "done",
                        originFileObj: file,
                      },
                    ]);
                    setInspection(undefined);
                    setColumnMappings({});
                    inspect.mutate(file);
                    return false;
                  }}
                  onRemove={() => {
                    setFileList([]);
                    setInspection(undefined);
                    setColumnMappings({});
                    return true;
                  }}
                >
                  <Button loading={inspect.isPending}>选择并识别 XLSX</Button>
                  </Upload>
                  <Button
                  type="primary"
                  disabled={
                    !fileList.length || !inspection || inspect.isPending
                  }
                  loading={upload.isPending}
                  onClick={() => upload.mutate()}
                  >
                    校验并生成预览
                  </Button>
                </Space>
                <Typography.Text type="secondary" className="receivables-import-status">
                  {inspect.isPending
                    ? "正在识别字段…"
                    : inspection
                      ? inspection.unknownColumns.length
                        ? `已识别，${inspection.unknownColumns.length} 列需要映射`
                        : "字段已全部识别"
                      : fileList[0]?.name || "请选择 Excel 文件"}
                </Typography.Text>
              </div>
              {inspection && (
                <div className="receivables-column-mapping">
                  <div className="receivables-mapping-heading">
                    <Typography.Text strong>字段识别</Typography.Text>
                    <Typography.Text type="secondary">
                      {inspection.unknownColumns.length
                        ? `有 ${inspection.unknownColumns.length} 列未自动识别，请选择目标字段或保留“忽略”。`
                        : "全部字段已自动识别，可以继续校验。"}
                    </Typography.Text>
                  </div>
                  {inspection.unknownColumns.length > 0 && (
                    <Table
                      size="small"
                      pagination={false}
                      rowKey="name"
                      dataSource={inspection.unknownColumns}
                      columns={[
                        { title: "Excel 列名", dataIndex: "name", width: 180 },
                        {
                          title: "示例内容",
                          dataIndex: "samples",
                          render: (values: string[]) =>
                            values.join("、") || "—",
                        },
                        {
                          title: "导入到",
                          width: 240,
                          render: (
                            _: unknown,
                            row: ReceivablesImportInspection["unknownColumns"][number],
                          ) => (
                            <Select
                              allowClear
                              placeholder="忽略"
                              value={columnMappings[row.name]}
                              onChange={(
                                field: ReceivablesImportField | undefined,
                              ) =>
                                setColumnMappings((current) => ({
                                  ...current,
                                  [row.name]: field,
                                }))
                              }
                              options={(
                                Object.entries(importFieldLabels) as Array<
                                  [ReceivablesImportField, string]
                                >
                              ).map(([value, label]) => ({
                                value,
                                label,
                                disabled:
                                  inspection.recognizedFields.includes(value) ||
                                  Object.entries(columnMappings).some(
                                    ([source, selected]) =>
                                      source !== row.name && selected === value,
                                  ),
                              }))}
                            />
                          ),
                        },
                      ]}
                    />
                  )}
                </div>
              )}
            </div>
          )}
          {preview && (
            <>
              {preview.errors.length > 0 && (
                <Alert
                  type="error"
                  showIcon
                  message={`发现 ${preview.errors.length} 个阻断错误，共 ${errorGroups.length} 类问题`}
                  description={
                    <ul className="receivables-import-issues">
                      {errorGroups.map((issue) => (
                        <li key={`${issue.code}-${issue.message}`}>
                          <strong>{issue.message}</strong>
                          {issue.count > 1 && <Tag>{issue.count} 条</Tag>}
                          <span>
                            {issue.rows.length > 0
                              ? `涉及第 ${issue.rows.slice(0, 12).join("、")}${issue.rows.length > 12 ? "…" : ""} 行`
                              : issue.columns.length > 0
                                ? `列：${issue.columns.join("、")}`
                                : ""}
                          </span>
                          {importIssueRecovery[issue.code] && (
                            <small>{importIssueRecovery[issue.code]}</small>
                          )}
                        </li>
                      ))}
                    </ul>
                  }
                />
              )}
              {preview.warnings.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  message={`另有 ${preview.warnings.length} 条提示，共 ${warningGroups.length} 类`}
                  description={
                    <ul className="receivables-import-issues">
                      {warningGroups.map((issue) => (
                        <li key={`${issue.code}-${issue.message}`}>
                          <strong>{issue.message}</strong>
                          {issue.count > 1 && <Tag>{issue.count} 条</Tag>}
                          <span>
                            {issue.columns.length > 0
                              ? `列：${issue.columns.join("、")}`
                              : issue.rows.length > 0
                                ? `涉及第 ${issue.rows.slice(0, 12).join("、")}${issue.rows.length > 12 ? "…" : ""} 行`
                                : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  }
                />
              )}
              {!preview.errors.length && needsOpeningBalanceDate && (
                <Form layout="inline">
                  <Form.Item
                    required
                    label="期初余额日期"
                    extra="整批期初金额共用；可稍后填写，但最终应用前必须补充。"
                  >
                    <Input
                      type="date"
                      value={openingBalanceDate}
                      onChange={(event) => {
                        setOpeningBalanceDate(event.target.value);
                        setConfirmed(false);
                        setApplyReconfirm(false);
                      }}
                    />
                  </Form.Item>
                </Form>
              )}
              {!preview.errors.length && duplicates.length > 0 && (
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  scroll={{ x: "max-content" }}
                  dataSource={duplicates}
                  columns={[
                    { title: "行号", dataIndex: "rowNumber" },
                    {
                      title: "合同编号",
                      dataIndex: ["normalizedData", "contractNo"],
                    },
                    {
                      title: "处理决定",
                      render: (_: unknown, row) => (
                        <Space direction="vertical" size={2}>
                          <Select<"skip" | "update">
                            aria-label={`第 ${row.rowNumber} 行处理决定`}
                            value={decisions[row.rowNumber] ?? null}
                            style={{ width: 160 }}
                            options={[
                              { value: "skip", label: "跳过" },
                              { value: "update", label: "更新现有台账" },
                            ]}
                            onChange={(decision) => {
                              const next = updateReceivablesImportDecision(
                                { decisions, confirmStage, confirmed },
                                row.rowNumber,
                                decision,
                              );
                              setDecisions(next.decisions);
                              setConfirmStage(next.confirmStage);
                              setConfirmed(next.confirmed);
                              setApplyReconfirm(false);
                            }}
                          />
                          <Typography.Text type="secondary">
                            只补充当前为空的字段
                          </Typography.Text>
                        </Space>
                      ),
                    },
                  ]}
                />
              )}
              {!preview.errors.length && stage === "impact_preview" && (
                <>
                  <Descriptions
                    bordered
                    size="small"
                    items={[
                      { key: "create", label: "新建", children: effect.create },
                      { key: "update", label: "更新", children: effect.update },
                      { key: "skip", label: "跳过", children: effect.skip },
                    ]}
                  />
                  <div className="receivables-transfer-actions">
                    <Button
                      type="primary"
                      onClick={() => setConfirmStage(true)}
                    >
                      进入最终确认
                    </Button>
                  </div>
                </>
              )}
              {applyConflict && (
                <Alert
                  type="warning"
                  showIcon
                  message="导入预览状态已变化"
                  description={`本地决定与草稿已保留；服务端最新状态 ${batchLabels[applyConflict.latest.status]}，修订 ${applyConflict.latest.revision}。${applyConflict.latest.status === "previewed" && applyConflict.latest.revision !== applyConflict.draft.revision ? "请重新进入影响预览并显式确认。" : "当前批次不可安全重试，请重新上传生成新预览。"}`}
                />
              )}
              {!preview.errors.length && stage === "confirm_apply" && (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Alert
                    type="warning"
                    showIcon
                    message={`将新建 ${effect.create} 条、更新 ${effect.update} 条、跳过 ${effect.skip} 条`}
                  />
                  {applyConflict && (
                    <Checkbox
                      checked={applyReconfirm}
                      onChange={(event) =>
                        setApplyReconfirm(event.target.checked)
                      }
                    >
                      我已核对服务端最新修订并再次确认
                    </Checkbox>
                  )}
                  <Checkbox
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  >
                    我已核对影响和重复项决定
                  </Checkbox>
                  <Space className="receivables-transfer-actions">
                    <Button
                      onClick={() => {
                        setConfirmStage(false);
                        setConfirmed(false);
                      }}
                    >
                      返回影响预览
                    </Button>
                    <Button
                      type="primary"
                      danger
                      disabled={
                        !confirmed ||
                        (needsOpeningBalanceDate && !openingBalanceDate) ||
                        (!!applyConflict &&
                          (!applyReconfirm ||
                            applyConflict.latest.status !== "previewed" ||
                            applyConflict.latest.revision ===
                              applyConflict.draft.revision)) ||
                        !canApplyReceivablesImport(
                          preview,
                          decisions,
                          confirmStage,
                        )
                      }
                      loading={apply.isPending}
                      onClick={() => apply.mutate()}
                    >
                      确认应用
                    </Button>
                  </Space>
                </Space>
              )}
              <Button className="receivables-reset" onClick={resetPreview}>
                放弃本次预览
              </Button>
            </>
          )}
        </div>
      </Card>
      <Card className="section-card" title="历史批次">
        {history.isError && (
          <Alert
            type="error"
            showIcon
            message="历史批次加载失败，已隐藏缓存内容"
          />
        )}
        {currentHistory && (
          <Table
            size="small"
            rowKey="id"
            dataSource={currentHistory}
            scroll={{ x: "max-content" }}
            columns={[
              { title: "文件", dataIndex: ["originalFile", "originalName"] },
              {
                title: "状态",
                dataIndex: "status",
                render: (value: keyof typeof batchLabels) => (
                  <Tag>{batchLabels[value]}</Tag>
                ),
              },
              { title: "行数", dataIndex: "rowCount" },
              { title: "错误", dataIndex: "errorCount" },
              {
                title: "创建时间",
                dataIndex: "createdAt",
                render: (value: string) => new Date(value).toLocaleString(),
              },
              {
                title: "操作",
                render: (_: unknown, row) => (
                  <Button
                    size="small"
                    danger
                    disabled={row.status !== "applied"}
                    onClick={() => {
                      setRollback(row);
                      setRollbackConflict(undefined);
                      rollbackForm.resetFields();
                    }}
                  >
                    回滚
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>
      <Modal
        title="回滚导入批次"
        open={!!rollback}
        footer={null}
        destroyOnClose
        onCancel={closeRollback}
      >
        <Alert
          type="warning"
          showIcon
          message="回滚会按批次修订恢复或删除受影响台账，冲突时服务端将拒绝。"
        />
        {rollbackConflict && (
          <Alert
            type="warning"
            showIcon
            message="批次已变化，旧修订已作废"
            description={`原因草稿已保留；最新状态 ${batchLabels[rollbackConflict.latest.status]}，修订 ${rollbackConflict.latest.revision}。`}
          />
        )}
        <Form
          form={rollbackForm}
          layout="vertical"
          onFinish={(values) => rollbackMutation.mutate(values)}
        >
          <Form.Item
            name="reason"
            label="回滚原因"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea />
          </Form.Item>
          <Form.Item
            name={rollbackConflict ? "reconfirm" : "confirm"}
            valuePropName="checked"
            rules={[
              {
                validator: (_, value) =>
                  value
                    ? Promise.resolve()
                    : Promise.reject(new Error("请确认回滚")),
              },
            ]}
          >
            <Checkbox>我已核对最新批次并确认回滚</Checkbox>
          </Form.Item>
          <Space className="receivables-form-actions">
            <Button htmlType="button" onClick={closeRollback}>
              取消
            </Button>
            <Button
              type="primary"
              danger
              htmlType="submit"
              loading={rollbackMutation.isPending}
              disabled={!!rollbackConflict && rollback?.status !== "applied"}
            >
              确认回滚
            </Button>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}

function ReceivablesExports({
  accountId,
  scopeFingerprint,
  access,
}: {
  accountId: string;
  scopeFingerprint: string;
  access: ReceivablesAccess;
}) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ReceivablesFilters>({
    status: "active",
  });
  const [categoryFilters, setCategoryFilters] =
    useState<ReceivablesExportCategoryFilters>({});
  const [columns, setColumns] = useState<string[]>([]);
  const [columnsInitialized, setColumnsInitialized] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const key = receivablesScopedQueryKey(accountId, scopeFingerprint, "exports");
  const jobs = useQuery({
    queryKey: key,
    queryFn: () =>
      api<ReceivablesExportList>("/api/receivables/exports?page=1&pageSize=50"),
    enabled: access.canExport,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.rows.some(
        (row) => row.status === "pending" || row.status === "processing",
      )
        ? 2000
        : false,
  });
  const currentJobs = usableReceivablesData(jobs);
  const requestFilters = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value),
  );
  const preview = useQuery({
    queryKey: receivablesScopedQueryKey(
      accountId,
      scopeFingerprint,
      "export-preview",
      requestFilters,
      categoryFilters,
    ),
    queryFn: () =>
      api<ReceivablesExportPreview>(
        "/api/receivables/exports/preview",
        json("POST", { filters: requestFilters, categoryFilters }),
      ),
    enabled: access.canExport,
    retry: false,
  });
  const currentPreview = usableReceivablesData(preview);
  const fail = (error: Error) => {
    message.error(error.message);
    if (receivablesErrorKind(error) === "revoked") {
      qc.removeQueries({
        queryKey: receivablesScopeQueryPrefix(accountId, scopeFingerprint),
      });
      void qc.invalidateQueries({
        queryKey: receivablesQueryKey(accountId, "access"),
      });
    }
  };
  useEffect(() => {
    if (jobs.error && receivablesErrorKind(jobs.error) === "revoked")
      fail(jobs.error);
  }, [jobs.error]);
  useEffect(() => {
    if (currentPreview && !columnsInitialized) {
      setColumns(
        currentPreview.columns
          .filter(({ nonEmptyCount }) => nonEmptyCount > 0)
          .map(({ id }) => id),
      );
      setColumnsInitialized(true);
    }
  }, [columnsInitialized, currentPreview]);
  const changeSelection = () => {
    setIdempotencyKey(crypto.randomUUID());
    setColumnsInitialized(false);
  };
  const create = useMutation({
    mutationFn: () =>
      api(
        "/api/receivables/exports",
        json("POST", {
          idempotencyKey,
          filters: requestFilters,
          categoryFilters,
          columns,
        }),
      ),
    onSuccess: async () => {
      message.success("导出任务已提交");
      setIdempotencyKey(crypto.randomUUID());
      await jobs.refetch();
    },
    onError: fail,
  });
  const download = async (jobId: string) => {
    try {
      const issued = await api<{ token: string; expiresAt: string }>(
        `/api/receivables/exports/${jobId}/token`,
        json("POST", {}),
      );
      const request = receivablesExportDownloadRequest(jobId, issued.token);
      const response = await apiResponse(request.path, request.init);
      const blob = await response.blob();
      const filename = receivablesDownloadFilename(
        response.headers.get("content-disposition"),
        `receivables-${jobId}.xlsx`,
      );
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      message.success("下载已开始");
      await jobs.refetch();
    } catch (error) {
      fail(error as Error);
    }
  };
  if (!access.canExport)
    return <Alert type="error" showIcon message="当前账号没有导出权限" />;
  return (
    <div className="receivables-page receivables-export-workspace">
      <div className="receivables-work-intro">
        按当前权限筛选数据和字段；生成后在下方下载，一次令牌仅能使用一次。
      </div>
      <Card className="filters receivables-work-card" title="导出条件">
        <Form className="receivables-export-form" layout="vertical">
          <div className="receivables-export-filter-grid">
            <Form.Item label="基础记录状态">
              <Select<NonNullable<ReceivablesFilters["status"]>>
                value={filters.status ?? "active"}
                style={{ width: 150 }}
                options={[
                  { value: "active", label: "有效" },
                  { value: "voided", label: "已作废" },
                  { value: "all", label: "全部" },
                ]}
                onChange={(status) => {
                  setFilters((current) => ({ ...current, status }));
                  changeSelection();
                }}
              />
            </Form.Item>
            <Form.Item label="合同 / 项目 / 客户">
              <Input
                allowClear
                value={filters.search ?? ""}
                onChange={(event) => {
                  setFilters((current) => ({
                    ...current,
                    search: event.target.value,
                  }));
                  changeSelection();
                }}
              />
            </Form.Item>
          </div>
          <div className="receivables-export-filter-grid receivables-export-category-grid">
            {currentPreview &&
              receivablesExportCategoryIds.map((category) => (
                <Form.Item
                  key={category}
                  label={exportCategoryLabels[category]}
                >
                  <Select
                    mode="multiple"
                    allowClear
                    value={categoryFilters[category] ?? []}
                    style={{ minWidth: 190 }}
                    options={currentPreview.categoryOptions[category]}
                    onChange={(values) => {
                      setCategoryFilters((current) => ({
                        ...current,
                        [category]: values,
                      }));
                      changeSelection();
                    }}
                  />
                </Form.Item>
              ))}
          </div>
          {preview.isError && (
            <Alert
              type="error"
              showIcon
              message="导出预览失败"
              description={(preview.error as Error).message}
            />
          )}
          {currentPreview && (
            <>
              <Alert
                type={currentPreview.rowCount ? "info" : "warning"}
                showIcon
                message={`匹配 ${currentPreview.rowCount} 条记录`}
              />
              <Form.Item label="导出字段（默认选择有内容的字段）">
                <Checkbox.Group
                  value={columns}
                  onChange={(values) => {
                    setColumns(values as string[]);
                    setColumnsInitialized(true);
                    setIdempotencyKey(crypto.randomUUID());
                  }}
                  options={currentPreview.columns.map((column) => ({
                    value: column.id,
                    label: `${column.label}（${column.nonEmptyCount}）`,
                  }))}
                />
              </Form.Item>
              <Button
                className="receivables-export-submit"
                type="primary"
                loading={create.isPending}
                disabled={!currentPreview.rowCount || !columns.length}
                onClick={() => create.mutate()}
              >
                创建导出任务
              </Button>
            </>
          )}
        </Form>
      </Card>
      {jobs.isError && (
        <Alert
          type="error"
          showIcon
          message="导出任务加载失败，已隐藏缓存内容"
          action={<Button onClick={() => void jobs.refetch()}>重试</Button>}
        />
      )}
      {currentJobs && (
        <Card className="receivables-export-history" title={`导出记录（${currentJobs.rows.length}）`}>
          <Table
          size="small"
          rowKey="id"
          dataSource={currentJobs.rows}
          scroll={{ x: "max-content" }}
          columns={[
            {
              title: "创建时间",
              dataIndex: "createdAt",
              render: (value: string) => new Date(value).toLocaleString(),
            },
            {
              title: "状态",
              dataIndex: "status",
              render: (value: keyof typeof exportLabels) => (
                <Tag>{exportLabels[value]}</Tag>
              ),
            },
            {
              title: "行数",
              dataIndex: "rowCount",
              render: (value: number | null) => value ?? "—",
            },
            {
              title: "大小",
              dataIndex: "size",
              render: (value: number | null) =>
                value === null ? "—" : `${value} B`,
            },
            {
              title: "结果",
              render: (_: unknown, row) =>
                row.error ?? (row.downloadedAt ? "已下载" : "—"),
            },
            {
              title: "操作",
              render: (_: unknown, row) => (
                <Button
                  size="small"
                  disabled={row.status !== "completed" || !!row.downloadedAt}
                  onClick={() => void download(row.id)}
                >
                  下载
                </Button>
              ),
            },
          ]}
          />
        </Card>
      )}
    </div>
  );
}
