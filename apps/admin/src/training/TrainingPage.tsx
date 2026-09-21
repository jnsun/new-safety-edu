import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, message, Modal, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, json } from "../api";
import { AdminPageHeader } from "../AdminUi";

type Template = { id: string; name: string; type: string };
type Paper = { id: string; name: string };
type Assignment = { id: string; status: string };
type Batch = { id: string; name: string; type: string; dueAt?: string | null; assignments: Assignment[]; project?: { name: string } | null };
type Principal = { roles: Array<{ role: string; scopeType: string; scopeId?: string | null }> };
type AutomationConfig = { id: string; type: "three_level" | "project_induction"; active: boolean; template: { name: string }; paper: { name: string } };

const typeNames: Record<string, string> = { three_level: "三级安全教育", project_induction: "项目入场教育", routine: "日常/年度培训", change_update: "变化内容培训" };
const types = Object.entries(typeNames).map(([value, label]) => ({ value, label }));
const errorText = (error: unknown) => error instanceof Error ? error.message : "操作失败，请稍后重试";

export function TrainingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const batches = useQuery({ queryKey: ["training-batches"], queryFn: () => api<Batch[]>("/api/training-batches") });
  const templates = useQuery({ queryKey: ["training-templates"], queryFn: () => api<Template[]>("/api/training-templates") });
  const papers = useQuery({ queryKey: ["exam-papers"], queryFn: () => api<Paper[]>("/api/exam-papers") });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Principal>("/api/auth/me") });
  const automation = useQuery({ queryKey: ["training-automation-configs"], queryFn: () => api<AutomationConfig[]>("/api/training-automation-configs") });
  const [automationForm] = Form.useForm();
  const [automationOpen, setAutomationOpen] = useState(false); const [editing, setEditing] = useState<Batch>();
  const companyAdmin = me.data?.roles.some(({ role }) => role === "company_admin") ?? false;

  const refresh = () => qc.invalidateQueries({ queryKey: ["training-batches"] });

  return <div className="admin-workspace training-schedule-page">
    <AdminPageHeader title="培训安排" description="按完整组织或完整项目下发培训，已完成的学习、考试和签字记录不会被后续编辑覆盖。" actions={<><Button onClick={async () => { const result = await api<{ processed: number }>("/api/training-batches/bootstrap-three-level", { method: "POST" }); message.success(`已处理 ${result.processed} 人`); await refresh(); }}>生成三级教育</Button>{companyAdmin && <Button onClick={() => setAutomationOpen(true)}>自动下发配置</Button>}<Button type="primary" onClick={() => navigate("/training/new")}>进入五步制作并下发</Button></>} />
    {batches.isError && <Alert className="admin-conflict" type="error" showIcon message="培训安排加载失败" description={errorText(batches.error)} action={<Button onClick={() => void batches.refetch()}>重新加载</Button>} />}
    <Card><Table rowKey="id" loading={batches.isLoading} locale={{ emptyText: "暂无培训安排，点击“创建并下发”开始" }} dataSource={batches.data ?? []} columns={[
      { title: "培训", dataIndex: "name" },
      { title: "类型", dataIndex: "type", render: (value: string) => typeNames[value] ?? value },
      { title: "项目", render: (_: unknown, row: Batch) => row.project?.name ?? "—" },
      { title: "截止时间", dataIndex: "dueAt", render: (value: string | null) => value ? new Date(value).toLocaleString("zh-CN") : "未设置" },
      { title: "进度", render: (_: unknown, row: Batch) => { const completed = row.assignments.filter(({ status }) => status === "completed").length; const cancelled = row.assignments.filter(({ status }) => status === "cancelled").length; return <Space><Tag color="green">完成 {completed}</Tag><Tag>未完成 {row.assignments.length - completed - cancelled}</Tag>{cancelled > 0 && <Tag color="red">取消 {cancelled}</Tag>}</Space>; } },
      { title: "操作", width: 170, render: (_: unknown, row: Batch) => <Space><Button size="small" onClick={() => setEditing(row)}>编辑</Button><Button danger size="small" disabled={row.assignments.every(({ status }) => ["completed", "cancelled"].includes(status))} onClick={() => { let reason = ""; Modal.confirm({ title: `撤回培训“${row.name}”？`, content: <><Alert type="warning" showIcon message="只撤回尚未完成的人员任务；已完成记录永久保留。" style={{ marginBottom: 12 }} /><Input.TextArea placeholder="请输入撤回原因" onChange={(event) => { reason = event.target.value; }} /></>, okText: "确认撤回", okButtonProps: { danger: true }, onOk: async () => { try { if (reason.trim().length < 2) throw new Error("请输入至少 2 个字的撤回原因"); const result = await api<{ cancelled: number; completedPreserved: number }>(`/api/training-batches/${row.id}/cancel`, json("POST", { reason: reason.trim() })); message.success(`已撤回 ${result.cancelled} 人，保留已完成 ${result.completedPreserved} 人`); await refresh(); } catch (error) { message.error(errorText(error)); throw error; } } }); }}>撤回</Button></Space> }
    ]} /></Card>

    <Modal title="编辑培训安排" open={!!editing} footer={null} destroyOnHidden onCancel={() => setEditing(undefined)}>{editing && <Form key={editing.id} layout="vertical" initialValues={{ name: editing.name, dueAt: editing.dueAt ? localDateTimeValue(editing.dueAt) : undefined }} onFinish={async (values) => { try { await api(`/api/training-batches/${editing.id}`, json("PATCH", { name: values.name, dueAt: values.dueAt ? new Date(String(values.dueAt)).toISOString() : null })); message.success("培训安排已更新"); setEditing(undefined); await refresh(); } catch (error) { message.error(errorText(error)); } }}><Alert type="info" showIcon message="为保护已产生的学习和考试记录，下发后只允许修改培训名称和截止时间。" style={{ marginBottom: 16 }} /><Form.Item name="name" label="培训名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="dueAt" label="截止时间"><Input type="datetime-local" /></Form.Item><Button type="primary" htmlType="submit">保存修改</Button></Form>}</Modal>

    <Modal title="自动下发默认配置" open={automationOpen} footer={null} onCancel={() => setAutomationOpen(false)}><Table size="small" rowKey="id" pagination={false} dataSource={(automation.data ?? []).filter(({ active }) => active)} columns={[{ title: "类型", dataIndex: "type", render: (value: string) => typeNames[value] ?? value }, { title: "模板", render: (_: unknown, row: AutomationConfig) => row.template.name }, { title: "试卷", render: (_: unknown, row: AutomationConfig) => row.paper.name }]} /><Form form={automationForm} layout="vertical" style={{ marginTop: 16 }} onFinish={async (values) => { await api("/api/training-automation-configs", json("POST", { ...values, scopeType: "company", scopeId: null })); message.success("默认配置已更新"); automationForm.resetFields(); await automation.refetch(); }}><Form.Item name="type" label="自动培训类型" rules={[{ required: true }]}><Select options={types.filter(({ value }) => ["three_level", "project_induction"].includes(value))} /></Form.Item><Form.Item name="templateId" label="模板" rules={[{ required: true }]}><Select options={(templates.data ?? []).filter(({ type }) => ["three_level", "project_induction"].includes(type)).map(({ id, name, type }) => ({ value: id, label: `${typeNames[type]} · ${name}` }))} /></Form.Item><Form.Item name="paperId" label="试卷" rules={[{ required: true }]}><Select options={(papers.data ?? []).map(({ id, name }) => ({ value: id, label: name }))} /></Form.Item><Button type="primary" htmlType="submit">保存并启用</Button></Form></Modal>
  </div>;
}

function localDateTimeValue(value: string) {
  const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
