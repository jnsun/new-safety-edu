import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Form, Input, InputNumber, message, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { api, json } from "./api";

type Organization = { id: string; name: string; type: string };
type Project = { id: string; name: string; code: string; responsibleOrganizationId: string };
type Qualification = { id: string; name: string; category?: string; certificateNo?: string; issuingAuthority?: string; issuedAt?: string; expiresAt?: string; scope?: string; organization: Organization };
type MonthlyReport = { id: string; reportMonth: string; status: string; progressSummary: string; onsiteCount: number; safetyHazardCount: number; rectifiedHazardCount: number; safetyInvestment: string; incidentCount: number; project: Project; reportingOrganization: Organization };

const dateText = (value?: string) => value ? value.slice(0, 10) : "长期/未填写";
const expiryTag = (value?: string) => {
  if (!value) return <Tag>长期</Tag>; const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
  return <Tag color={days < 0 ? "red" : days <= 90 ? "orange" : "green"}>{days < 0 ? "已到期" : days <= 90 ? `${days} 天后到期` : "有效"}</Tag>;
};

export function QualificationsPage() {
  const qc = useQueryClient(); const [open, setOpen] = useState(false);
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: () => api<Organization[]>("/api/organizations") });
  const rows = useQuery({ queryKey: ["organization-qualifications"], queryFn: () => api<Qualification[]>("/api/organization-qualifications") });
  const create = useMutation({ mutationFn: (values: Record<string, unknown>) => { const { organizationId, ...body } = values; return api(`/api/organizations/${organizationId}/qualifications`, json("POST", body)); }, onSuccess: () => { message.success("单位资质已保存"); setOpen(false); void qc.invalidateQueries({ queryKey: ["organization-qualifications"] }); }, onError: (error) => message.error(error.message) });
  return <><Space className="page-title"><Typography.Title level={3}>资质证照管理</Typography.Title><Button type="primary" onClick={() => setOpen(true)}>新增单位资质</Button></Space>
    <Card title="单位资质与到期情况"><Table rowKey="id" dataSource={rows.data} pagination={false} columns={[
      { title: "所属组织", render: (_: unknown, row: Qualification) => row.organization.name }, { title: "资质名称", dataIndex: "name" }, { title: "类别", dataIndex: "category", render: (v: string) => v || "—" },
      { title: "证书编号", dataIndex: "certificateNo", render: (v: string) => v || "—" }, { title: "发证机构", dataIndex: "issuingAuthority", render: (v: string) => v || "—" },
      { title: "有效期至", dataIndex: "expiresAt", render: dateText }, { title: "状态", dataIndex: "expiresAt", render: expiryTag },
      { title: "操作", render: (_: unknown, row: Qualification) => <Button danger size="small" onClick={() => Modal.confirm({ title: `停用“${row.name}”？`, content: "历史记录会保留，不会物理删除。", onOk: async () => { await api(`/api/organization-qualifications/${row.id}/retire`, { method: "PATCH" }); void qc.invalidateQueries({ queryKey: ["organization-qualifications"] }); } })}>停用</Button> }
    ]} /></Card>
    <Modal title="新增单位资质" open={open} footer={null} onCancel={() => setOpen(false)} destroyOnClose><Form layout="vertical" onFinish={(values) => create.mutate(values)}>
      <Form.Item name="organizationId" label="所属组织" rules={[{ required: true }]}><Select options={(organizations.data ?? []).map((row) => ({ value: row.id, label: row.name }))} /></Form.Item>
      <Form.Item name="name" label="资质名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="category" label="类别"><Input /></Form.Item>
      <Form.Item name="certificateNo" label="证书编号"><Input /></Form.Item><Form.Item name="issuingAuthority" label="发证机构"><Input /></Form.Item>
      <Form.Item name="issuedAt" label="发证日期"><Input type="date" /></Form.Item><Form.Item name="expiresAt" label="到期日期"><Input type="date" /></Form.Item>
      <Form.Item name="scope" label="许可范围"><Input.TextArea rows={3} /></Form.Item><Button type="primary" htmlType="submit" loading={create.isPending}>保存</Button>
    </Form></Modal></>;
}

export function MonthlyReportsPage() {
  const qc = useQueryClient(); const [open, setOpen] = useState(false); const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const reports = useQuery({ queryKey: ["monthly-reports"], queryFn: () => api<MonthlyReport[]>("/api/monthly-reports") });
  const summary = useQuery({ queryKey: ["monthly-report-summary", month], queryFn: () => api<{ projectCount: number; submittedCount: number; draftCount: number; missingCount: number; projects: Array<{ id: string; name: string; code: string; reportStatus: string; responsibleOrganization: { name: string } }> }>(`/api/monthly-reports/summary?month=${month}`) });
  const projects = useQuery({ queryKey: ["monthly-report-projects"], queryFn: () => api<Project[]>("/api/monthly-reports/projects") });
  const save = useMutation({ mutationFn: (values: Record<string, unknown>) => api("/api/monthly-reports", json("POST", values)), onSuccess: () => { message.success("项目月报已保存"); setOpen(false); void qc.invalidateQueries({ queryKey: ["monthly-reports"] }); }, onError: (error) => message.error(error.message) });
  return <><Space className="page-title"><Typography.Title level={3}>野外项目月报</Typography.Title><Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} style={{ width: 150 }} /><Button href="/api/monthly-reports.csv">导出 CSV</Button><Button type="primary" onClick={() => setOpen(true)}>填报月报</Button></Space>
    <Space wrap style={{ marginBottom: 16 }}><Card size="small">应报项目 <b>{summary.data?.projectCount ?? 0}</b></Card><Card size="small">已提交 <b>{summary.data?.submittedCount ?? 0}</b></Card><Card size="small">草稿 <b>{summary.data?.draftCount ?? 0}</b></Card><Card size="small">未报 <b>{summary.data?.missingCount ?? 0}</b></Card></Space>
    <Card size="small" title={`${month} 报送情况`} style={{ marginBottom: 16 }}><Space wrap>{(summary.data?.projects ?? []).map((row) => <Tag key={row.id} color={row.reportStatus === "submitted" ? "green" : row.reportStatus === "draft" ? "orange" : "red"}>{row.responsibleOrganization.name} · {row.name} · {row.reportStatus === "submitted" ? "已提交" : row.reportStatus === "draft" ? "草稿" : "未报"}</Tag>)}</Space></Card>
    <Table rowKey="id" dataSource={reports.data} pagination={{ pageSize: 20 }} columns={[
      { title: "月份", dataIndex: "reportMonth", render: (v: string) => v.slice(0, 7) }, { title: "项目", render: (_: unknown, row: MonthlyReport) => `${row.project.name}（${row.project.code}）` },
      { title: "报送部门", render: (_: unknown, row: MonthlyReport) => row.reportingOrganization.name }, { title: "现场人数", dataIndex: "onsiteCount" },
      { title: "隐患/已整改", render: (_: unknown, row: MonthlyReport) => `${row.safetyHazardCount}/${row.rectifiedHazardCount}` }, { title: "事故数", dataIndex: "incidentCount" },
      { title: "状态", dataIndex: "status", render: (v: string) => <Tag color={v === "submitted" ? "green" : "default"}>{v === "submitted" ? "已提交" : "草稿"}</Tag> },
      { title: "进展摘要", dataIndex: "progressSummary", ellipsis: true }
    ]} />
    <Modal title="填报野外项目月报" open={open} footer={null} onCancel={() => setOpen(false)} width={680} destroyOnClose><Form layout="vertical" initialValues={{ status: "submitted", onsiteCount: 0, safetyHazardCount: 0, rectifiedHazardCount: 0, safetyInvestment: 0, incidentCount: 0 }} onFinish={(values) => save.mutate(values)}>
      <Form.Item name="projectId" label="项目" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(projects.data ?? []).map((row) => ({ value: row.id, label: `${row.name}（${row.code}）` }))} /></Form.Item>
      <Form.Item name="reportMonth" label="报送月份" rules={[{ required: true }]}><Input type="month" /></Form.Item><Form.Item name="progressSummary" label="本月项目及安全生产进展" rules={[{ required: true, min: 2 }]}><Input.TextArea rows={4} /></Form.Item>
      <Space wrap><Form.Item name="onsiteCount" label="现场人数"><InputNumber min={0} /></Form.Item><Form.Item name="safetyHazardCount" label="发现隐患"><InputNumber min={0} /></Form.Item><Form.Item name="rectifiedHazardCount" label="已整改"><InputNumber min={0} /></Form.Item><Form.Item name="incidentCount" label="事故数"><InputNumber min={0} /></Form.Item><Form.Item name="safetyInvestment" label="安全投入（元）"><InputNumber min={0} /></Form.Item></Space>
      <Form.Item name="notes" label="备注"><Input.TextArea rows={2} /></Form.Item><Form.Item name="status" label="保存方式"><Select options={[{ value: "submitted", label: "正式提交" }, { value: "draft", label: "保存草稿" }]} /></Form.Item>
      <Button type="primary" htmlType="submit" loading={save.isPending}>保存</Button>
    </Form></Modal></>;
}
