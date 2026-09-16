import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Descriptions, Form, Input, message, Modal, Select, Space, Steps, Table, Tag, Typography, Upload } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UploadFile } from "antd";
import { api, apiResponse, json } from "./api";
import { canApplyReceivablesImport, preserveReceivablesConflictDraft, receivablesDownloadFilename, receivablesErrorKind, receivablesExportDownloadRequest, receivablesImportStage, receivablesQueryKey, receivablesScopeQueryPrefix, receivablesScopedQueryKey, updateReceivablesImportDecision, usableReceivablesData, type ReceivablesAccess, type ReceivablesExportList, type ReceivablesFilters, type ReceivablesImportBatch, type ReceivablesImportPreview } from "./receivables-types";

const stageIndex = { upload: 0, blocking_errors: 1, duplicate_decisions: 2, impact_preview: 3, confirm_apply: 4 } as const;
const stageItems = ["上传文件", "阻断错误", "重复决策", "影响预览", "确认应用"].map((title) => ({ title }));
const batchLabels = { previewed: "待应用", applied: "已应用", failed: "失败", rolled_back: "已回滚" } as const;
const exportLabels = { pending: "排队中", processing: "生成中", completed: "可下载", failed: "失败", expired: "已过期" } as const;
const hasNonZeroAmount = (value: string | null) => value !== null && !/^0+(?:\.0+)?$/.test(value);

export function ReceivablesTransfers({ accountId, scopeFingerprint, access, section }: { accountId: string; scopeFingerprint: string; access: ReceivablesAccess; section: "imports" | "exports" }) {
  return section === "imports" ? <ReceivablesImports accountId={accountId} scopeFingerprint={scopeFingerprint} access={access} /> : <ReceivablesExports accountId={accountId} scopeFingerprint={scopeFingerprint} access={access} />;
}

function ReceivablesImports({ accountId, scopeFingerprint, access }: { accountId: string; scopeFingerprint: string; access: ReceivablesAccess }) {
  const qc = useQueryClient();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [preview, setPreview] = useState<ReceivablesImportPreview>();
  const [decisions, setDecisions] = useState<Record<number, "skip" | "update">>({});
  const [confirmStage, setConfirmStage] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [rollback, setRollback] = useState<ReceivablesImportBatch>();
  const [applyConflict, setApplyConflict] = useState<ReturnType<typeof preserveReceivablesConflictDraft<{ decisions: Record<number, "skip" | "update">; revision: number }, ReceivablesImportBatch>>>();
  const [applyReconfirm, setApplyReconfirm] = useState(false);
  const [rollbackConflict, setRollbackConflict] = useState<ReturnType<typeof preserveReceivablesConflictDraft<{ reason: string; revision: number }, ReceivablesImportBatch>>>();
  const [rollbackForm] = Form.useForm();
  const historyKey = receivablesScopedQueryKey(accountId, scopeFingerprint, "imports");
  const history = useQuery({ queryKey: historyKey, queryFn: () => api<ReceivablesImportBatch[]>("/api/receivables/imports"), enabled: access.canImport, retry: false });
  const currentHistory = usableReceivablesData(history);
  const resetPreview = () => { setPreview(undefined); setDecisions({}); setConfirmStage(false); setConfirmed(false); setApplyConflict(undefined); setApplyReconfirm(false); setFileList([]); };
  const revoked = (error: Error) => { message.error(error.message); if (receivablesErrorKind(error) === "revoked") { resetPreview(); qc.removeQueries({ queryKey: receivablesScopeQueryPrefix(accountId, scopeFingerprint) }); void qc.invalidateQueries({ queryKey: receivablesQueryKey(accountId, "access") }); } };
  useEffect(() => { if (history.error && receivablesErrorKind(history.error) === "revoked") revoked(history.error); }, [history.error]);
  const upload = useMutation({ mutationFn: async () => { const file = fileList[0]?.originFileObj; if (!file) throw new Error("请选择 XLSX 文件"); const data = new FormData(); data.append("file", file); return api<ReceivablesImportPreview>("/api/receivables/imports/preview", { method: "POST", body: data }); }, onSuccess: (result) => { setPreview(result); setDecisions({}); setConfirmStage(false); setConfirmed(false); message.success("文件校验完成"); void history.refetch(); }, onError: revoked });
  const duplicates = preview?.rows.filter((row) => !!row.ledgerId && !(row.errors?.length)) ?? [];
  const stage = preview ? receivablesImportStage(preview, decisions, confirmStage) : "upload";
  const effect = useMemo(() => preview ? {
    create: preview.rows.filter((row) => !row.ledgerId && !(row.errors?.length)).length,
    update: duplicates.filter((row) => decisions[row.rowNumber] === "update").length,
    skip: duplicates.filter((row) => decisions[row.rowNumber] === "skip").length,
  } : { create: 0, update: 0, skip: 0 }, [decisions, duplicates, preview]);
  const apply = useMutation({ mutationFn: () => api(`/api/receivables/imports/${preview!.batchId}/apply`, json("POST", { revision: preview!.revision, decisions: Object.entries(decisions).map(([rowNumber, decision]) => ({ rowNumber: Number(rowNumber), decision })) })), onSuccess: async () => { message.success("导入已应用"); resetPreview(); await qc.invalidateQueries({ queryKey: receivablesScopeQueryPrefix(accountId, scopeFingerprint) }); }, onError: async (error: Error) => {
    if (receivablesErrorKind(error) === "conflict" && preview) {
      const draft = { decisions: { ...decisions }, revision: preview.revision }; const refreshed = await history.refetch(); const latest = refreshed.data?.find((batch) => batch.id === preview.batchId);
      if (latest) { setApplyConflict(preserveReceivablesConflictDraft(draft, latest)); setPreview((current) => current ? { ...current, revision: latest.revision } : current); setApplyReconfirm(false); setConfirmed(false); setConfirmStage(false); }
    }
    revoked(error);
  } });
  const rollbackMutation = useMutation({ mutationFn: (values: { reason: string; confirm: boolean; reconfirm?: boolean }) => api(`/api/receivables/imports/${rollback!.id}/rollback`, json("POST", { revision: rollback!.revision, reason: values.reason })), onSuccess: async () => { message.success("批次已回滚"); setRollback(undefined); setRollbackConflict(undefined); await qc.invalidateQueries({ queryKey: receivablesScopeQueryPrefix(accountId, scopeFingerprint) }); }, onError: async (error: Error) => {
    if (receivablesErrorKind(error) === "conflict" && rollback) { const reason = String(rollbackForm.getFieldValue("reason") ?? ""); const refreshed = await history.refetch(); const latest = refreshed.data?.find((batch) => batch.id === rollback.id); if (latest) { setRollback(latest); setRollbackConflict(preserveReceivablesConflictDraft({ reason, revision: rollback.revision }, latest)); rollbackForm.setFieldsValue({ reason, confirm: false, reconfirm: false }); } }
    revoked(error);
  } });
  if (!access.canImport) return <Alert type="error" showIcon message="当前账号没有导入权限" />;
  return <div className="receivables-page">
    <div className="page-title receivables-page-title"><div><Typography.Title level={3}>导入批次</Typography.Title><Typography.Text type="secondary">上传、校验、逐条处理重复项，确认影响后再应用。</Typography.Text></div></div>
    <Card className="receivables-transfer-card" title="新建导入">
      <Steps current={stageIndex[stage]} items={stageItems} responsive />
      <div className="receivables-transfer-stage">
        {!preview && <Space wrap><Upload accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" maxCount={1} fileList={fileList} beforeUpload={(file) => { setFileList([{ uid: file.uid, name: file.name, status: "done", originFileObj: file }]); return false; }} onRemove={() => { setFileList([]); return true; }}><Button>选择 XLSX</Button></Upload><Button type="primary" disabled={!fileList.length} loading={upload.isPending} onClick={() => upload.mutate()}>上传并校验</Button></Space>}
        {preview && <>
          {preview.errors.length > 0 && <Alert type="error" showIcon message={`发现 ${preview.errors.length} 个阻断错误`} description={<ul>{preview.errors.slice(0, 20).map((issue, index) => <li key={`${issue.code}-${issue.rowNumber ?? index}`}>{issue.rowNumber ? `第 ${issue.rowNumber} 行：` : ""}{issue.message}</li>)}</ul>} />}
          {preview.warnings.length > 0 && <Alert type="warning" showIcon message={`另有 ${preview.warnings.length} 条提示`} description={<ul>{preview.warnings.slice(0, 20).map((issue, index) => <li key={`${issue.code}-${issue.rowNumber ?? index}`}>{issue.rowNumber ? `第 ${issue.rowNumber} 行：` : ""}{issue.message}</li>)}</ul>} />}
          {!preview.errors.length && duplicates.length > 0 && <Table size="small" rowKey="id" pagination={false} scroll={{ x: "max-content" }} dataSource={duplicates} columns={[{ title: "行号", dataIndex: "rowNumber" }, { title: "合同编号", dataIndex: ["normalizedData", "contractNo"] }, { title: "处理决定", render: (_: unknown, row) => { const skipOnly = hasNonZeroAmount(row.normalizedData.openingInvoiceAmount) || hasNonZeroAmount(row.normalizedData.openingReceiptAmount); return <Space direction="vertical" size={2}><Select<"skip" | "update"> aria-label={`第 ${row.rowNumber} 行处理决定`} value={decisions[row.rowNumber] ?? null} style={{ width: 160 }} options={[{ value: "skip", label: "跳过" }, { value: "update", label: "更新现有台账", disabled: skipOnly }]} onChange={(decision) => { const next = updateReceivablesImportDecision({ decisions, confirmStage, confirmed }, row.rowNumber, decision); setDecisions(next.decisions); setConfirmStage(next.confirmStage); setConfirmed(next.confirmed); setApplyReconfirm(false); }} />{skipOnly && <Typography.Text type="secondary">含非零期初金额，只能跳过</Typography.Text>}</Space>; } }]} />}
          {!preview.errors.length && stage === "impact_preview" && <><Descriptions bordered size="small" items={[{ key: "create", label: "新建", children: effect.create }, { key: "update", label: "更新", children: effect.update }, { key: "skip", label: "跳过", children: effect.skip }]} /><Button type="primary" onClick={() => setConfirmStage(true)}>进入最终确认</Button></>}
          {applyConflict && <Alert type="warning" showIcon message="导入预览状态已变化" description={`本地决定与草稿已保留；服务端最新状态 ${batchLabels[applyConflict.latest.status]}，修订 ${applyConflict.latest.revision}。${applyConflict.latest.status === "previewed" && applyConflict.latest.revision !== applyConflict.draft.revision ? "请重新进入影响预览并显式确认。" : "当前批次不可安全重试，请重新上传生成新预览。"}`} />}
          {!preview.errors.length && stage === "confirm_apply" && <Space direction="vertical"><Alert type="warning" showIcon message={`将新建 ${effect.create} 条、更新 ${effect.update} 条、跳过 ${effect.skip} 条`} />{applyConflict && <Checkbox checked={applyReconfirm} onChange={(event) => setApplyReconfirm(event.target.checked)}>我已核对服务端最新修订并再次确认</Checkbox>}<Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}>我已核对影响和重复项决定</Checkbox><Space><Button onClick={() => { setConfirmStage(false); setConfirmed(false); }}>返回影响预览</Button><Button type="primary" danger disabled={!confirmed || !!applyConflict && (!applyReconfirm || applyConflict.latest.status !== "previewed" || applyConflict.latest.revision === applyConflict.draft.revision) || !canApplyReceivablesImport(preview, decisions, confirmStage)} loading={apply.isPending} onClick={() => apply.mutate()}>确认应用</Button></Space></Space>}
          <Button className="receivables-reset" onClick={resetPreview}>放弃本次预览</Button>
        </>}
      </div>
    </Card>
    <Card className="section-card" title="历史批次">
      {history.isError && <Alert type="error" showIcon message="历史批次加载失败，已隐藏缓存内容" />}
      {currentHistory && <Table rowKey="id" dataSource={currentHistory} scroll={{ x: "max-content" }} columns={[{ title: "文件", dataIndex: ["originalFile", "originalName"] }, { title: "状态", dataIndex: "status", render: (value: keyof typeof batchLabels) => <Tag>{batchLabels[value]}</Tag> }, { title: "行数", dataIndex: "rowCount" }, { title: "错误", dataIndex: "errorCount" }, { title: "创建时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() }, { title: "操作", render: (_: unknown, row) => <Button size="small" danger disabled={row.status !== "applied"} onClick={() => { setRollback(row); setRollbackConflict(undefined); rollbackForm.resetFields(); }}>回滚</Button> }]} />}
    </Card>
    <Modal title="回滚导入批次" open={!!rollback} footer={null} destroyOnClose onCancel={() => setRollback(undefined)}><Alert type="warning" showIcon message="回滚会按批次修订恢复或删除受影响台账，冲突时服务端将拒绝。" />{rollbackConflict && <Alert type="warning" showIcon message="批次已变化，旧修订已作废" description={`原因草稿已保留；最新状态 ${batchLabels[rollbackConflict.latest.status]}，修订 ${rollbackConflict.latest.revision}。`} />}<Form form={rollbackForm} layout="vertical" onFinish={(values) => rollbackMutation.mutate(values)}><Form.Item name="reason" label="回滚原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea /></Form.Item><Form.Item name={rollbackConflict ? "reconfirm" : "confirm"} valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请确认回滚")) }]}><Checkbox>我已核对最新批次并确认回滚</Checkbox></Form.Item><Button type="primary" danger htmlType="submit" loading={rollbackMutation.isPending} disabled={!!rollbackConflict && rollback?.status !== "applied"}>确认回滚</Button></Form></Modal>
  </div>;
}

function ReceivablesExports({ accountId, scopeFingerprint, access }: { accountId: string; scopeFingerprint: string; access: ReceivablesAccess }) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ReceivablesFilters>({ status: "active" });
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const key = receivablesScopedQueryKey(accountId, scopeFingerprint, "exports");
  const jobs = useQuery({ queryKey: key, queryFn: () => api<ReceivablesExportList>("/api/receivables/exports?page=1&pageSize=50"), enabled: access.canExport, retry: false, refetchInterval: (query) => query.state.data?.rows.some((row) => row.status === "pending" || row.status === "processing") ? 2000 : false });
  const currentJobs = usableReceivablesData(jobs);
  const fail = (error: Error) => { message.error(error.message); if (receivablesErrorKind(error) === "revoked") { qc.removeQueries({ queryKey: receivablesScopeQueryPrefix(accountId, scopeFingerprint) }); void qc.invalidateQueries({ queryKey: receivablesQueryKey(accountId, "access") }); } };
  useEffect(() => { if (jobs.error && receivablesErrorKind(jobs.error) === "revoked") fail(jobs.error); }, [jobs.error]);
  const create = useMutation({ mutationFn: () => api("/api/receivables/exports", json("POST", { idempotencyKey, filters: Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) })), onSuccess: async () => { message.success("导出任务已提交"); setIdempotencyKey(crypto.randomUUID()); await jobs.refetch(); }, onError: fail });
  const download = async (jobId: string) => {
    try {
      const issued = await api<{ token: string; expiresAt: string }>(`/api/receivables/exports/${jobId}/token`, json("POST", {}));
      const request = receivablesExportDownloadRequest(jobId, issued.token);
      const response = await apiResponse(request.path, request.init);
      const blob = await response.blob();
      const filename = receivablesDownloadFilename(response.headers.get("content-disposition"), `receivables-${jobId}.xlsx`);
      const url = URL.createObjectURL(blob);
      try { const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); } finally { URL.revokeObjectURL(url); }
      message.success("下载已开始"); await jobs.refetch();
    } catch (error) { fail(error as Error); }
  };
  if (!access.canExport) return <Alert type="error" showIcon message="当前账号没有导出权限" />;
  return <div className="receivables-page">
    <div className="page-title receivables-page-title"><div><Typography.Title level={3}>导出任务</Typography.Title><Typography.Text type="secondary">任务按服务端权限快照生成；下载令牌只通过 POST 请求体传输且单次使用。</Typography.Text></div></div>
    <Card className="filters" title="导出筛选"><Form layout="inline"><Form.Item label="记录状态"><Select<NonNullable<ReceivablesFilters["status"]>> value={filters.status ?? "active"} style={{ width: 140 }} options={[{ value: "active", label: "有效" }, { value: "voided", label: "已作废" }, { value: "all", label: "全部" }]} onChange={(status) => { setFilters((current) => ({ ...current, status })); setIdempotencyKey(crypto.randomUUID()); }} /></Form.Item><Form.Item label="合同 / 项目 /客户"><Input allowClear value={filters.search ?? ""} onChange={(event) => { setFilters((current) => ({ ...current, search: event.target.value })); setIdempotencyKey(crypto.randomUUID()); }} /></Form.Item><Form.Item><Button type="primary" loading={create.isPending} onClick={() => create.mutate()}>创建导出任务</Button></Form.Item></Form></Card>
    {jobs.isError && <Alert type="error" showIcon message="导出任务加载失败，已隐藏缓存内容" action={<Button onClick={() => void jobs.refetch()}>重试</Button>} />}
    {currentJobs && <Table rowKey="id" dataSource={currentJobs.rows} scroll={{ x: "max-content" }} columns={[{ title: "创建时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() }, { title: "状态", dataIndex: "status", render: (value: keyof typeof exportLabels) => <Tag>{exportLabels[value]}</Tag> }, { title: "行数", dataIndex: "rowCount", render: (value: number | null) => value ?? "—" }, { title: "大小", dataIndex: "size", render: (value: number | null) => value === null ? "—" : `${value} B` }, { title: "结果", render: (_: unknown, row) => row.error ?? (row.downloadedAt ? "已下载" : "—") }, { title: "操作", render: (_: unknown, row) => <Button size="small" disabled={row.status !== "completed" || !!row.downloadedAt} onClick={() => void download(row.id)}>下载</Button> }]} />}
  </div>;
}
