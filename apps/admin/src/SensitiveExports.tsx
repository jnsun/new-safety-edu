import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Checkbox, Form, Select, Space, Table, Tag, Typography, message } from "antd";
import { DownloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { api, json } from "./api";

type Principal = { roles: Array<{ role: string; scopeType: string; scopeId: string | null }> };
type Organization = { id: string; name: string; type: string };
type Project = { id: string; name: string; responsibleOrganizationId: string };
type ScopeType = "company" | "organization" | "project";
type ExportJob = {
  id: string;
  scopeType: ScopeType;
  scopeId: string | null;
  scopeSnapshot: { name?: string };
  categories: string[];
  status: "pending" | "processing" | "ready" | "failed" | "downloaded" | "expired";
  size: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
};

const categoryOptions = [
  { value: "photos", label: "人员照片" },
  { value: "signatures", label: "手写签字" },
  { value: "certificates", label: "证照及附件" },
  { value: "training_attachments", label: "培训、考试和审批附件" },
  { value: "audit", label: "内部审计详情" },
];
const statusLabels: Record<string, string> = { pending: "等待生成", processing: "正在生成", ready: "可下载", failed: "生成失败", downloaded: "已下载", expired: "已过期" };

export function SensitiveExports({ principal, organizations, projects }: { principal: Principal; organizations: Organization[]; projects: Project[] }) {
  const [form] = Form.useForm();
  const [scopeType, setScopeType] = useState<ScopeType>(principal.roles.some((role) => role.role === "company_admin") ? "company" : principal.roles.some((role) => ["org_leader", "org_admin"].includes(role.role)) ? "organization" : "project");
  const qc = useQueryClient();
  const companyAdmin = principal.roles.some((role) => role.role === "company_admin");
  const organizationIds = useMemo(() => new Set(principal.roles.filter((role) => ["org_leader", "org_admin"].includes(role.role) && role.scopeType === "organization" && role.scopeId).map((role) => role.scopeId!)), [principal.roles]);
  const projectIds = useMemo(() => new Set(principal.roles.filter((role) => role.role === "project_admin" && role.scopeType === "project" && role.scopeId).map((role) => role.scopeId!)), [principal.roles]);
  const allowedOrganizations = companyAdmin ? organizations.filter((row) => ["department", "business_entity"].includes(row.type)) : organizations.filter((row) => organizationIds.has(row.id));
  const allowedProjects = companyAdmin ? projects : projects.filter((row) => projectIds.has(row.id) || organizationIds.has(row.responsibleOrganizationId));
  const jobs = useQuery({
    queryKey: ["sensitive-exports"],
    queryFn: () => api<ExportJob[]>("/api/sensitive-exports"),
    refetchInterval: (query) => query.state.data?.some((row) => ["pending", "processing"].includes(row.status)) ? 2000 : false,
  });
  const create = useMutation({
    mutationFn: (value: { scopeType: ScopeType; scopeId?: string; categories: string[]; confirmed: boolean }) => api("/api/sensitive-exports", json("POST", { ...value, scopeId: value.scopeType === "company" ? null : value.scopeId })),
    onSuccess: () => { message.success("导出任务已创建，请稍候"); form.resetFields(["confirmed"]); void qc.invalidateQueries({ queryKey: ["sensitive-exports"] }); },
    onError: (error) => message.error(error.message),
  });
  async function download(job: ExportJob) {
    try {
      const issued = await api<{ token: string }>(`/api/sensitive-exports/${job.id}/token`, json("POST", {}));
      const response = await fetch(`/api/sensitive-exports/${job.id}/download`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: issued.token }) });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "下载失败");
      }
      const href = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `敏感资料-${job.scopeSnapshot.name ?? job.id.slice(0, 8)}.zip`;
      anchor.click();
      URL.revokeObjectURL(href);
      message.success("导出文件已下载；该文件仅允许下载一次");
      void qc.invalidateQueries({ queryKey: ["sensitive-exports"] });
    } catch (error) { message.error((error as Error).message); }
  }
  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <Alert type="warning" showIcon message="敏感资料导出" description="导出文件包含未脱敏个人资料和私有附件。系统会记录导出人、范围和结果；文件生成后 10 分钟失效，且只能下载一次。" />
    <Card title={<Space><SafetyCertificateOutlined />创建导出任务</Space>}>
      <Form form={form} layout="vertical" initialValues={{ scopeType, categories: categoryOptions.map((item) => item.value), confirmed: false }} onFinish={(value) => create.mutate(value)}>
        <Form.Item name="scopeType" label="导出范围" rules={[{ required: true }]}>
          <Select onChange={(value: ScopeType) => { setScopeType(value); form.setFieldValue("scopeId", undefined); }} options={[...(companyAdmin ? [{ value: "company", label: "全公司" }] : []), ...(allowedOrganizations.length ? [{ value: "organization", label: "经营实体或部门" }] : []), ...(allowedProjects.length ? [{ value: "project", label: "项目" }] : [])]} />
        </Form.Item>
        {scopeType === "organization" && <Form.Item name="scopeId" label="组织" rules={[{ required: true, message: "请选择组织" }]}><Select showSearch optionFilterProp="label" options={allowedOrganizations.map((row) => ({ value: row.id, label: row.name }))} /></Form.Item>}
        {scopeType === "project" && <Form.Item name="scopeId" label="项目" rules={[{ required: true, message: "请选择项目" }]}><Select showSearch optionFilterProp="label" options={allowedProjects.map((row) => ({ value: row.id, label: row.name }))} /></Form.Item>}
        <Form.Item name="categories" label="资料内容" rules={[{ required: true, type: "array", min: 1, message: "至少选择一类资料" }]}><Select mode="multiple" options={categoryOptions} /></Form.Item>
        <Form.Item name="confirmed" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请确认导出风险")) }]}><Checkbox>我确认该文件包含敏感资料，并将按授权范围妥善保管</Checkbox></Form.Item>
        <Button type="primary" htmlType="submit" loading={create.isPending}>生成敏感资料文件</Button>
      </Form>
    </Card>
    <Card title="我的导出记录">
      <Table rowKey="id" loading={jobs.isLoading} pagination={false} dataSource={jobs.data ?? []} columns={[
        { title: "范围", render: (_: unknown, row: ExportJob) => row.scopeSnapshot.name ?? row.scopeId ?? "全公司" },
        { title: "内容", dataIndex: "categories", render: (values: string[]) => values.map((value) => categoryOptions.find((item) => item.value === value)?.label ?? value).join("、") },
        { title: "创建时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString("zh-CN") },
        { title: "状态", render: (_: unknown, row: ExportJob) => <Space><Tag color={row.status === "ready" ? "green" : row.status === "failed" ? "red" : "default"}>{statusLabels[row.status]}</Tag>{row.size ? <Typography.Text type="secondary">{(row.size / 1024 / 1024).toFixed(2)} MB</Typography.Text> : null}</Space> },
        { title: "结果", render: (_: unknown, row: ExportJob) => row.status === "ready" ? <Button icon={<DownloadOutlined />} onClick={() => void download(row)}>下载一次</Button> : row.error ? <Typography.Text type="danger">{row.error}</Typography.Text> : "—" },
      ]} />
    </Card>
  </Space>;
}
