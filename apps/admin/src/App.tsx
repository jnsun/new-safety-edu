import { useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App as AntApp, Button, Card, Form, Input, Layout, Menu, message, Modal, Select, Space, Table, Tabs, Tag, Typography, Upload
} from "antd";
import { DashboardOutlined, TeamOutlined, ApartmentOutlined, ReadOutlined, FileDoneOutlined, ScheduleOutlined, LineChartOutlined, SettingOutlined, UploadOutlined } from "@ant-design/icons";
import type { MenuProps, UploadProps } from "antd";
import { api, json } from "./api";
import { CoursewarePage, QuestionsPage, TrainingPage } from "./Day2Pages";
import { DashboardPage, RecordsPage, ReportsPage } from "./Day4Pages";

type Principal = { accountId: string; personId: string | null; roles: Array<{ role: string; scopeType: string; scopeId: string | null }> };
type Organization = { id: string; name: string; type: string; parentId: string | null };
type Project = { id: string; name: string; code: string; status: string; responsibleOrganizationId: string; responsibleOrganization: { name: string }; _count: { members: number } };
type Person = { id: string; name: string; phone: string; type: string; status: string; nationalIdLast4: string; photoFileId: string; organizations: Array<{ organization: { id: string; name: string }; primary: boolean }> };
type Account = { id: string; username: string | null; status: string; personId: string | null; roles: Array<{ id: string; role: string; scopeType: string; scopeId: string | null; active: boolean }> };
type UploadRequestOption = Parameters<NonNullable<UploadProps["customRequest"]>>[0];

const labels: Record<string, string> = { employee: "正式员工", contractor: "外协人员", temporary_individual: "临时个人", active: "启用", disabled: "停用", pending: "待处理" };
const menuItems: NonNullable<MenuProps["items"]> = [
  ["/", "首页", <DashboardOutlined />], ["/people", "人员与账号", <TeamOutlined />], ["/organization", "组织与项目", <ApartmentOutlined />],
  ["/courseware", "课件与模板", <ReadOutlined />], ["/questions", "题库与试卷", <FileDoneOutlined />], ["/training", "培训安排", <ScheduleOutlined />],
  ["/records", "进度与记录", <LineChartOutlined />], ["/reports", "报表与设置", <SettingOutlined />]
].map(([key, label, icon]) => ({ key: key as string, label, icon }));

function Login() {
  const navigate = useNavigate(); const qc = useQueryClient(); const [busy, setBusy] = useState(false);
  async function submit(values: { username: string; password: string }) {
    setBusy(true); try { await api("/api/auth/login", json("POST", values)); qc.setQueryData(["me"], await api<Principal>("/api/auth/me")); navigate("/"); } catch (error) { message.error((error as Error).message); } finally { setBusy(false); }
  }
  return <div className="login-shell"><Card className="login-card"><Typography.Title level={2}>安全培训教育平台</Typography.Title><Typography.Paragraph type="secondary">物化院有限公司 · 管理后台</Typography.Paragraph>
    <Form layout="vertical" onFinish={submit}><Form.Item label="用户名" name="username" rules={[{ required: true }]}><Input autoComplete="username" /></Form.Item>
      <Form.Item label="密码" name="password" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
      <Button block type="primary" htmlType="submit" loading={busy}>登录</Button></Form></Card></div>;
}

function AccountsPanel({ accounts, persons, organizations }: { accounts: Account[]; persons: Person[]; organizations: Organization[] }) {
  const qc = useQueryClient(); const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/api/projects") });
  const [accountOpen, setAccountOpen] = useState(false); const [roleOpen, setRoleOpen] = useState(false); const [roleName, setRoleName] = useState("learner");
  const accountCreate = useMutation({ mutationFn: (v: unknown) => api("/api/accounts", json("POST", v)), onSuccess: () => { setAccountOpen(false); void qc.invalidateQueries({ queryKey: ["accounts"] }); }, onError: (e) => message.error(e.message) });
  const roleCreate = useMutation({ mutationFn: (v: Record<string, unknown>) => api("/api/roles", json("POST", { ...v, role: roleName, scopeType: { company_admin: "company", org_admin: "organization", project_admin: "project", learner: "person" }[roleName], scopeId: roleName === "company_admin" ? null : v.scopeId })), onSuccess: () => { setRoleOpen(false); void qc.invalidateQueries({ queryKey: ["accounts"] }); }, onError: (e) => message.error(e.message) });
  const scopeOptions = roleName === "org_admin" ? organizations.map((o) => ({ value: o.id, label: o.name })) : roleName === "project_admin" ? (projects.data ?? []).map((p) => ({ value: p.id, label: p.name })) : persons.map((p) => ({ value: p.id, label: p.name }));
  return <><Space style={{ marginBottom: 12 }}><Button onClick={() => setAccountOpen(true)}>创建账号</Button><Button type="primary" onClick={() => setRoleOpen(true)}>授予角色</Button></Space>
    <Table rowKey="id" dataSource={accounts} columns={[{ title: "用户名", dataIndex: "username", render: (v: string | null) => v ?? "微信账号" }, { title: "状态", dataIndex: "status" }, { title: "角色", render: (_: unknown, row: Account) => row.roles.filter((r) => r.active).map((r) => <Tag key={r.id} closable onClose={async (event) => { event.preventDefault(); await api(`/api/roles/${r.id}`, { method: "DELETE" }); void qc.invalidateQueries({ queryKey: ["accounts"] }); }}>{r.role}</Tag>) }]} />
    <Modal title="创建管理员/人员账号" open={accountOpen} footer={null} onCancel={() => setAccountOpen(false)}><Form layout="vertical" onFinish={(v) => accountCreate.mutate(v)}><Form.Item name="username" label="用户名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="password" label="初始密码" rules={[{ required: true, min: 12 }]}><Input.Password /></Form.Item><Form.Item name="personId" label="关联人员"><Select allowClear options={persons.map((p) => ({ value: p.id, label: p.name }))} /></Form.Item><Button type="primary" htmlType="submit" loading={accountCreate.isPending}>创建账号</Button></Form></Modal>
    <Modal title="授予角色" open={roleOpen} footer={null} onCancel={() => setRoleOpen(false)}><Form layout="vertical" onFinish={(v) => roleCreate.mutate(v)}><Form.Item name="accountId" label="账号" rules={[{ required: true }]}><Select options={accounts.map((a) => ({ value: a.id, label: a.username ?? `微信账号 ${a.id.slice(0, 8)}` }))} /></Form.Item><Form.Item label="角色" required><Select value={roleName} onChange={setRoleName} options={["company_admin", "org_admin", "project_admin", "learner"].map((value) => ({ value, label: value }))} /></Form.Item>{roleName !== "company_admin" && <Form.Item name="scopeId" label="授权范围" rules={[{ required: true }]}><Select options={scopeOptions} /></Form.Item>}<Button type="primary" htmlType="submit" loading={roleCreate.isPending}>确认授权</Button></Form></Modal></>;
}

function BindingRequests({ persons }: { persons: Person[] }) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const requests = useQuery({ queryKey: ["binding-requests"], queryFn: () => api<Array<{ id: string; type: string; status: string; projectId: string | null; createdAt: string; payload: Record<string, unknown> }>>("/api/binding-requests") });
  async function approve(row: { id: string; type: string }) {
    if (row.type !== "registration" && !selected[row.id]) return message.warning("请选择要绑定的人员档案");
    try { await api(`/api/binding-requests/${row.id}/approve`, json("POST", row.type === "registration" ? {} : { personId: selected[row.id] })); message.success("审核通过"); void requests.refetch(); } catch (error) { message.error((error as Error).message); }
  }
  return <Table rowKey="id" loading={requests.isLoading} dataSource={requests.data} columns={[
    { title: "申请类型", dataIndex: "type", render: (v: string) => v === "registration" ? "新档案注册" : "手机号绑定" },
    { title: "申请人", render: (_: unknown, row) => String(row.payload.name ?? "待匹配人员") },
    { title: "手机号", render: (_: unknown, row) => { const v = String(row.payload.phone ?? ""); return v ? `${v.slice(0, 3)}****${v.slice(-4)}` : "—"; } },
    { title: "操作", render: (_: unknown, row) => <Space>{row.type !== "registration" && <Select style={{ width: 180 }} placeholder="选择档案" options={persons.map((p) => ({ value: p.id, label: p.name }))} onChange={(value) => setSelected((current) => ({ ...current, [row.id]: value }))} />}<Button type="primary" size="small" onClick={() => void approve(row)}>审核通过</Button></Space> }
  ]} />;
}

function People() {
  const query = useQuery({ queryKey: ["persons"], queryFn: () => api<Person[]>("/api/persons") });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/api/accounts") });
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: () => api<Organization[]>("/api/organizations") });
  const qc = useQueryClient(); const [open, setOpen] = useState(false); const [photoId, setPhotoId] = useState<string>(); const [form] = Form.useForm();
  const create = useMutation({ mutationFn: (value: Record<string, unknown>) => api<Person>("/api/persons", json("POST", { ...value, photoFileId: photoId })), onSuccess: () => { message.success("人员已创建"); setOpen(false); form.resetFields(); setPhotoId(undefined); void qc.invalidateQueries({ queryKey: ["persons"] }); }, onError: (e) => message.error(e.message) });
  const uploadPhoto = async ({ file, onSuccess, onError }: UploadRequestOption) => { try { const data = new FormData(); data.append("file", file as Blob); const result = await api<{ id: string }>("/api/files?kind=photo", { method: "POST", body: data }); setPhotoId(result.id); onSuccess?.(result); } catch (error) { onError?.(error as Error); } };
  const importFile = async ({ file, onSuccess, onError }: UploadRequestOption) => { try { const data = new FormData(); data.append("file", file as Blob); const result = await api<{ count: number }>("/api/persons/import", { method: "POST", body: data }); message.success(`成功导入 ${result.count} 人`); void qc.invalidateQueries({ queryKey: ["persons"] }); onSuccess?.(result); } catch (error) { message.error((error as Error).message); onError?.(error as Error); } };
  return <><Space className="page-title"><Typography.Title level={3}>人员与账号</Typography.Title><Button type="primary" onClick={() => setOpen(true)}>新建人员</Button><Upload accept=".csv,.xlsx" showUploadList={false} customRequest={importFile}><Button icon={<UploadOutlined />}>导入 CSV/XLSX</Button></Upload></Space>
    <Tabs items={[{ key: "persons", label: "人员档案", children: <Table rowKey="id" loading={query.isLoading} dataSource={query.data} columns={[
      { title: "姓名", dataIndex: "name" }, { title: "类型", dataIndex: "type", render: (v: string) => labels[v] ?? v }, { title: "手机号", dataIndex: "phone", render: (v: string) => `${v.slice(0, 3)}****${v.slice(-4)}` },
      { title: "身份证", dataIndex: "nationalIdLast4", render: (v: string) => `**************${v}` }, { title: "所属组织", render: (_: unknown, row: Person) => row.organizations.map((x) => x.organization.name).join("、") }, { title: "状态", dataIndex: "status", render: (v: string) => <Tag color={v === "active" ? "green" : "default"}>{labels[v] ?? v}</Tag> }
    ]} /> }, { key: "accounts", label: "账号与权限", children: <AccountsPanel accounts={accounts.data ?? []} persons={query.data ?? []} organizations={organizations.data ?? []} /> }, { key: "binding", label: "绑定与注册审核", children: <BindingRequests persons={query.data ?? []} /> }]} />
    <Modal title="新建人员" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={create.isPending}><Form form={form} layout="vertical" onFinish={(value) => create.mutate(value as Record<string, unknown>)}>
      <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="phone" label="手机号" rules={[{ required: true, pattern: /^1\d{10}$/ }]}><Input /></Form.Item>
      <Form.Item name="type" label="人员类型" rules={[{ required: true }]}><Select options={[{ value: "employee", label: "正式员工" }, { value: "contractor", label: "外协人员" }, { value: "temporary_individual", label: "临时个人" }]} /></Form.Item>
      <Form.Item name="organizationId" label="所属组织/责任部门" rules={[{ required: true }]}><Select options={(organizations.data ?? []).map((o) => ({ value: o.id, label: o.name }))} /></Form.Item>
      <Form.Item name="nationalId" label="身份证号码" rules={[{ required: true }]}><Input.Password autoComplete="off" /></Form.Item>
      <Form.Item label="个人照片" required><Upload accept="image/png,image/jpeg" maxCount={1} customRequest={uploadPhoto}><Button icon={<UploadOutlined />}>上传私有照片</Button></Upload></Form.Item>
    </Form></Modal></>;
}

function OrganizationProjects() {
  const qc = useQueryClient(); const organizations = useQuery({ queryKey: ["organizations"], queryFn: () => api<Organization[]>("/api/organizations") });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/api/projects") });
  const people = useQuery({ queryKey: ["persons"], queryFn: () => api<Person[]>("/api/persons") });
  const [orgOpen, setOrgOpen] = useState(false); const [projectOpen, setProjectOpen] = useState(false); const [memberProject, setMemberProject] = useState<Project>();
  const members = useQuery({ queryKey: ["project-members", memberProject?.id], queryFn: () => api<Array<{ id: string; status: string; person: Person }>>(`/api/projects/${memberProject!.id}/members`), enabled: !!memberProject });
  const orgCreate = useMutation({ mutationFn: (v: unknown) => api("/api/organizations", json("POST", v)), onSuccess: () => { setOrgOpen(false); void qc.invalidateQueries({ queryKey: ["organizations"] }); }, onError: (e) => message.error(e.message) });
  const projectCreate = useMutation({ mutationFn: (v: unknown) => api("/api/projects", json("POST", v)), onSuccess: () => { setProjectOpen(false); void qc.invalidateQueries({ queryKey: ["projects"] }); }, onError: (e) => message.error(e.message) });
  return <><Space className="page-title"><Typography.Title level={3}>组织与项目</Typography.Title><Button onClick={() => setOrgOpen(true)}>新建组织</Button><Button type="primary" onClick={() => setProjectOpen(true)}>新建项目</Button></Space>
    <Tabs items={[{ key: "org", label: "组织", children: <Table rowKey="id" dataSource={organizations.data} columns={[{ title: "名称", dataIndex: "name" }, { title: "类型", dataIndex: "type" }, { title: "上级 ID", dataIndex: "parentId", render: (v: string | null) => v ?? "—" }]} /> },
      { key: "projects", label: "项目", children: <Table rowKey="id" dataSource={projects.data} columns={[{ title: "项目名称", dataIndex: "name" }, { title: "编号", dataIndex: "code" }, { title: "责任实体", render: (_: unknown, row: Project) => row.responsibleOrganization.name }, { title: "成员数", render: (_: unknown, row: Project) => row._count.members }, { title: "状态", dataIndex: "status" }, { title: "操作", render: (_: unknown, row: Project) => <Space><Button size="small" onClick={() => setMemberProject(row)}>管理成员</Button>{row.status !== "ended" && <Button size="small" onClick={async () => { await api(`/api/projects/${row.id}/status`, json("PATCH", { status: row.status === "active" ? "paused" : "active" })); void projects.refetch(); }}>{row.status === "active" ? "暂停" : "恢复"}</Button>}{row.status !== "ended" && <Button danger size="small" onClick={async () => { await api(`/api/projects/${row.id}/status`, json("PATCH", { status: "ended" })); void projects.refetch(); }}>结束</Button>}</Space> }]} /> }]} />
    <Modal title="新建组织" open={orgOpen} footer={null} onCancel={() => setOrgOpen(false)}><Form layout="vertical" onFinish={(v) => orgCreate.mutate(v)}><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="type" label="类型" rules={[{ required: true }]}><Select options={["company", "business_entity", "department", "contractor"].map((v) => ({ value: v, label: v }))} /></Form.Item><Form.Item name="parentId" label="上级组织"><Select allowClear options={(organizations.data ?? []).map((o) => ({ value: o.id, label: o.name }))} /></Form.Item><Button type="primary" htmlType="submit" loading={orgCreate.isPending}>创建</Button></Form></Modal>
    <Modal title="新建项目" open={projectOpen} footer={null} onCancel={() => setProjectOpen(false)}><Form layout="vertical" onFinish={(v) => projectCreate.mutate(v)}><Form.Item name="name" label="项目名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="code" label="项目编号" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="responsibleOrganizationId" label="管理责任实体" rules={[{ required: true }]}><Select options={(organizations.data ?? []).map((o) => ({ value: o.id, label: o.name }))} /></Form.Item><Button type="primary" htmlType="submit" loading={projectCreate.isPending}>创建</Button></Form></Modal>
    <Modal title={`${memberProject?.name ?? "项目"} · 成员`} open={!!memberProject} footer={null} onCancel={() => setMemberProject(undefined)}><Form layout="inline" onFinish={async (v) => { await api(`/api/projects/${memberProject!.id}/members`, json("POST", v)); void members.refetch(); void qc.invalidateQueries({ queryKey: ["projects"] }); }}><Form.Item name="personId" rules={[{ required: true }]}><Select style={{ width: 220 }} placeholder="选择人员" options={(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))} /></Form.Item><Button type="primary" htmlType="submit">加入项目</Button></Form><Table style={{ marginTop: 16 }} rowKey="id" pagination={false} dataSource={members.data} columns={[{ title: "姓名", render: (_: unknown, row: { id: string; status: string; person: Person }) => row.person.name }, { title: "状态", dataIndex: "status" }, { title: "审核", render: (_: unknown, row: { id: string; status: string; person: Person }) => row.status === "pending" ? <Space><Button type="primary" size="small" onClick={async () => { await api(`/api/project-members/${row.id}/review`, json("PATCH", { status: "active" })); void members.refetch(); }}>通过</Button><Button danger size="small" onClick={async () => { await api(`/api/project-members/${row.id}/review`, json("PATCH", { status: "rejected", note: "不符合当前项目关系" })); void members.refetch(); }}>驳回</Button></Space> : null }]} /></Modal></>;
}

function Shell({ principal }: { principal: Principal }) {
  const navigate = useNavigate(); const location = useLocation();
  const selected = useMemo(() => location.pathname === "/" ? "/" : `/${location.pathname.split("/")[1]}`, [location.pathname]);
  return <Layout className="app-shell"><Layout.Sider breakpoint="lg" collapsedWidth="0" theme="light"><div className="brand">物化院<br /><small>安全培训教育平台</small></div><Menu mode="inline" selectedKeys={[selected]} items={menuItems} onClick={({ key }) => navigate(key)} /></Layout.Sider>
    <Layout><Layout.Header className="topbar"><span>V0.1 管理后台</span><Space><Tag color="blue">{principal.roles.map((r) => r.role).join(" / ") || "无角色"}</Tag><Button onClick={async () => { await api("/api/auth/logout", { method: "POST" }); navigate("/login"); }}>退出</Button></Space></Layout.Header>
      <Layout.Content className="content"><Routes><Route path="/" element={<DashboardPage />} /><Route path="/people" element={<People />} /><Route path="/organization" element={<OrganizationProjects />} /><Route path="/courseware" element={<CoursewarePage />} /><Route path="/questions" element={<QuestionsPage />} /><Route path="/training" element={<TrainingPage />} /><Route path="/records" element={<RecordsPage />} /><Route path="/reports" element={<ReportsPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Layout.Content></Layout></Layout>;
}

export default function App() {
  const location = useLocation(); const principal = useQuery({ queryKey: ["me"], queryFn: () => api<Principal>("/api/auth/me"), retry: false });
  if (location.pathname === "/login") return <Login />;
  if (principal.isLoading) return <div className="center">正在加载…</div>;
  if (principal.isError) return <Navigate to="/login" replace />;
  return <AntApp><Shell principal={principal.data!} /></AntApp>;
}
