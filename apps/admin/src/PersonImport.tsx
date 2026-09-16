import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Descriptions, Divider, Modal, Select, Space, Statistic, Table, Tag, Typography, Upload, message } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { api, json } from "./api";

type Status = "ready" | "unchanged" | "failed" | "conflict" | "pending_data";
type ResultStatus = "created" | "updated" | "skipped" | "failed" | "conflict" | "pending_data";
type Preview = {
  id: string;
  files: { source: string; phone: string | null; photos: string | null };
  counts: { total: number; ready: number; create: number; update: number; unchanged: number; failed: number; conflict: number; pendingData: number };
  phoneStats: { total: number; matched: number; failed: number; conflict: number; unmatched: number };
  phoneIssues: Array<{ rowNumber: number; name: string; nationalIdMasked: string; phoneMasked: string; status: "failed" | "conflict" | "unmatched"; reasons: string[] }>;
  photoStats: { total: number; valid: number; invalid: number; matched: number; conflict: number; unmatched: number };
  photoErrors: Array<{ name: string; reason: string }>;
  photoIssues: Array<{ id: string; name: string; status: "conflict" | "unmatched"; reason: string }>;
  departments: Array<{ sourceName: string; count: number; organizationId: string | null; formalName: string | null; organizationType: string | null; parentName: string | null; createOnConfirm: boolean }>;
  organizations: Array<{ id: string; name: string; type: string; parentId: string | null; parent: { name: string } | null }>;
  photoOptions: Array<{ id: string; name: string }>;
  rows: Array<{ rowNumber: number; name: string; workDepartment: string; sourceDepartment: string; nationalIdMasked: string; phoneMasked: string; photoId?: string; photoName?: string; excluded: boolean; status: Status; action?: "create" | "update" | "skip" | "conflict"; reasons: string[] }>;
  result: ImportResult | null;
};
type ImportResult = { counts: { success: number; created: number; updated: number; skipped: number; failed: number; conflict: number; pendingData: number }; rows: Array<{ rowNumber: number; name: string; status: ResultStatus; reasons: string[] }> };

const statusText: Record<Status | ResultStatus, string> = { ready: "可写入", unchanged: "无需补齐", created: "已新建", updated: "已补齐", skipped: "已跳过", failed: "失败", conflict: "冲突", pending_data: "待补资料" };
const statusColor: Record<Status | ResultStatus, string> = { ready: "green", unchanged: "default", created: "green", updated: "blue", skipped: "default", failed: "red", conflict: "orange", pending_data: "default" };

async function upload(path: string, file: File) {
  const body = new FormData(); body.append("file", file);
  return api<Preview>(path, { method: "POST", body });
}

export function PersonImport({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview>(); const [result, setResult] = useState<ImportResult>();
  const [mappings, setMappings] = useState<Record<string, string>>({}); const [createDepartments, setCreateDepartments] = useState<string[]>([]); const [excludedRows, setExcludedRows] = useState<number[]>([]); const [photoAssignments, setPhotoAssignments] = useState<Record<string, string>>({});
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20); const [confirmCount, setConfirmCount] = useState<number>();
  useEffect(() => {
    if (!preview) return;
    setMappings(Object.fromEntries(preview.departments.filter((item) => item.organizationId).map((item) => [item.sourceName, item.organizationId!])))
    setCreateDepartments(preview.departments.filter((item) => item.createOnConfirm).map((item) => item.sourceName));
    setExcludedRows(preview.rows.filter((row) => row.excluded).map((row) => row.rowNumber));
    setPhotoAssignments(Object.fromEntries(preview.rows.filter((row) => row.photoId).map((row) => [String(row.rowNumber), row.photoId!])))
    if (preview.result) setResult(preview.result);
  }, [preview]);
  const run = async (action: () => Promise<Preview>) => { setBusy(true); try { setPreview(await action()); } catch (error) { message.error((error as Error).message); } finally { setBusy(false); } };
  const reset = () => { setOpen(false); setPreview(undefined); setResult(undefined); setMappings({}); setCreateDepartments([]); setExcludedRows([]); setPhotoAssignments({}); setSelectedRows([]); setPage(1); setConfirmCount(undefined); };
  const saveConfig = () => preview && run(() => api<Preview>(`/api/person-imports/${preview.id}/config`, json("PUT", { mappings, createDepartments, excludedRows, photoAssignments })));
  const confirm = async () => {
    if (!preview) return; setBusy(true);
    try { const value = await api<ImportResult>(`/api/person-imports/${preview.id}/confirm`, { method: "POST" }); setResult(value); setConfirmCount(undefined); message.success(`处理完成：新建 ${value.counts.created} 人，补齐 ${value.counts.updated} 人`); }
    catch (error) { message.error((error as Error).message); } finally { setBusy(false); }
  };
  const openConfirm = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const latest = await api<Preview>(`/api/person-imports/${preview.id}/config`, json("PUT", { mappings, createDepartments, excludedRows, photoAssignments }));
      setPreview(latest);
      if (!latest.counts.ready) return void message.warning("当前没有可导入人员，请检查姓名、手机号、冲突记录或本次排除项");
      setConfirmCount(latest.counts.ready);
    } catch (error) { message.error((error as Error).message); } finally { setBusy(false); }
  };
  const readyRows = preview?.rows.filter((row) => row.status === "ready" && !excludedRows.includes(row.rowNumber)).map((row) => row.rowNumber) ?? [];
  return <>
    {enabled && <Button icon={<UploadOutlined />} onClick={() => setOpen(true)}>生产人员初始化</Button>}
    <Modal title="生产人员基础档案初始化" open={open} width={1240} footer={<Button onClick={reset}>关闭</Button>} onCancel={reset} destroyOnHidden>
      <Alert showIcon type="warning" message="预检查不会写入人员档案；正式确认只导入通过全部验证且未被排除的人员。" />
      <Divider orientation="left">A. 主人员 Excel</Divider>
      <Space wrap><Upload accept=".xlsx,.csv" maxCount={1} beforeUpload={(file) => { void run(() => upload("/api/person-imports/preview", file)); return false; }}><Button type="primary" loading={busy}>选择并预检查主人员表</Button></Upload><Typography.Text type="secondary">同一张表读取姓名、身份证、手机号和工作部门。</Typography.Text></Space>
      {preview && <>
        {!!preview.phoneStats.total && <>
          <Typography.Paragraph style={{ marginTop: 12, marginBottom: 8 }}>Excel 手机号：总计 {preview.phoneStats.total}，有效 {preview.phoneStats.matched}，失败 {preview.phoneStats.failed}，冲突 {preview.phoneStats.conflict}，未匹配 {preview.phoneStats.unmatched}</Typography.Paragraph>
          {!!preview.phoneIssues.length && <Table size="small" rowKey={(row) => `${row.rowNumber}-${row.status}`} pagination={{ pageSize: 5 }} dataSource={preview.phoneIssues} columns={[
            { title: "行号", dataIndex: "rowNumber", width: 70 }, { title: "姓名", dataIndex: "name", width: 100 }, { title: "身份证", dataIndex: "nationalIdMasked", width: 170 }, { title: "手机号", dataIndex: "phoneMasked", width: 130 },
            { title: "状态", width: 90, render: (_, row) => <Tag color={row.status === "unmatched" ? "default" : statusColor[row.status]}>{row.status === "unmatched" ? "未匹配" : statusText[row.status]}</Tag> }, { title: "原因", render: (_, row) => row.reasons.join("；") }
          ]} />}
        </>}
        <Divider orientation="left">B. 部门匹配</Divider>
        {!preview.organizations.some((organization) => organization.type === "company") && <Alert type="error" showIcon message="暂无公司根组织，不能自动创建部门。" />}
        <Space style={{ marginBottom: 12 }} wrap>
          <Button onClick={() => setCreateDepartments(preview.departments.filter((item) => !item.organizationId && !mappings[item.sourceName] && item.sourceName.replace(/\s+/g, "") !== "工作部门").map((item) => item.sourceName))}>全部未匹配项按原名创建为部门</Button>
          <Button disabled={!createDepartments.length} onClick={() => setCreateDepartments([])}>取消自动创建</Button>
          <Typography.Text type="secondary">已选择自动创建 {createDepartments.length} 个部门；确认导入时才写入。</Typography.Text>
        </Space>
        <Table size="small" rowKey="sourceName" pagination={false} dataSource={preview.departments} columns={[
          { title: "Excel 认定部门", dataIndex: "sourceName" }, { title: "人数", dataIndex: "count", width: 80 },
          { title: "正式组织 / 导入动作", render: (_, row) => row.sourceName.replace(/\s+/g, "") === "工作部门" ? <Tag color="red">异常表头值，不创建组织</Tag> : <Space wrap><Select showSearch optionFilterProp="label" disabled={createDepartments.includes(row.sourceName)} style={{ width: 390 }} value={mappings[row.sourceName] ?? null} placeholder="同名自动匹配；也可选择现有组织" allowClear onChange={(value) => { setMappings((current) => { const next = { ...current }; if (value) next[row.sourceName] = value; else delete next[row.sourceName]; return next; }); if (value) setCreateDepartments((current) => current.filter((name) => name !== row.sourceName)); }} options={preview.organizations.filter((organization) => organization.type !== "company").map((organization) => ({ value: organization.id, label: `${organization.name}｜${organization.type}｜上级：${organization.parent?.name ?? "无"}` }))} /><Checkbox disabled={Boolean(row.organizationId || mappings[row.sourceName])} checked={createDepartments.includes(row.sourceName)} onChange={(event) => setCreateDepartments((current) => event.target.checked ? [...new Set([...current, row.sourceName])] : current.filter((name) => name !== row.sourceName))}>{row.organizationId || mappings[row.sourceName] ? "已匹配" : "按原名创建部门"}</Checkbox></Space> }
        ]} />
        <Divider orientation="left">C. 照片 ZIP</Divider>
        <Space wrap><Upload accept=".zip" maxCount={1} beforeUpload={(file) => { void run(() => upload(`/api/person-imports/${preview.id}/photos`, file)); return false; }}><Button loading={busy}>选择并预检查照片 ZIP</Button></Upload><Typography.Text type="secondary">从“身份证号码 + 姓名”文件名提取身份证精确匹配，并核对姓名。</Typography.Text></Space>
        {!!preview.photoStats.total && <Typography.Paragraph style={{ marginTop: 12, marginBottom: 8 }}>照片：总计 {preview.photoStats.total}，有效 {preview.photoStats.valid}，已匹配 {preview.photoStats.matched}，冲突 {preview.photoStats.conflict}，未匹配 {preview.photoStats.unmatched}，格式错误 {preview.photoStats.invalid}</Typography.Paragraph>}
        {!!preview.photoErrors.length && <Alert style={{ marginTop: 12 }} type="error" showIcon message={`${preview.photoErrors.length} 个照片条目格式错误`} description={preview.photoErrors.map((item) => `${item.name}：${item.reason}`).join("；")} />}
        {!!preview.photoIssues.length && <Table style={{ marginTop: 12 }} size="small" rowKey="id" pagination={{ pageSize: 5 }} dataSource={preview.photoIssues} columns={[
          { title: "照片文件", dataIndex: "name" }, { title: "状态", width: 100, render: (_, row) => <Tag color={row.status === "conflict" ? "orange" : "default"}>{row.status === "conflict" ? "冲突" : "未匹配"}</Tag> }, { title: "原因", dataIndex: "reason" }
        ]} />}
        <Divider orientation="left">D. 冲突、排除与确认</Divider>
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="重复人员不会再次创建：身份证优先、手机号辅助匹配，只补齐当前为空的字段；已有非空资料不覆盖。" />
        <Space size="large" wrap><Statistic title="总行数" value={preview.counts.total} /><Statistic title="新建人员" value={preview.counts.create} valueStyle={{ color: "#15803d" }} /><Statistic title="补齐已有人员" value={preview.counts.update} valueStyle={{ color: "#1677ff" }} /><Statistic title="无需补齐" value={preview.counts.unchanged} /><Statistic title="失败" value={preview.counts.failed} valueStyle={{ color: "#dc2626" }} /><Statistic title="冲突" value={preview.counts.conflict} valueStyle={{ color: "#d97706" }} /><Statistic title="待补资料" value={preview.counts.pendingData} /></Space>
        <Space style={{ margin: "12px 0" }} wrap><Button onClick={() => setSelectedRows(readyRows)}>全选可导入人员（{readyRows.length}）</Button><Button disabled={!selectedRows.length} onClick={() => setSelectedRows([])}>清空选择</Button><Button disabled={!selectedRows.length} onClick={() => setExcludedRows((current) => [...new Set([...current, ...selectedRows])])}>批量排除所选</Button><Button disabled={!selectedRows.length} onClick={() => setExcludedRows((current) => current.filter((row) => !selectedRows.includes(row)))}>取消所选排除</Button><Typography.Text type="secondary">已选择 {selectedRows.length} 行</Typography.Text></Space>
        <Table size="small" rowKey="rowNumber" rowSelection={{ preserveSelectedRowKeys: true, selectedRowKeys: selectedRows, onChange: (keys) => setSelectedRows(keys.map(Number)) }} pagination={{ current: page, pageSize, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 200, 500], showTotal: (total) => `共 ${total} 人`, onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); } }} scroll={{ x: 1200 }} dataSource={preview.rows} columns={[
          { title: "行号", dataIndex: "rowNumber", width: 70 }, { title: "姓名", dataIndex: "name", width: 100 }, { title: "工作部门", dataIndex: "workDepartment", width: 170 }, { title: "来源部门", dataIndex: "sourceDepartment", width: 150 }, { title: "身份证", dataIndex: "nationalIdMasked", width: 170 }, { title: "手机号", dataIndex: "phoneMasked", width: 130 },
          { title: "照片", width: 220, render: (_, row) => <Select showSearch optionFilterProp="label" allowClear style={{ width: 200 }} placeholder="选择照片" value={photoAssignments[String(row.rowNumber)] ?? row.photoId ?? null} onChange={(value) => setPhotoAssignments((current) => { const next = { ...current }; if (value) next[String(row.rowNumber)] = value; else delete next[String(row.rowNumber)]; return next; })} options={preview.photoOptions.map((photo) => ({ value: photo.id, label: photo.name }))} /> },
          { title: "处理方式", width: 110, render: (_, row) => <Tag color={statusColor[row.status]}>{row.action === "create" && row.status === "ready" ? "新建" : row.action === "update" && row.status === "ready" ? "补齐空缺" : statusText[row.status]}</Tag> }, { title: "原因", width: 280, render: (_, row) => row.reasons.join("；") || "—" },
          { title: "本次排除", width: 100, render: (_, row) => <Checkbox checked={excludedRows.includes(row.rowNumber)} onChange={(event) => setExcludedRows((current) => event.target.checked ? [...current, row.rowNumber] : current.filter((value) => value !== row.rowNumber))}>排除</Checkbox> }
        ]} />
        <Space><Button onClick={() => void saveConfig()} loading={busy}>保存映射与处理结果</Button><Button danger type="primary" disabled={!!result} loading={busy} onClick={() => void openConfirm()}>Confirm 正式导入</Button></Space>
        {confirmCount !== undefined && <Alert style={{ marginTop: 12 }} type="warning" showIcon message={`即将新建 ${preview.counts.create} 人、补齐 ${preview.counts.update} 人，并创建 ${createDepartments.length} 个部门`} description="已有非空资料不会覆盖；新建人员会触发三级教育幂等下发。" action={<Space direction="vertical"><Button danger type="primary" loading={busy} onClick={() => void confirm()}>确认写入</Button><Button onClick={() => setConfirmCount(undefined)}>取消</Button></Space>} />}
      </>}
      {result && <><Divider orientation="left">E. 导入结果</Divider><Descriptions bordered size="small" items={[{ key: "created", label: "新建", children: result.counts.created }, { key: "updated", label: "补齐", children: result.counts.updated }, { key: "skipped", label: "跳过", children: result.counts.skipped }, { key: "failed", label: "失败", children: result.counts.failed }, { key: "conflict", label: "冲突", children: result.counts.conflict }, { key: "pending", label: "待补资料", children: result.counts.pendingData }]} /><Table style={{ marginTop: 16 }} size="small" rowKey="rowNumber" dataSource={result.rows} columns={[{ title: "行号", dataIndex: "rowNumber" }, { title: "姓名", dataIndex: "name" }, { title: "结果", render: (_, row) => <Tag color={statusColor[row.status]}>{statusText[row.status]}</Tag> }, { title: "原因", render: (_, row) => row.reasons.join("；") || "—" }]} /></>}
    </Modal>
  </>;
}
