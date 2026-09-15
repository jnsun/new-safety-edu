import { useMemo, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  Layout,
  Menu,
  message,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import {
  DashboardOutlined,
  TeamOutlined,
  ApartmentOutlined,
  ReadOutlined,
  FileDoneOutlined,
  ScheduleOutlined,
  LineChartOutlined,
  SettingOutlined,
  UploadOutlined,
  SafetyCertificateOutlined,
  CalendarOutlined,
  WechatOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { MenuProps, UploadProps } from "antd";
import { api, json } from "./api";
import { CoursewarePage, QuestionsPage, TrainingPage } from "./Day2Pages";
import { DashboardPage, RecordsPage, ReportsPage } from "./Day4Pages";
import { PersonImport } from "./PersonImport";
import { SensitiveExports } from "./SensitiveExports";
import {
  MonthlyReportsPage,
  QualificationsPage,
} from "./SafetyManagementPages";

type Principal = {
  accountId: string;
  personId: string | null;
  mustChangePassword: boolean;
  roles: Array<{ role: string; scopeType: string; scopeId: string | null }>;
};
type OrganizationRolePerson = {
  roleId: string | null;
  personId: string;
  name: string;
  inherited?: boolean;
  activationPending?: boolean;
};
type Organization = {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  memberCount: number;
  leaders: OrganizationRolePerson[];
  admins: OrganizationRolePerson[];
  reporters: OrganizationRolePerson[];
};
type Project = {
  id: string;
  name: string;
  code: string;
  status: string;
  projectType?: string | null;
  location?: string | null;
  contractAmount?: string | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  managerName?: string | null;
  managerPhone?: string | null;
  responsibleOrganizationId: string;
  responsibleOrganization: { id?: string; name: string };
  _count: { members: number };
};
type Person = {
  id: string;
  name: string;
  phone: string;
  type: string;
  status: string;
  nationalIdLast4: string | null;
  photoFileId: string | null;
  organizations: Array<{
    organization: { id: string; name: string; type: string };
    primary: boolean;
  }>;
  account: {
    id: string;
    username: string | null;
    status: string;
  } | null;
  roleAssignments: Array<{
    id: string;
    role: string;
    scopeType: string;
    scopeId: string | null;
    active: boolean;
    activationPending: boolean;
  }>;
};
type Account = {
  id: string;
  username: string | null;
  status: string;
  personId: string | null;
  verifiedPhoneMasked: string | null;
  passwordLoginEnabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  availableActions: string[];
  profileCompleteness: { complete: boolean; missing: string[] } | null;
  loginMethods: { password: boolean; phone: boolean; wechat: boolean };
  person: {
    name: string;
    status: string;
    organizations: Array<{ organization: { id: string; name: string } }>;
  } | null;
  roles: Array<{
    id: string;
    role: string;
    scopeType: string;
    scopeId: string | null;
    active: boolean;
  }>;
};
type UploadRequestOption = Parameters<
  NonNullable<UploadProps["customRequest"]>
>[0];

const labels: Record<string, string> = {
  employee: "正式员工",
  contractor: "外协人员",
  temporary_individual: "临时个人",
  active: "启用",
  disabled: "停用",
  merged: "已合并",
  paused: "已暂停",
  ended: "已结束",
  pending: "待处理",
  rejected: "已驳回",
  duplicate: "重复申请",
  cancelled: "已取消",
  company: "公司",
  business_entity: "经营实体",
  department: "部门",
  company_admin: "公司管理员",
  org_leader: "组织负责人",
  org_admin: "组织管理员",
  field_reporter: "野外项目报送人员",
  project_admin: "项目管理员",
  learner: "普通人员",
};
const organizationTypeLabels: Record<string, string> = {
  company: "公司",
  business_entity: "经营实体",
  department: "部门",
  contractor: "外协单位",
};
const trainingMenuItems: NonNullable<MenuProps["items"]> = [
  ["/", "返回平台首页", <DashboardOutlined />],
  ["/training-dashboard", "培训教育首页", <DashboardOutlined />],
  ["/people", "人员与账号", <TeamOutlined />],
  ["/organization", "组织与项目", <ApartmentOutlined />],
  ["/courseware", "课件与模板", <ReadOutlined />],
  ["/questions", "题库与试卷", <FileDoneOutlined />],
  ["/training", "培训安排", <ScheduleOutlined />],
  ["/records", "进度与记录", <LineChartOutlined />],
  ["/reports", "报表与设置", <SettingOutlined />],
].map(([key, label, icon]) => ({ key: key as string, label, icon }));

const moduleMenuItems = (pathname: string): NonNullable<MenuProps["items"]> =>
  pathname === "/"
    ? [{ key: "/", label: "首页", icon: <DashboardOutlined /> }]
    : pathname.startsWith("/monthly-reports")
      ? [
          { key: "/", label: "返回平台首页", icon: <DashboardOutlined /> },
          {
            key: "/monthly-reports",
            label: "野外项目报送",
            icon: <CalendarOutlined />,
          },
        ]
      : pathname.startsWith("/qualifications")
        ? [
            { key: "/", label: "返回平台首页", icon: <DashboardOutlined /> },
            {
              key: "/qualifications",
              label: "资质证照管理",
              icon: <SafetyCertificateOutlined />,
            },
          ]
        : trainingMenuItems;

function Login() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryPhone, setRecoveryPhone] = useState("");
  const wechat = useQuery({
    queryKey: ["wechat-web-config"],
    queryFn: () => api<{ enabled: boolean }>("/api/auth/wechat-web/config"),
    retry: false,
  });
  async function submit(values: { username: string; password: string }) {
    setBusy(true);
    try {
      await api("/api/auth/login", json("POST", values));
      qc.setQueryData(["me"], await api<Principal>("/api/auth/me"));
      navigate("/");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-shell">
      <section className="login-intro">
        <div className="login-mark">安</div>
        <span className="login-eyebrow">物化院有限公司</span>
        <h1>
          让每一次培训，
          <br className="desktop-break" />
          <span className="headline-nowrap">清楚、可信、可追溯。</span>
        </h1>
        <p>
          从人员、课件和考试，到本人签字与项目确认，在一个简洁的工作台完成安全培训闭环。
        </p>
      </section>
      <Card className="login-card">
        <Typography.Title level={2}>欢迎回来</Typography.Title>
        <Typography.Paragraph type="secondary">
          登录安全培训教育平台管理后台
        </Typography.Paragraph>
        <Form layout="vertical" onFinish={submit}>
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true }]}
          >
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button block type="primary" htmlType="submit" loading={busy}>
            登录
          </Button>
          <Button block type="link" onClick={() => setRecoveryOpen(true)}>忘记密码</Button>
        </Form>
        {wechat.data?.enabled && (
          <>
            <div
              style={{
                textAlign: "center",
                margin: "18px 0",
                color: "#86868b",
              }}
            >
              或
            </div>
            <Button
              block
              icon={<WechatOutlined />}
              href="/api/auth/wechat-web/start"
            >
              微信扫码登录
            </Button>
          </>
        )}
      </Card>
      <Modal title="通过已验证手机号找回密码" open={recoveryOpen} footer={null} onCancel={() => setRecoveryOpen(false)}>
        <Alert type="info" showIcon message="验证码五分钟有效。未配置正式短信服务时，本功能不会发送模拟验证码。" style={{ marginBottom: 16 }} />
        <Form layout="vertical" onFinish={async (values) => { try { await api("/api/auth/password-recovery/confirm", json("POST", values)); message.success("密码已更新，请使用新密码登录"); setRecoveryOpen(false); } catch (error) { message.error((error as Error).message); } }}>
          <Form.Item name="phone" label="已验证手机号" rules={[{ required: true, pattern: /^1\d{10}$/ }]}><Input onChange={(event) => setRecoveryPhone(event.target.value)} /></Form.Item>
          <Button style={{ marginBottom: 16 }} onClick={async () => { try { await api("/api/auth/password-recovery/code", json("POST", { phone: recoveryPhone })); message.success("如该号码可用，验证码已发送"); } catch (error) { message.error((error as Error).message); } }}>发送验证码</Button>
          <Form.Item name="code" label="短信验证码" rules={[{ required: true, len: 6 }]}><Input inputMode="numeric" /></Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 12, max: 128 }]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Button type="primary" htmlType="submit">确认重置</Button>
        </Form>
      </Modal>
    </div>
  );
}

function AccountsPanel({
  accounts,
  persons,
  organizations,
  principal,
}: {
  accounts: Account[];
  persons: Person[];
  organizations: Organization[];
  principal: Principal;
}) {
  const qc = useQueryClient();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/api/projects"),
  });
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountOrgId, setAccountOrgId] = useState<string>();
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleName, setRoleName] = useState("company_admin");
  const [revokeRole, setRevokeRole] = useState<{ id: string; label: string; role: string }>();
  const [resetAccount, setResetAccount] = useState<Account>();
  const [editAccount, setEditAccount] = useState<Account>();
  const [statusAccount, setStatusAccount] = useState<{ account: Account; nextStatus: "active" | "disabled" }>();
  const [deleteAccount, setDeleteAccount] = useState<Account>();
  const [methodAccount, setMethodAccount] = useState<Account>();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [personMergeOpen, setPersonMergeOpen] = useState(false);
  const accountCreate = useMutation({
    mutationFn: (v: Record<string, unknown>) => {
      const { organizationId: _, ...input } = v;
      return api(companyAdmin ? "/api/accounts" : "/api/account-opening-requests", json("POST", input));
    },
    onSuccess: () => {
      setAccountOpen(false);
      setAccountOrgId(undefined);
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e) => message.error(e.message),
  });
  const roleCreate = useMutation({
    mutationFn: async (v: Record<string, unknown>) => {
      const { currentPassword, ...body } = v;
      const sensitive = roleName === "company_admin"
        ? await api<{ token: string }>("/api/auth/reauthenticate", json("POST", { password: currentPassword }))
        : null;
      return api(
        "/api/roles",
        { ...json("POST", {
          ...body,
          role: roleName,
          scopeType: {
            company_admin: "company",
            org_leader: "organization",
            org_admin: "organization",
            field_reporter: "organization",
            project_admin: "project",
          }[roleName],
          scopeId: roleName === "company_admin" ? null : v.scopeId,
        }), ...(sensitive ? { headers: { "x-sensitive-token": sensitive.token } } : {}) },
      );
    },
    onSuccess: () => {
      setRoleOpen(false);
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["persons"] });
      void qc.invalidateQueries({ queryKey: ["organizations"] });
    },
    onError: (e) => message.error(e.message),
  });
  const passwordReset = useMutation({
    mutationFn: ({ accountId, newPassword }: { accountId: string; newPassword: string }) =>
      api(`/api/accounts/${accountId}/reset-password`, json("POST", { newPassword })),
    onSuccess: () => {
      message.success("密码已重置，该账号现有会话已失效");
      setResetAccount(undefined);
    },
    onError: (e) => message.error(e.message),
  });
  const usernameUpdate = useMutation({
    mutationFn: ({ accountId, username, reason }: { accountId: string; username: string; reason: string }) => api(`/api/accounts/${accountId}/username`, json("PATCH", { username, reason })),
    onSuccess: (_data, variables) => {
      message.success("用户名已修改，原登录会话已失效");
      setEditAccount(undefined);
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      if (variables.accountId === principal.accountId) window.location.assign("/login");
    },
    onError: (e) => message.error(e.message),
  });
  const accountStatusUpdate = useMutation({
    mutationFn: ({ accountId, status, reason }: { accountId: string; status: "active" | "disabled"; reason: string }) => api(`/api/accounts/${accountId}/status`, json("POST", { status, reason })),
    onSuccess: (_data, variables) => {
      message.success(variables.status === "active" ? "账号已启用" : "账号已停用，现有会话已失效");
      setStatusAccount(undefined);
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e) => message.error(e.message),
  });
  const accountDelete = useMutation({
    mutationFn: ({ accountId, reason }: { accountId: string; reason: string }) => api(`/api/accounts/${accountId}`, json("DELETE", { reason })),
    onSuccess: () => {
      message.success("误建空账号已删除");
      setDeleteAccount(undefined);
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e) => message.error(e.message),
  });
  const mergeRequestCreate = useMutation({
    mutationFn: async (values: { sourceAccountId: string; targetAccountId: string; reason: string; currentPassword: string }) => {
      const sensitive = await api<{ token: string }>("/api/auth/reauthenticate", json("POST", { password: values.currentPassword }));
      return api<{ id: string; status: string }>("/api/account-merge-requests", { ...json("POST", { sourceAccountId: values.sourceAccountId, targetAccountId: values.targetAccountId, reason: values.reason }), headers: { "x-sensitive-token": sensitive.token } });
    },
    onSuccess: () => {
      message.success("账号合并申请已生成，请在绑定与注册审核中确认");
      setMergeOpen(false);
      void qc.invalidateQueries({ queryKey: ["binding-requests"] });
    },
    onError: (e) => message.error(e.message),
  });
  const personMergeRequestCreate = useMutation({
    mutationFn: async (values: { sourcePersonId: string; targetPersonId: string; reason: string; currentPassword: string }) => {
      const sensitive = await api<{ token: string }>("/api/auth/reauthenticate", json("POST", { password: values.currentPassword }));
      return api<{ id: string; status: string }>("/api/person-merge-requests", { ...json("POST", { sourcePersonId: values.sourcePersonId, targetPersonId: values.targetPersonId, reason: values.reason }), headers: { "x-sensitive-token": sensitive.token } });
    },
    onSuccess: () => {
      message.success("人员档案合并申请已生成，请在绑定与注册审核中确认");
      setPersonMergeOpen(false);
      void qc.invalidateQueries({ queryKey: ["binding-requests"] });
    },
    onError: (e) => message.error(e.message),
  });
  const roleRevoke = useMutation({
    mutationFn: async ({ roleId, role, reason, currentPassword }: { roleId: string; role: string; reason: string; currentPassword?: string }) => {
      const sensitive = role === "company_admin"
        ? await api<{ token: string }>("/api/auth/reauthenticate", json("POST", { password: currentPassword }))
        : null;
      return api(`/api/roles/${roleId}`, { ...json("DELETE", { reason }), ...(sensitive ? { headers: { "x-sensitive-token": sensitive.token } } : {}) });
    },
    onSuccess: () => {
      message.success("角色已撤销，相关账号会话已失效");
      setRevokeRole(undefined);
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["persons"] });
      void qc.invalidateQueries({ queryKey: ["organizations"] });
    },
    onError: (e) => message.error(e.message),
  });
  async function removeLoginMethod(method: "password" | "phone" | "wechat") {
    if (!methodAccount) return;
    const password = window.prompt("请输入当前管理员密码再次验证");
    if (!password) return;
    const reason = window.prompt("请输入解除该登录方式的原因");
    if (!reason?.trim()) return;
    try {
      const sensitive = await api<{ token: string }>("/api/auth/reauthenticate", json("POST", { password }));
      await api(`/api/accounts/${methodAccount.id}/login-methods/${method}`, { ...json("DELETE", { reason }), headers: { "x-sensitive-token": sensitive.token } });
      message.success("登录方式已解除，相关账号会话已失效");
      setMethodAccount(undefined);
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      if (methodAccount.id === principal.accountId) window.location.assign("/login");
    } catch (error) { message.error((error as Error).message); }
  }
  const companyAdmin = principal.roles.some(
    (role) => role.role === "company_admin",
  );
  const managedBusinessEntityIds = new Set(principal.roles.filter((role) => ["org_leader", "org_admin"].includes(role.role) && role.scopeType === "organization" && role.scopeId && organizations.some((organization) => organization.id === role.scopeId && organization.type === "business_entity")).map((role) => role.scopeId));
  const availableRoles = companyAdmin
    ? ["company_admin", "org_leader", "org_admin", "field_reporter", "project_admin"]
    : [...new Set([
        ...(principal.roles.some((role) => role.role === "org_leader") ? ["org_admin"] : []),
        ...(managedBusinessEntityIds.size ? ["field_reporter", "project_admin"] : []),
      ])];
  const scopeOptions =
    roleName === "project_admin"
      ? (projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))
      : organizations.filter((organization) => ["department", "business_entity"].includes(organization.type) && (roleName !== "field_reporter" || organization.type === "business_entity")).map((organization) => ({ value: organization.id, label: organization.name }));
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={() => setAccountOpen(true)}>{companyAdmin ? "创建账号" : "发起账号开通"}</Button>
        {companyAdmin && <Button onClick={() => setMergeOpen(true)}>账号合并</Button>}
        {companyAdmin && <Button onClick={() => setPersonMergeOpen(true)}>人员档案合并</Button>}
        {availableRoles.length > 0 && (
          <Button
            type="primary"
            onClick={() => {
              setRoleName(availableRoles[0]!);
              setRoleOpen(true);
            }}
          >
            授予角色
          </Button>
        )}
      </Space>
      <Table
        rowKey="id"
        dataSource={accounts}
        columns={[
          {
            title: "关联人员",
            render: (_: unknown, row: Account) => row.person ? (
              <Space direction="vertical" size={0}>
                <span>{row.person.name}</span>
                <Typography.Text type="secondary">{row.person.organizations[0]?.organization.name ?? "未设置主部门"}</Typography.Text>
              </Space>
            ) : "未关联",
          },
          {
            title: "用户名",
            dataIndex: "username",
            render: (v: string | null) => v ?? "微信账号",
          },
          {
            title: "状态",
            dataIndex: "status",
            render: (v: string) => labels[v] ?? v,
          },
          { title: "资料", render: (_: unknown, row: Account) => row.profileCompleteness ? <Tag color={row.profileCompleteness.complete ? "green" : "orange"}>{row.profileCompleteness.complete ? "完整" : `待补：${row.profileCompleteness.missing.join("、")}`}</Tag> : "未关联" },
          { title: "登录记录", render: (_: unknown, row: Account) => <Space direction="vertical" size={0}><Typography.Text>{row.lastLoginAt ? `最近 ${new Date(row.lastLoginAt).toLocaleString()}` : "尚未登录"}</Typography.Text><Typography.Text type="secondary">创建 {new Date(row.createdAt).toLocaleDateString()}</Typography.Text></Space> },
          {
            title: "登录方式",
            render: (_: unknown, row: Account) => (
              <Space size={4} wrap>
                {row.loginMethods.password && <Tag>密码</Tag>}
                {row.loginMethods.phone && <Tag>手机 {row.verifiedPhoneMasked}</Tag>}
                {row.loginMethods.wechat && <Tag color="green">微信</Tag>}
                {!Object.values(row.loginMethods).some(Boolean) && <Typography.Text type="secondary">未开通</Typography.Text>}
              </Space>
            ),
          },
          {
            title: "角色",
            render: (_: unknown, row: Account) =>
              row.roles
                .filter((r) => r.active)
                .map((r) => (
                  <Tag
                    key={r.id}
                    closable
                    onClose={(event) => {
                      event.preventDefault();
                      setRevokeRole({ id: r.id, label: labels[r.role] ?? r.role, role: r.role });
                    }}
                  >
                    {labels[r.role] ?? r.role}
                  </Tag>
                )),
          },
          ...(companyAdmin
            ? [{
                title: "操作",
                render: (_: unknown, row: Account) => (
                  <Space size={0} wrap>
                    {row.availableActions.includes("edit_username") && <Button type="link" onClick={() => setEditAccount(row)}>修改用户名</Button>}
                    {row.availableActions.includes("reset_password") && <Button type="link" onClick={() => setResetAccount(row)}>重置密码</Button>}
                    {row.availableActions.includes("manage_login_methods") && <Button type="link" onClick={() => setMethodAccount(row)}>登录方式</Button>}
                    {row.availableActions.includes("disable") && <Button danger type="link" onClick={() => setStatusAccount({ account: row, nextStatus: "disabled" })}>停用</Button>}
                    {row.availableActions.includes("enable") && <Button type="link" onClick={() => setStatusAccount({ account: row, nextStatus: "active" })}>启用</Button>}
                    {row.availableActions.includes("delete_empty") && <Button danger type="link" onClick={() => setDeleteAccount(row)}>删除误建账号</Button>}
                  </Space>
                ),
              }]
            : []),
        ]}
      />
      <Modal
        title="发起账号合并"
        open={mergeOpen}
        footer={null}
        destroyOnHidden
        onCancel={() => setMergeOpen(false)}
      >
        <Alert type="warning" showIcon message="来源账号将永久转为已合并，登录方式与有效授权转入目标账号；存在人员、手机号、用户名或微信冲突时服务端会拒绝。" style={{ marginBottom: 16 }} />
        <Form layout="vertical" onFinish={(values) => mergeRequestCreate.mutate(values)}>
          <Form.Item name="sourceAccountId" label="来源账号（合并后停用）" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={accounts.filter((row) => row.id !== principal.accountId && row.status !== "merged").map((row) => ({ value: row.id, label: `${row.person?.name ?? "未关联人员"} · ${row.username ?? "无用户名"} · ${labels[row.status] ?? row.status}` }))} />
          </Form.Item>
          <Form.Item name="targetAccountId" label="目标账号（继续使用）" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={accounts.filter((row) => row.id !== principal.accountId && row.status === "active").map((row) => ({ value: row.id, label: `${row.person?.name ?? "未关联人员"} · ${row.username ?? "无用户名"}` }))} />
          </Form.Item>
          <Form.Item name="reason" label="合并原因" rules={[{ required: true, min: 2, max: 500 }]}><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="currentPassword" label="当前管理员密码（二次验证）" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={mergeRequestCreate.isPending}>生成合并申请</Button>
        </Form>
      </Modal>
      <Modal
        title="发起人员档案合并"
        open={personMergeOpen}
        footer={null}
        destroyOnHidden
        onCancel={() => setPersonMergeOpen(false)}
      >
        <Alert type="warning" showIcon message="来源档案将变为只读的已合并档案。已完成培训、考试和签字历史不会迁移；存在身份、手机号、主部门或双账号冲突时服务端会拒绝。" style={{ marginBottom: 16 }} />
        <Form layout="vertical" onFinish={(values) => personMergeRequestCreate.mutate(values)}>
          <Form.Item name="sourcePersonId" label="来源档案（合并后只读）" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={persons.filter((row) => row.id !== principal.personId && row.status !== "merged").map((row) => ({ value: row.id, label: `${row.name} · ${row.organizations.find((item) => item.primary)?.organization.name ?? "未设置主部门"}` }))} />
          </Form.Item>
          <Form.Item name="targetPersonId" label="主档案（继续使用）" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={persons.filter((row) => row.id !== principal.personId && row.status === "active").map((row) => ({ value: row.id, label: `${row.name} · ${row.organizations.find((item) => item.primary)?.organization.name ?? "未设置主部门"}` }))} />
          </Form.Item>
          <Form.Item name="reason" label="合并原因" rules={[{ required: true, min: 2, max: 500 }]}><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="currentPassword" label="当前管理员密码（二次验证）" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={personMergeRequestCreate.isPending}>生成合并申请</Button>
        </Form>
      </Modal>
      <Modal
        title={`登录方式${methodAccount?.person ? `：${methodAccount.person.name}` : ""}`}
        open={Boolean(methodAccount)}
        footer={null}
        onCancel={() => setMethodAccount(undefined)}
      >
        <Alert type="warning" showIcon message="解除后该账号现有会话立即失效；没有剩余登录方式时账号转为待审核。" style={{ marginBottom: 16 }} />
        <Space direction="vertical" style={{ width: "100%" }}>
          <Button block disabled={!methodAccount?.loginMethods.password} onClick={() => void removeLoginMethod("password")}>关闭用户名密码登录</Button>
          <Button block disabled={!methodAccount?.loginMethods.phone} onClick={() => void removeLoginMethod("phone")}>解除已验证手机号</Button>
          <Button block disabled={!methodAccount?.loginMethods.wechat} onClick={() => void removeLoginMethod("wechat")}>解除微信绑定</Button>
        </Space>
      </Modal>
      <Modal
        title={`撤销角色${revokeRole ? `：${revokeRole.label}` : ""}`}
        open={Boolean(revokeRole)}
        footer={null}
        destroyOnHidden
        onCancel={() => setRevokeRole(undefined)}
      >
        <Alert type="warning" showIcon message="撤销后权限立即失效，授权历史仍会保留。" style={{ marginBottom: 16 }} />
        <Form layout="vertical" onFinish={(values: { reason: string; currentPassword?: string }) => revokeRole && roleRevoke.mutate({ roleId: revokeRole.id, role: revokeRole.role, ...values })}>
          {revokeRole?.role === "company_admin" && <Form.Item name="currentPassword" label="当前管理员密码（二次验证）" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>}
          <Form.Item name="reason" label="撤销原因" rules={[{ required: true, min: 2, max: 500 }]}><Input.TextArea rows={3} /></Form.Item>
          <Button danger type="primary" htmlType="submit" loading={roleRevoke.isPending}>确认撤销</Button>
        </Form>
      </Modal>
      <Modal
        title={`重置密码${resetAccount?.username ? `：${resetAccount.username}` : ""}`}
        open={Boolean(resetAccount)}
        footer={null}
        destroyOnHidden
        onCancel={() => setResetAccount(undefined)}
      >
        <Alert
          type="warning"
          showIcon
          message="重置后，该账号所有已登录会话将立即失效。"
          style={{ marginBottom: 16 }}
        />
        <Form
          layout="vertical"
          onFinish={(values: { newPassword: string }) => {
            if (resetAccount) passwordReset.mutate({ accountId: resetAccount.id, newPassword: values.newPassword });
          }}
        >
          <Form.Item
            name="newPassword"
            label="新的临时密码"
            rules={[{ required: true, min: 12, message: "临时密码至少 12 位" }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="再次输入临时密码"
            dependencies={["newPassword"]}
            rules={[
              { required: true, message: "请再次输入临时密码" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  return !value || getFieldValue("newPassword") === value
                    ? Promise.resolve()
                    : Promise.reject(new Error("两次输入的密码不一致"));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={passwordReset.isPending}>
            确认重置
          </Button>
        </Form>
      </Modal>
      <Modal
        title={`修改用户名${editAccount?.person ? `：${editAccount.person.name}` : ""}`}
        open={Boolean(editAccount)}
        footer={null}
        destroyOnHidden
        onCancel={() => setEditAccount(undefined)}
      >
        <Alert type="warning" showIcon message="修改后旧用户名不再复用，该账号现有会话将立即失效。" style={{ marginBottom: 16 }} />
        <Form layout="vertical" initialValues={{ username: editAccount?.username ?? "" }} onFinish={(values: { username: string; reason: string }) => editAccount && usernameUpdate.mutate({ accountId: editAccount.id, ...values })}>
          <Form.Item name="username" label="新用户名" rules={[{ required: true }, { pattern: /^[A-Za-z0-9._-]{4,40}$/, message: "仅允许英文字母、数字、点、短横线和下划线，长度 4—40 位" }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="reason" label="修改原因" rules={[{ required: true, min: 2, max: 500 }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={usernameUpdate.isPending}>确认修改</Button>
        </Form>
      </Modal>
      <Modal
        title={statusAccount?.nextStatus === "active" ? "启用账号" : "停用账号"}
        open={Boolean(statusAccount)}
        footer={null}
        destroyOnHidden
        onCancel={() => setStatusAccount(undefined)}
      >
        <Alert type={statusAccount?.nextStatus === "active" ? "info" : "warning"} showIcon message={statusAccount?.nextStatus === "active" ? "启用只恢复登录能力；人员状态和角色仍按服务端当前记录判断。" : "停用后全部登录方式和现有会话立即失效，但角色及业务历史不会删除。"} style={{ marginBottom: 16 }} />
        <Form layout="vertical" onFinish={(values: { reason: string }) => statusAccount && accountStatusUpdate.mutate({ accountId: statusAccount.account.id, status: statusAccount.nextStatus, reason: values.reason })}>
          <Form.Item label="账号"><Input value={statusAccount?.account.username ?? statusAccount?.account.person?.name ?? "未命名账号"} disabled /></Form.Item>
          <Form.Item name="reason" label="操作原因" rules={[{ required: true, min: 2, max: 500 }]}><Input.TextArea rows={3} /></Form.Item>
          <Button danger={statusAccount?.nextStatus === "disabled"} type="primary" htmlType="submit" loading={accountStatusUpdate.isPending}>确认{statusAccount?.nextStatus === "active" ? "启用" : "停用"}</Button>
        </Form>
      </Modal>
      <Modal
        title="删除误建空账号"
        open={Boolean(deleteAccount)}
        footer={null}
        destroyOnHidden
        onCancel={() => setDeleteAccount(undefined)}
      >
        <Alert type="error" showIcon message="只有完全没有人员、角色、绑定、会话、申请、审计或文件引用的误建账号才能物理删除。服务端会再次检查。" style={{ marginBottom: 16 }} />
        <Form layout="vertical" onFinish={(values: { reason: string }) => deleteAccount && accountDelete.mutate({ accountId: deleteAccount.id, reason: values.reason })}>
          <Form.Item name="reason" label="删除原因" rules={[{ required: true, min: 2, max: 500 }]}><Input.TextArea rows={3} /></Form.Item>
          <Button danger type="primary" htmlType="submit" loading={accountDelete.isPending}>确认删除</Button>
        </Form>
      </Modal>
      <Modal
        title={companyAdmin ? "创建管理员/人员账号" : "发起账号开通"}
        open={accountOpen}
        footer={null}
        onCancel={() => setAccountOpen(false)}
      >
        <Form layout="vertical" onFinish={(v) => accountCreate.mutate(v)}>
          {companyAdmin && <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>}
          {companyAdmin && <Form.Item
            name="password"
            label="初始密码"
            rules={[{ required: true, min: 12 }]}
          >
            <Input.Password />
          </Form.Item>}
          <Form.Item
            name="organizationId"
            label="所在部门"
            rules={[{ required: true }]}
          >
            <Select
              options={organizations
                .filter((o) => o.type !== "company")
                .map((o) => ({ value: o.id, label: o.name }))}
              onChange={setAccountOrgId}
            />
          </Form.Item>
          <Form.Item
            name="personId"
            label="关联人员"
            rules={[{ required: true }]}
          >
            <Select
              disabled={!accountOrgId}
              options={persons
                .filter((p) =>
                  p.organizations.some(
                    (item) => item.organization.id === accountOrgId,
                  ),
                )
                .map((p) => ({ value: p.id, label: p.name }))}
            />
          </Form.Item>
          {!companyAdmin && <Form.Item name="reason" label="开通原因" rules={[{ required: true, min: 2, max: 500 }]}><Input.TextArea rows={3} /></Form.Item>}
          <Button
            type="primary"
            htmlType="submit"
            loading={accountCreate.isPending}
          >
            {companyAdmin ? "创建账号" : "提交开通"}
          </Button>
        </Form>
      </Modal>
      <Modal
        title="授予角色"
        open={roleOpen}
        footer={null}
        onCancel={() => setRoleOpen(false)}
      >
        <Form layout="vertical" onFinish={(v) => roleCreate.mutate(v)}>
          <Form.Item name="personId" label="人员" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={persons
                .filter((person) => person.status === "active" && person.type === "employee")
                .map((person) => ({
                  value: person.id,
                  label: `${person.name} · ${person.organizations.find((item) => item.primary)?.organization.name ?? "未设置主组织"}${person.account ? "" : " · 账号待激活"}`,
                }))}
            />
          </Form.Item>
          <Form.Item label="角色" required>
            <Select
              value={roleName}
              onChange={setRoleName}
              options={availableRoles.map((value) => ({
                value,
                label: labels[value],
              }))}
            />
          </Form.Item>
          {roleName !== "company_admin" && (
            <Form.Item
              name="scopeId"
              label="授权范围"
              rules={[{ required: true }]}
            >
              <Select options={scopeOptions} />
            </Form.Item>
          )}
          <Form.Item name="reason" label="授权原因" rules={[{ required: true, min: 2, max: 500 }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          {roleName === "company_admin" && <Form.Item name="currentPassword" label="当前管理员密码（二次验证）" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>}
          <Button
            type="primary"
            htmlType="submit"
            loading={roleCreate.isPending}
          >
            确认授权
          </Button>
        </Form>
      </Modal>
    </>
  );
}

function BindingRequests({ persons }: { persons: Person[] }) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const requests = useQuery({
    queryKey: ["binding-requests"],
    queryFn: () =>
      api<
        Array<{
          id: string;
          type: string;
          status: string;
          personId: string | null;
          projectId: string | null;
          createdAt: string;
          payload: Record<string, unknown>;
        }>
      >("/api/binding-requests"),
  });
  async function approve(row: { id: string; type: string }) {
    if (row.type === "binding" && !selected[row.id])
      return message.warning("请选择要绑定的人员档案");
    const highRiskMerge = ["account_merge", "person_merge"].includes(row.type);
    const path =
      highRiskMerge
        ? `/api/management/requests/${row.id}/approve`
        : `/api/binding-requests/${row.id}/approve`;
    try {
      if (highRiskMerge) {
        const password = window.prompt(`${row.type === "person_merge" ? "人员档案" : "账号"}合并不可撤销，请输入当前管理员密码再次验证`);
        if (!password) return;
        const note = window.prompt("请输入确认合并原因");
        if (!note?.trim()) return;
        const sensitive = await api<{ token: string }>("/api/auth/reauthenticate", json("POST", { password }));
        await api(path, { ...json("POST", { note }), headers: { "x-sensitive-token": sensitive.token } });
      } else {
        await api(path, json("POST", row.type === "binding" ? { personId: selected[row.id] } : {}));
      }
      message.success(highRiskMerge ? `${row.type === "person_merge" ? "人员档案" : "账号"}已合并` : "审核通过");
      void requests.refetch();
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  async function rejectMerge(row: { id: string; type: string }) {
    const kind = row.type === "person_merge" ? "人员档案" : "账号";
    const password = window.prompt(`拒绝${kind}合并前，请输入当前管理员密码再次验证`);
    if (!password) return;
    const note = window.prompt("请输入拒绝原因");
    if (!note?.trim()) return;
    try {
      const sensitive = await api<{ token: string }>("/api/auth/reauthenticate", json("POST", { password }));
      await api(`/api/management/requests/${row.id}/reject`, { ...json("POST", { note }), headers: { "x-sensitive-token": sensitive.token } });
      message.success(`已拒绝${kind}合并申请`);
      void requests.refetch();
    } catch (error) { message.error((error as Error).message); }
  }
  return (
    <Table
      rowKey="id"
      loading={requests.isLoading}
      dataSource={requests.data}
      columns={[
        {
          title: "申请类型",
          render: (_: unknown, row) =>
            row.type === "account_merge"
              ? "账号合并"
              : row.type === "person_merge"
                ? "人员档案合并"
              : row.type === "registration"
                ? "新档案注册"
                : row.payload.organizationName
                  ? "加入部门/档案绑定"
                  : "手机号绑定",
        },
        {
          title: "申请人",
          render: (_: unknown, row) => row.type === "account_merge" ? (
            <Space direction="vertical" size={0}>
              <span>来源：{String(row.payload.sourceAccountLabel ?? "账号信息不可用")}</span>
              <Typography.Text type="secondary">目标：{String(row.payload.targetAccountLabel ?? "账号信息不可用")}</Typography.Text>
            </Space>
          ) : row.type === "person_merge" ? (
            <Space direction="vertical" size={0}>
              <span>来源：{persons.find((person) => person.id === row.personId)?.name ?? "档案信息不可用"}</span>
              <Typography.Text type="secondary">目标：{persons.find((person) => person.id === row.payload.targetPersonId)?.name ?? "档案信息不可用"}</Typography.Text>
            </Space>
          ) : String(row.payload.name ?? "待匹配人员"),
        },
        {
          title: "手机号",
          render: (_: unknown, row) => String(row.payload.phone ?? "—"),
        },
        {
          title: "申请部门",
          render: (_: unknown, row) =>
            String(row.payload.organizationName ?? "—"),
        },
        {
          title: "操作",
          render: (_: unknown, row) => (
            <Space>
              {row.type === "binding" &&
                (persons.length ? (
                  <Select
                    style={{ width: 180 }}
                    placeholder="选择档案"
                    options={persons.map((p) => ({
                      value: p.id,
                      label: p.name,
                    }))}
                    onChange={(value) =>
                      setSelected((current) => ({
                        ...current,
                        [row.id]: value,
                      }))
                    }
                  />
                ) : (
                  <Typography.Text type="secondary">
                    暂无可匹配人员档案，请先导入或新建人员
                  </Typography.Text>
                ))}
              <Button
                type="primary"
                size="small"
                disabled={row.type === "binding" && !persons.length}
                onClick={() => void approve(row)}
              >
                {["account_merge", "person_merge"].includes(row.type) ? "确认合并" : "审核通过"}
              </Button>
              {["account_merge", "person_merge"].includes(row.type) && <Button danger size="small" onClick={() => void rejectMerge(row)}>拒绝</Button>}
            </Space>
          ),
        },
      ]}
    />
  );
}

function People({ principal }: { principal: Principal }) {
  const query = useQuery({
    queryKey: ["persons"],
    queryFn: () => api<Person[]>("/api/persons"),
  });
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<Account[]>("/api/accounts"),
  });
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: () => api<Organization[]>("/api/organizations"),
  });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/api/projects"),
  });
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [photoId, setPhotoId] = useState<string>();
  const [form] = Form.useForm();
  const [detailPerson, setDetailPerson] = useState<Person>();
  const [editing, setEditing] = useState<Person>();
  const [editPhotoId, setEditPhotoId] = useState<string>();
  const [editForm] = Form.useForm();
  const create = useMutation({
    mutationFn: (value: Record<string, unknown>) =>
      api<Person>(
        "/api/persons",
        json("POST", { ...value, photoFileId: photoId }),
      ),
    onSuccess: () => {
      message.success("人员已创建");
      setOpen(false);
      form.resetFields();
      setPhotoId(undefined);
      void qc.invalidateQueries({ queryKey: ["persons"] });
    },
    onError: (e) => message.error(e.message),
  });
  const uploadPhoto = async ({
    file,
    onSuccess,
    onError,
  }: UploadRequestOption) => {
    try {
      const data = new FormData();
      data.append("file", file as Blob);
      const result = await api<{ id: string }>("/api/files?kind=photo", {
        method: "POST",
        body: data,
      });
      setPhotoId(result.id);
      onSuccess?.(result);
    } catch (error) {
      onError?.(error as Error);
    }
  };
  const update = useMutation({
    mutationFn: (value: Record<string, unknown>) =>
      api<Person>(
        `/api/persons/${editing!.id}`,
        json("PATCH", {
          ...Object.fromEntries(
            Object.entries(value).filter(
              ([, item]) => item !== undefined && item !== "",
            ),
          ),
          ...(editPhotoId ? { photoFileId: editPhotoId } : {}),
        }),
      ),
    onSuccess: () => {
      message.success("人员资料已更新");
      setEditing(undefined);
      setEditPhotoId(undefined);
      editForm.resetFields();
      void qc.invalidateQueries({ queryKey: ["persons"] });
    },
    onError: (e) => message.error(e.message),
  });
  const uploadEditPhoto = async ({
    file,
    onSuccess,
    onError,
  }: UploadRequestOption) => {
    try {
      const data = new FormData();
      data.append("file", file as Blob);
      const result = await api<{ id: string }>("/api/files?kind=photo", {
        method: "POST",
        body: data,
      });
      setEditPhotoId(result.id);
      onSuccess?.(result);
    } catch (error) {
      onError?.(error as Error);
    }
  };
  const roleText = (role: {
    role: string;
    scopeType: string;
    scopeId: string | null;
  }) => {
    const scope =
      role.scopeType === "organization"
        ? (organizations.data ?? []).find((row) => row.id === role.scopeId)
            ?.name
        : role.scopeType === "project"
          ? (projects.data ?? []).find((row) => row.id === role.scopeId)?.name
          : undefined;
    return `${labels[role.role] ?? role.role}${scope ? ` · ${scope}` : ""}`;
  };
  const personColumns = [
    {
      title: "姓名",
      dataIndex: "name",
      render: (value: string, row: Person) => (
        <Button
          type="link"
          style={{ padding: 0 }}
          onClick={() => setDetailPerson(row)}
        >
          {value}
        </Button>
      ),
    },
    { title: "类型", dataIndex: "type", render: (v: string) => labels[v] ?? v },
    { title: "手机号", dataIndex: "phone", render: (v: string) => v },
    {
      title: "身份证",
      dataIndex: "nationalIdLast4",
      render: (v: string | null) =>
        v ? `**************${v}` : <Tag>待补录</Tag>,
    },
    {
      title: "管理权限",
      render: (_: unknown, row: Person) => {
        const roles = (row.roleAssignments ?? []).filter(
          (role) => role.role !== "learner",
        );
        return roles.length ? (
          <Space size={[0, 4]} wrap>
            {roles.map((role) => (
              <Tag color="blue" key={role.id}>
                {roleText(role)}
              </Tag>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">普通人员</Typography.Text>
        );
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      render: (v: string) => (
        <Tag color={v === "active" ? "green" : "default"}>{labels[v] ?? v}</Tag>
      ),
    },
    {
      title: "操作",
      render: (_: unknown, row: Person) => (
        <Button
          size="small"
          onClick={() => {
            setEditing(row);
            editForm.setFieldsValue(
              companyAdmin
                ? {
                    name: row.name,
                    organizationId: row.organizations.find(
                      (item) => item.primary,
                    )?.organization.id,
                    keepCrossEntityProjectAdminRoles: false,
                  }
                : {},
            );
          }}
        >
          编辑/补录
        </Button>
      ),
    },
  ];
  const groupedPeople = (organizations.data ?? [])
    .filter((organization) => organization.type !== "company")
    .map((organization) => ({
      organization,
      people: (query.data ?? []).filter(
        (person) =>
          (
            person.organizations.find((item) => item.primary) ??
            person.organizations[0]
          )?.organization.id === organization.id,
      ),
    }))
    .filter(({ people }) => people.length);
  const unassigned = (query.data ?? []).filter(
    (person) => !person.organizations.length,
  );
  const companyAdmin = principal.roles.some(
    (role) => role.role === "company_admin",
  );
  const canExportSensitive = principal.roles.some((role) =>
    ["company_admin", "org_leader", "org_admin", "project_admin"].includes(role.role),
  );
  return (
    <>
      <Space className="page-title">
        <Typography.Title level={3}>人员与账号</Typography.Title>
        {companyAdmin && (
          <>
            <Button type="primary" onClick={() => setOpen(true)}>
              新建人员
            </Button>
            <PersonImport enabled />
          </>
        )}
      </Space>
      <Tabs
        items={[
          {
            key: "persons",
            label: "人员档案",
            children: (
              <Collapse
                items={[
                  ...groupedPeople.map(({ organization, people }) => ({
                    key: organization.id,
                    label: `${organization.name}（${people.length} 人）`,
                    children: (
                      <Table
                        rowKey="id"
                        pagination={false}
                        dataSource={people}
                        columns={personColumns}
                      />
                    ),
                  })),
                  ...(unassigned.length
                    ? [
                        {
                          key: "unassigned",
                          label: `待分配部门（${unassigned.length} 人）`,
                          children: (
                            <Table
                              rowKey="id"
                              pagination={false}
                              dataSource={unassigned}
                              columns={personColumns}
                            />
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            ),
          },
          {
            key: "accounts",
            label: "账号与权限",
            children: (
              <AccountsPanel
                accounts={accounts.data ?? []}
                persons={query.data ?? []}
                organizations={organizations.data ?? []}
                principal={principal}
              />
            ),
          },
          {
            key: "binding",
            label: "绑定与注册审核",
            children: <BindingRequests persons={query.data ?? []} />,
          },
          ...(canExportSensitive
            ? [{
                key: "sensitive-exports",
                label: "敏感资料导出",
                children: <SensitiveExports principal={principal} organizations={organizations.data ?? []} projects={projects.data ?? []} />,
              }]
            : []),
        ]}
      />
      <Modal
        title="新建人员"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={create.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(value) => create.mutate(value as Record<string, unknown>)}
        >
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="phone"
            label="手机号"
            rules={[{ required: true, pattern: /^1\d{10}$/ }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="type" label="人员类型" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "employee", label: "正式员工" },
                { value: "contractor", label: "外协人员" },
                { value: "temporary_individual", label: "临时个人" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="organizationId"
            label="所属组织/责任部门"
            rules={[{ required: true }]}
          >
            <Select
              options={(organizations.data ?? []).map((o) => ({
                value: o.id,
                label: o.name,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="nationalId"
            label="身份证号码"
            rules={[{ required: true }]}
          >
            <Input.Password autoComplete="off" />
          </Form.Item>
          <Form.Item label="个人照片" required>
            <Upload
              accept="image/png,image/jpeg"
              maxCount={1}
              customRequest={uploadPhoto}
            >
              <Button icon={<UploadOutlined />}>上传私有照片</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="编辑/补录人员资料"
        open={!!editing}
        onCancel={() => {
          setEditing(undefined);
          setEditPhotoId(undefined);
          editForm.resetFields();
        }}
        onOk={() => editForm.submit()}
        confirmLoading={update.isPending}
      >
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message={
            companyAdmin
              ? "只填写需要修改或补录的项目；手机号不修改时请留空。"
              : "组织管理员仅可更新本组织人员照片，关键资料变更请提交申请。"
          }
        />
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(value) => update.mutate(value as Record<string, unknown>)}
        >
          {companyAdmin && (
            <>
              <Form.Item name="name" label="姓名" rules={[{ min: 2 }]}>
                <Input />
              </Form.Item>
              <Form.Item
                name="phone"
                label="新手机号"
                rules={[
                  { pattern: /^1\d{10}$/, message: "请输入 11 位手机号" },
                ]}
              >
                <Input placeholder="不修改请留空" />
              </Form.Item>
              <Form.Item name="organizationId" label="所属组织/责任部门">
                <Select
                  allowClear
                  options={(organizations.data ?? [])
                    .filter((o) =>
                      ["department", "business_entity"].includes(o.type),
                    )
                    .map((o) => ({ value: o.id, label: o.name }))}
                />
              </Form.Item>
              <Form.Item name="keepCrossEntityProjectAdminRoles" label="跨经营实体项目管理员权限">
                <Select options={[{ value: false, label: "结束原项目管理员权限（默认）" }, { value: true, label: "保留，并作为跨实体授权" }]} />
              </Form.Item>
              <Form.Item name="nationalId" label="身份证号码">
                <Input.Password autoComplete="off" placeholder="不修改请留空" />
              </Form.Item>
            </>
          )}
          <Form.Item label="个人照片">
            <Upload
              accept="image/png,image/jpeg"
              maxCount={1}
              customRequest={uploadEditPhoto}
            >
              <Button icon={<UploadOutlined />}>上传并替换照片</Button>
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
      <PersonDetail
        person={detailPerson}
        principal={principal}
        onClose={() => setDetailPerson(undefined)}
        onChanged={() => {
          void query.refetch();
          void accounts.refetch();
        }}
      />
    </>
  );
}

function PersonDetail({
  person,
  principal,
  onClose,
  onChanged,
}: {
  person: Person | undefined;
  principal: Principal;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [nationalId, setNationalId] = useState<string>();
  const [certificateNumbers, setCertificateNumbers] = useState<
    Record<string, string>
  >({});
  const details = useQuery({
    queryKey: ["person-details", person?.id],
    queryFn: () => api<any>(`/api/persons/${person!.id}/details`),
    enabled: !!person,
  });
  const companyAdmin = principal.roles.some(
    (role) => role.role === "company_admin",
  );
  async function revealNationalId() {
    const password = window.prompt("请输入当前管理员密码再次验证");
    if (!password) return;
    try {
      const auth = await api<{ token: string }>(
        `/api/persons/${person!.id}/sensitive-access`,
        json("POST", { password }),
      );
      const sensitive = await api<{ nationalId: string }>(
        `/api/persons/${person!.id}/sensitive`,
        { headers: { "x-sensitive-token": auth.token } },
      );
      setNationalId(sensitive.nationalId);
      window.setTimeout(() => setNationalId(undefined), 5 * 60 * 1000);
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  async function revealCertificate(id: string) {
    const password = window.prompt("请输入当前管理员密码再次验证");
    if (!password) return;
    try {
      const auth = await api<{ token: string }>(
        "/api/auth/reauthenticate",
        json("POST", { password }),
      );
      const sensitive = await api<{ certificateNo: string }>(
        `/api/person-certificates/${id}/sensitive`,
        { headers: { "x-sensitive-token": auth.token } },
      );
      setCertificateNumbers((current) => ({
        ...current,
        [id]: sensitive.certificateNo,
      }));
      window.setTimeout(
        () =>
          setCertificateNumbers((current) => {
            const next = { ...current };
            delete next[id];
            return next;
          }),
        5 * 60 * 1000,
      );
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  async function changeStatus(status: "active" | "disabled") {
    const reason = window.prompt(
      status === "disabled" ? "请输入停用原因" : "请输入重新启用原因",
    );
    if (!reason?.trim()) return;
    try {
      await api(
        `/api/persons/${person!.id}/status`,
        json("PATCH", { status, reason }),
      );
      message.success(
        status === "disabled"
          ? "人员已停用"
          : "人员已重新启用，仅恢复普通人员权限",
      );
      await details.refetch();
      onChanged();
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  async function deleteEmptyPerson() {
    const reason = window.prompt(
      "仅完全无业务引用的误建空档案可删除。请输入原因",
    );
    if (!reason?.trim()) return;
    try {
      await api(`/api/persons/${person!.id}`, json("DELETE", { reason }));
      message.success("空档案已删除");
      onClose();
      onChanged();
    } catch (error) {
      message.error((error as Error).message);
    }
  }
  const row = details.data;
  return (
    <Modal
      title={`${person?.name ?? "人员"} · 档案详情`}
      open={!!person}
      onCancel={() => {
        setNationalId(undefined);
        setCertificateNumbers({});
        onClose();
      }}
      footer={null}
      width={900}
      destroyOnClose
    >
      {row && (
        <Tabs
          items={[
            {
              key: "basic",
              label: "基本档案",
              children: (
                <Card size="small">
                  <Space direction="vertical">
                    <span>姓名：{row.name}</span>
                    <span>手机号：{row.phone}</span>
                    <span>
                      身份证：
                      {nationalId ??
                        (row.nationalIdLast4
                          ? `**************${row.nationalIdLast4}`
                          : "待补录")}{" "}
                      {row.nationalIdLast4 && (
                        <Button
                          type="link"
                          size="small"
                          onClick={() => void revealNationalId()}
                        >
                          查看完整号码
                        </Button>
                      )}
                    </span>
                    <span>人员类型：{labels[row.type] ?? row.type}</span>
                    <span>状态：{labels[row.status] ?? row.status}</span>
                    {companyAdmin && (
                      <Space>
                        <Button
                          onClick={() =>
                            void changeStatus(
                              row.status === "active" ? "disabled" : "active",
                            )
                          }
                        >
                          {row.status === "active" ? "停用人员" : "重新启用"}
                        </Button>
                        <Button danger onClick={() => void deleteEmptyPerson()}>
                          删除误建空档案
                        </Button>
                      </Space>
                    )}
                  </Space>
                </Card>
              ),
            },
            {
              key: "account",
              label: "账号与微信绑定",
              children: row.account ? (
                <Card size="small">
                  <p>账号：{row.account.username ?? "微信账号"}</p>
                  <p>
                    账号状态：{labels[row.account.status] ?? row.account.status}
                  </p>
                  <p>已验证手机号：{row.account.verifiedPhone ?? "—"}</p>
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={row.account.wechatBindings}
                    columns={[
                      { title: "AppID", dataIndex: "appId" },
                      {
                        title: "状态",
                        dataIndex: "active",
                        render: (value: boolean) => (value ? "有效" : "已失效"),
                      },
                      {
                        title: "绑定时间",
                        dataIndex: "boundAt",
                        render: (value: string) =>
                          value ? new Date(value).toLocaleString() : "—",
                      },
                    ]}
                  />
                </Card>
              ) : (
                <Alert type="info" message="尚未建立登录账号或微信绑定" />
              ),
            },
            {
              key: "organization",
              label: "组织与项目",
              children: (
                <>
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={row.organizations}
                    columns={[
                      {
                        title: "组织",
                        render: (_: unknown, item: any) =>
                          item.organization.name,
                      },
                      {
                        title: "关系",
                        render: (_: unknown, item: any) =>
                          item.primary ? "主组织" : "关联组织",
                      },
                      {
                        title: "状态",
                        render: (_: unknown, item: any) =>
                          item.active ? "当前" : "历史",
                      },
                      {
                        title: "结束时间",
                        dataIndex: "endedAt",
                        render: (value: string) =>
                          value ? new Date(value).toLocaleString() : "—",
                      },
                    ]}
                  />
                  <Table
                    style={{ marginTop: 16 }}
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={row.projectMemberships}
                    columns={[
                      {
                        title: "项目",
                        render: (_: unknown, item: any) => item.project.name,
                      },
                      {
                        title: "项目状态",
                        render: (_: unknown, item: any) =>
                          labels[item.project.status] ?? item.project.status,
                      },
                      {
                        title: "成员关系",
                        dataIndex: "status",
                        render: (value: string) => labels[value] ?? value,
                      },
                    ]}
                  />
                </>
              ),
            },
            {
              key: "roles",
              label: "角色权限",
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={row.roleAssignments ?? []}
                  columns={[
                    {
                      title: "角色",
                      dataIndex: "role",
                      render: (value: string) => labels[value] ?? value,
                    },
                    { title: "范围类型", dataIndex: "scopeType" },
                    {
                      title: "状态",
                      dataIndex: "active",
                      render: (value: boolean, role: Person["roleAssignments"][number]) =>
                        value ? "当前有效" : role.activationPending ? "已授权，账号待激活" : "历史授权",
                    },
                    {
                      title: "结束时间",
                      dataIndex: "endedAt",
                      render: (value: string) =>
                        value ? new Date(value).toLocaleString() : "—",
                    },
                    {
                      title: "结束原因",
                      dataIndex: "endReason",
                      render: (value: string) => value ?? "—",
                    },
                  ]}
                />
              ),
            },
            {
              key: "certificates",
              label: "证照",
              children: (
                <>
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={row.certificates}
                    columns={[
                      { title: "证书名称", dataIndex: "name" },
                      {
                        title: "编号",
                        render: (_: unknown, item: any) => (
                          <Space>
                            {certificateNumbers[item.id] ??
                              item.certificateNo ??
                              "—"}
                            {item.certificateNo && (
                              <Button
                                type="link"
                                size="small"
                                onClick={() => void revealCertificate(item.id)}
                              >
                                查看完整号码
                              </Button>
                            )}
                          </Space>
                        ),
                      },
                      {
                        title: "发证机构",
                        dataIndex: "issuingAuthority",
                        render: (v: string) => v || "—",
                      },
                      {
                        title: "到期时间",
                        dataIndex: "expiresAt",
                        render: (v: string) => (v ? v.slice(0, 10) : "长期"),
                      },
                      ...(companyAdmin
                        ? [
                            {
                              title: "操作",
                              render: (_: unknown, item: any) => (
                                <Button
                                  danger
                                  size="small"
                                  onClick={() =>
                                    Modal.confirm({
                                      title: `停用“${item.name}”？`,
                                      content: "历史记录会保留，不会物理删除。",
                                      onOk: async () => {
                                        await api(
                                          `/api/certificates/personal/${item.id}/revoke`,
                                          { method: "PATCH" },
                                        );
                                        void qc.invalidateQueries({
                                          queryKey: [
                                            "person-details",
                                            person?.id,
                                          ],
                                        });
                                      },
                                    })
                                  }
                                >
                                  停用
                                </Button>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                  {companyAdmin && (
                    <Button
                      style={{ marginTop: 16 }}
                      type="primary"
                      href="/qualifications"
                    >
                      到资质证照模块统一维护
                    </Button>
                  )}
                </>
              ),
            },
            {
              key: "training",
              label: "培训记录",
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={row.assignments}
                  columns={[
                    {
                      title: "培训名称",
                      render: (_: unknown, item: any) => item.batch.name,
                    },
                    {
                      title: "类型",
                      render: (_: unknown, item: any) => item.batch.type,
                    },
                    { title: "状态", dataIndex: "status" },
                    {
                      title: "最近成绩",
                      render: (_: unknown, item: any) =>
                        item.attempts[0]?.score ?? "—",
                    },
                  ]}
                />
              ),
            },
            {
              key: "requests",
              label: "申请与变更",
              children: <Table size="small" rowKey="id" pagination={false} dataSource={row.changeRequests ?? []} columns={[{ title: "类型", dataIndex: "type" }, { title: "状态", dataIndex: "status", render: (value: string) => labels[value] ?? value }, { title: "提交时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() }, { title: "处理时间", dataIndex: "reviewedAt", render: (value: string) => value ? new Date(value).toLocaleString() : "—" }, { title: "处理意见", dataIndex: "reviewNote", render: (value: string) => value || "—" }]} />,
            },
            {
              key: "timeline",
              label: "操作记录",
              children: <Table size="small" rowKey="id" pagination={{ pageSize: 20 }} dataSource={row.timeline ?? []} columns={[{ title: "时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() }, { title: "动作", dataIndex: "action" }, { title: "对象", dataIndex: "objectType" }, { title: "结果", dataIndex: "result", render: (value: string) => value || "—" }]} />,
            },
            {
              key: "photos",
              label: "照片历史",
              children: <Table size="small" rowKey="id" pagination={false} dataSource={row.photoHistory ?? []} columns={[{ title: "文件", render: (_: unknown, item: any) => item.file?.originalName ?? "—" }, { title: "状态", dataIndex: "active", render: (value: boolean) => value ? "当前照片" : "历史照片" }, { title: "记录时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() }, { title: "结束时间", dataIndex: "endedAt", render: (value: string) => value ? new Date(value).toLocaleString() : "—" }]} />,
            },
          ]}
        />
      )}
    </Modal>
  );
}

function OrganizationProjects({ principal }: { principal: Principal }) {
  const qc = useQueryClient();
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: () => api<Organization[]>("/api/organizations"),
  });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/api/projects"),
  });
  const people = useQuery({
    queryKey: ["persons"],
    queryFn: () => api<Person[]>("/api/persons"),
  });
  const [orgOpen, setOrgOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization>();
  const [roleOrg, setRoleOrg] = useState<Organization>();
  const [roleName, setRoleName] = useState("field_reporter");
  const [projectOpen, setProjectOpen] = useState(false);
  const [memberProject, setMemberProject] = useState<Project>();
  const members = useQuery({
    queryKey: ["project-members", memberProject?.id],
    queryFn: () =>
      api<Array<{ id: string; status: string; person: Person }>>(
        `/api/projects/${memberProject!.id}/members`,
      ),
    enabled: !!memberProject,
  });
  const orgCreate = useMutation({
    mutationFn: (v: unknown) => api("/api/organizations", json("POST", v)),
    onSuccess: () => {
      setOrgOpen(false);
      void qc.invalidateQueries({ queryKey: ["organizations"] });
    },
    onError: (e) => message.error(e.message),
  });
  const orgUpdate = useMutation({
    mutationFn: (v: unknown) =>
      api(`/api/organizations/${editingOrg!.id}`, json("PATCH", v)),
    onSuccess: () => {
      message.success("组织已更新");
      setEditingOrg(undefined);
      void qc.invalidateQueries({ queryKey: ["organizations"] });
    },
    onError: (e) => message.error(e.message),
  });
  const roleGrant = useMutation({
    mutationFn: (v: { personId: string }) =>
      api(
        `/api/organizations/${roleOrg!.id}/roles`,
        json("POST", { ...v, role: roleName }),
      ),
    onSuccess: () => {
      message.success("人员权限已更新");
      void qc.invalidateQueries({ queryKey: ["organizations"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e) => message.error(e.message),
  });
  const projectCreate = useMutation({
    mutationFn: (v: unknown) => api("/api/projects", json("POST", v)),
    onSuccess: () => {
      setProjectOpen(false);
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e) => message.error(e.message),
  });
  const companyAdmin = principal.roles.some(
    (role) => role.role === "company_admin",
  );
  const managedOrganizationIds = principal.roles
    .filter(
      (role) =>
        ["org_leader", "org_admin"].includes(role.role) &&
        role.scopeType === "organization" &&
        role.scopeId,
    )
    .map((role) => role.scopeId!);
  const canManageOrganization = (organization: Organization) =>
    companyAdmin || managedOrganizationIds.includes(organization.id);
  const canGrantOrganizationRole = (organization: Organization) => companyAdmin
    || principal.roles.some((role) => role.role === "org_leader" && role.scopeType === "organization" && role.scopeId === organization.id)
    || (organization.type === "business_entity" && principal.roles.some((role) => role.role === "org_admin" && role.scopeType === "organization" && role.scopeId === organization.id));
  const canCreateProject =
    companyAdmin ||
    (organizations.data ?? []).some(
      (organization) =>
        organization.type === "business_entity" &&
        managedOrganizationIds.includes(organization.id),
    );
  const canChangeProjectStatus = (project: Project) =>
    companyAdmin ||
    managedOrganizationIds.includes(project.responsibleOrganizationId);
  const rolePeople = roleOrg
    ? (people.data ?? []).filter((person) =>
        person.organizations.some(
          (item) => item.organization.id === roleOrg.id,
        ),
      )
    : [];
  const revokeRole = async (organizationId: string, roleId: string, reason: string) => {
    try {
      await api(`/api/organizations/${organizationId}/roles/${roleId}`, json("DELETE", { reason }));
      message.success("人员权限已取消");
      void organizations.refetch();
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  const roleTags = (
    organization: Organization,
    rows: OrganizationRolePerson[],
    canRevoke: boolean,
  ) =>
    rows.length ? (
      <Space size={[0, 4]} wrap>
        {rows.map((row) => (
          <Tag
            key={`${row.personId}-${row.roleId ?? "default"}`}
            closable={!!row.roleId && canRevoke}
            onClose={(event) => {
              event.preventDefault();
              if (row.roleId)
                Modal.confirm({
                  title: `取消“${row.name}”的权限？`,
                  okText: "确认取消",
                  cancelText: "取消",
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    const reason = window.prompt("请输入撤销原因");
                    if (!reason?.trim()) throw new Error("请填写撤销原因");
                    await revokeRole(organization.id, row.roleId!, reason);
                  },
                });
            }}
          >
            {row.name}
            {row.inherited ? "（管理员默认）" : ""}
            {row.activationPending ? "（账号待激活）" : ""}
          </Tag>
        ))}
      </Space>
    ) : (
      "—"
    );
  return (
    <>
      <Space className="page-title">
        <Typography.Title level={3}>组织与项目</Typography.Title>
        {companyAdmin && (
          <Button onClick={() => setOrgOpen(true)}>新建组织</Button>
        )}
        {canCreateProject && (
          <Button type="primary" onClick={() => setProjectOpen(true)}>
            新建项目
          </Button>
        )}
      </Space>
      <Tabs
        items={[
          {
            key: "org",
            label: "组织",
            children: (
              <Table
                rowKey="id"
                pagination={false}
                scroll={{ x: 1120 }}
                dataSource={organizations.data}
                columns={[
                  {
                    title: "名称",
                    dataIndex: "name",
                    fixed: "left",
                    width: 180,
                  },
                  {
                    title: "类型",
                    dataIndex: "type",
                    width: 100,
                    render: (v: string) => organizationTypeLabels[v] ?? v,
                  },
                  { title: "人数", dataIndex: "memberCount", width: 80 },
                  {
                    title: "负责人",
                    width: 180,
                    render: (_: unknown, row: Organization) =>
                      roleTags(row, row.leaders, companyAdmin),
                  },
                  {
                    title: "管理人员",
                    width: 200,
                    render: (_: unknown, row: Organization) =>
                      roleTags(row, row.admins, companyAdmin),
                  },
                  {
                    title: "野外项目报送人员",
                    width: 260,
                    render: (_: unknown, row: Organization) =>
                      row.type === "business_entity"
                        ? roleTags(
                            row,
                            row.reporters,
                            canManageOrganization(row),
                          )
                        : "—",
                  },
                  {
                    title: "操作",
                    fixed: "right",
                    width: 210,
                    render: (_: unknown, row: Organization) => (
                      <Space>
                        {companyAdmin && (
                          <Button
                            size="small"
                            onClick={() => setEditingOrg(row)}
                          >
                            编辑
                          </Button>
                        )}
                        {["department", "business_entity"].includes(row.type) &&
                          canGrantOrganizationRole(row) && (
                            <Button
                              size="small"
                              onClick={() => {
                                setRoleName(
                                  companyAdmin || principal.roles.some((role) => role.role === "org_leader" && role.scopeId === row.id) ? "org_admin" : "field_reporter",
                                );
                                setRoleOrg(row);
                              }}
                            >
                              人员权限
                            </Button>
                          )}
                        {companyAdmin && (
                          <Button
                            size="small"
                            danger
                            onClick={() =>
                              Modal.confirm({
                                title: `删除“${row.name}”？`,
                                content:
                                  "仅未关联人员、项目、权限或培训资料的组织可以删除；不能删除时会明确提示原因。",
                                okText: "确认删除",
                                cancelText: "取消",
                                okButtonProps: { danger: true },
                                onOk: async () => {
                                  try {
                                    await api(`/api/organizations/${row.id}`, {
                                      method: "DELETE",
                                    });
                                    message.success("组织已删除");
                                    void organizations.refetch();
                                  } catch (error) {
                                    message.error((error as Error).message);
                                  }
                                },
                              })
                            }
                          >
                            删除
                          </Button>
                        )}
                      </Space>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: "projects",
            label: "项目",
            children: (
              <Table
                rowKey="id"
                pagination={false}
                dataSource={projects.data}
                columns={[
                  { title: "项目名称", dataIndex: "name" },
                  { title: "编号", dataIndex: "code" },
                  {
                    title: "类型/地点",
                    render: (_: unknown, row: Project) =>
                      [row.projectType, row.location]
                        .filter(Boolean)
                        .join(" / ") || "—",
                  },
                  {
                    title: "项目负责人",
                    render: (_: unknown, row: Project) =>
                      [row.managerName, row.managerPhone]
                        .filter(Boolean)
                        .join(" / ") || "—",
                  },
                  {
                    title: "责任实体",
                    render: (_: unknown, row: Project) =>
                      row.responsibleOrganization.name,
                  },
                  {
                    title: "成员数",
                    render: (_: unknown, row: Project) => row._count.members,
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    render: (v: string) => (
                      <Tag
                        color={
                          v === "active"
                            ? "green"
                            : v === "ended"
                              ? "default"
                              : "orange"
                        }
                      >
                        {labels[v] ?? v}
                      </Tag>
                    ),
                  },
                  {
                    title: "操作",
                    render: (_: unknown, row: Project) => (
                      <Space>
                        <Button
                          size="small"
                          onClick={() => setMemberProject(row)}
                        >
                          管理成员
                        </Button>
                        {canChangeProjectStatus(row) &&
                          row.status !== "ended" && (
                            <Button
                              size="small"
                              onClick={async () => {
                                await api(
                                  `/api/projects/${row.id}/status`,
                                  json("PATCH", {
                                    status:
                                      row.status === "active"
                                        ? "paused"
                                        : "active",
                                  }),
                                );
                                void projects.refetch();
                              }}
                            >
                              {row.status === "active" ? "暂停" : "恢复"}
                            </Button>
                          )}
                        {canChangeProjectStatus(row) &&
                          row.status !== "ended" && (
                            <Button
                              danger
                              size="small"
                              onClick={async () => {
                                await api(
                                  `/api/projects/${row.id}/status`,
                                  json("PATCH", { status: "ended" }),
                                );
                                void projects.refetch();
                              }}
                            >
                              结束
                            </Button>
                          )}
                      </Space>
                    ),
                  },
                ]}
              />
            ),
          },
        ]}
      />
      <Modal
        title="新建组织"
        open={orgOpen}
        footer={null}
        onCancel={() => setOrgOpen(false)}
      >
        <Form layout="vertical" onFinish={(v) => orgCreate.mutate(v)}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select
              options={[
                "company",
                "business_entity",
                "department",
                "contractor",
              ].map((v) => ({ value: v, label: organizationTypeLabels[v] }))}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            部门和经营实体默认归属物化院有限公司。
          </Typography.Paragraph>
          <Button
            type="primary"
            htmlType="submit"
            loading={orgCreate.isPending}
          >
            创建
          </Button>
        </Form>
      </Modal>
      <Modal
        title="编辑组织"
        open={!!editingOrg}
        footer={null}
        onCancel={() => setEditingOrg(undefined)}
        destroyOnClose
      >
        <Form
          layout="vertical"
          initialValues={editingOrg ?? {}}
          onFinish={(v) => orgUpdate.mutate(v)}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select
              disabled={editingOrg?.type === "company"}
              options={[
                "company",
                "business_entity",
                "department",
                "contractor",
              ].map((v) => ({ value: v, label: organizationTypeLabels[v] }))}
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={orgUpdate.isPending}
          >
            保存
          </Button>
        </Form>
      </Modal>
      <Modal
        title={`${roleOrg?.name ?? "组织"} · 人员权限`}
        open={!!roleOrg}
        footer={null}
        onCancel={() => setRoleOrg(undefined)}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          message="负责人每个组织仅一名；管理员可多名。野外项目报送权限仅适用于经营实体。"
          style={{ marginBottom: 16 }}
        />
        <Form layout="vertical" onFinish={(v) => roleGrant.mutate(v)}>
          <Form.Item label="权限">
            <Select
              value={roleName}
              onChange={setRoleName}
              options={(companyAdmin
                ? [
                    "org_leader",
                    "org_admin",
                    ...(roleOrg?.type === "business_entity"
                      ? ["field_reporter"]
                      : []),
                  ]
                : [
                    ...(principal.roles.some((role) => role.role === "org_leader" && role.scopeId === roleOrg?.id) ? ["org_admin"] : []),
                    ...(roleOrg?.type === "business_entity" ? ["field_reporter"] : []),
                  ]
              ).map((value) => ({ value, label: labels[value] }))}
            />
          </Form.Item>
          <Form.Item
            name="personId"
            label="组织人员"
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={rolePeople.map((person) => ({
                value: person.id,
                label: person.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="reason" label="授权原因" rules={[{ required: true, min: 2, max: 500 }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={roleGrant.isPending}
          >
            设置权限
          </Button>
        </Form>
      </Modal>
      <Modal
        title="新建项目"
        open={projectOpen}
        footer={null}
        onCancel={() => setProjectOpen(false)}
      >
        <Form layout="vertical" onFinish={(v) => projectCreate.mutate(v)}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="项目编号" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="projectType" label="项目类型">
            <Input />
          </Form.Item>
          <Form.Item name="location" label="施工地点">
            <Input />
          </Form.Item>
          <Form.Item name="contractAmount" label="合同额（万元）">
            <Input inputMode="decimal" />
          </Form.Item>
          <Form.Item name="plannedStartAt" label="计划开始日期">
            <Input type="date" />
          </Form.Item>
          <Form.Item name="plannedEndAt" label="计划结束日期">
            <Input type="date" />
          </Form.Item>
          <Form.Item name="managerName" label="项目负责人">
            <Input />
          </Form.Item>
          <Form.Item
            name="managerPhone"
            label="负责人手机号"
            rules={[{ pattern: /^1\d{10}$/, message: "请输入 11 位手机号" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="responsibleOrganizationId"
            label="管理责任实体"
            rules={[{ required: true }]}
          >
            <Select
              options={(organizations.data ?? [])
                .filter(
                  (o) =>
                    o.type === "business_entity" &&
                    (companyAdmin || managedOrganizationIds.includes(o.id)),
                )
                .map((o) => ({ value: o.id, label: o.name }))}
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={projectCreate.isPending}
          >
            创建
          </Button>
        </Form>
      </Modal>
      <Modal
        title={`${memberProject?.name ?? "项目"} · 成员`}
        open={!!memberProject}
        footer={null}
        onCancel={() => setMemberProject(undefined)}
      >
        <Form
          layout="inline"
          onFinish={async (v: { personIds: string[] }) => {
            const result = await api<{ summary: { added: number; skipped: number; failed: number } }>(
              `/api/projects/${memberProject!.id}/members/bulk`,
              json("POST", v),
            );
            message.success(`新增 ${result.summary.added} 人，跳过 ${result.summary.skipped} 人，失败 ${result.summary.failed} 人`);
            void members.refetch();
            void qc.invalidateQueries({ queryKey: ["projects"] });
          }}
        >
          <Form.Item name="personIds" rules={[{ required: true }]}>
            <Select
              mode="multiple"
              maxTagCount="responsive"
              style={{ width: 320 }}
              placeholder="选择一名或多名人员"
              options={(people.data ?? [])
                .filter(
                  (p) =>
                    p.status === "active" &&
                    p.organizations.some(
                      (item) =>
                        item.primary &&
                        item.organization.type === "business_entity",
                    ),
                )
                .map((p) => ({ value: p.id, label: p.name }))}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            批量加入项目
          </Button>
        </Form>
        <Table
          style={{ marginTop: 16 }}
          rowKey="id"
          pagination={false}
          dataSource={members.data}
          columns={[
            {
              title: "姓名",
              render: (
                _: unknown,
                row: { id: string; status: string; person: Person },
              ) => row.person.name,
            },
            {
              title: "状态",
              dataIndex: "status",
              render: (v: string) => labels[v] ?? v,
            },
            {
              title: "审核",
              render: (
                _: unknown,
                row: { id: string; status: string; person: Person },
              ) =>
                row.status === "pending" ? (
                  <Space>
                    <Button
                      type="primary"
                      size="small"
                      onClick={async () => {
                        await api(
                          `/api/project-members/${row.id}/review`,
                          json("PATCH", { status: "active" }),
                        );
                        void members.refetch();
                      }}
                    >
                      通过
                    </Button>
                    <Button
                      danger
                      size="small"
                      onClick={async () => {
                        await api(
                          `/api/project-members/${row.id}/review`,
                          json("PATCH", {
                            status: "rejected",
                            note: "不符合当前项目关系",
                          }),
                        );
                        void members.refetch();
                      }}
                    >
                      驳回
                    </Button>
                  </Space>
                ) : null,
            },
          ]}
        />
      </Modal>
    </>
  );
}

const platformModules = [
  {
    title: "培训教育",
    description: "人员学习、考试、签字与培训档案",
    path: "/training-dashboard",
    icon: <DashboardOutlined />,
    tone: "blue",
  },
  {
    title: "野外项目报送",
    description: "按项目、月份填报安全生产月报",
    path: "/monthly-reports",
    icon: <CalendarOutlined />,
    tone: "green",
  },
  {
    title: "资质证照管理",
    description: "人员证书、单位资质与到期时间",
    path: "/qualifications",
    icon: <SafetyCertificateOutlined />,
    tone: "orange",
  },
  {
    title: "安全责任制",
    description: "岗位安全职责与责任落实记录",
    path: null,
    icon: <TeamOutlined />,
    tone: "purple",
  },
  {
    title: "风险分级管控",
    description: "风险辨识、分级和管控措施",
    path: null,
    icon: <LineChartOutlined />,
    tone: "cyan",
  },
  {
    title: "隐患排查治理",
    description: "隐患登记、整改和复查记录",
    path: null,
    icon: <SearchOutlined />,
    tone: "indigo",
  },
  {
    title: "安全检查",
    description: "日常检查、专项检查与检查记录",
    path: null,
    icon: <FileDoneOutlined />,
    tone: "red",
  },
  {
    title: "应急管理",
    description: "预案、演练和应急处置记录",
    path: null,
    icon: <ScheduleOutlined />,
    tone: "teal",
  },
  {
    title: "事故事件管理",
    description: "事故、未遂事件和调查记录",
    path: null,
    icon: <SettingOutlined />,
    tone: "slate",
  },
] as const;

function PlatformPortal() {
  const navigate = useNavigate();
  return (
    <>
      <div className="portal-heading">
        <Typography.Text className="portal-eyebrow">
          物化院有限公司
        </Typography.Text>
        <Typography.Title level={2}>安全生产管理平台</Typography.Title>
        <Typography.Paragraph type="secondary">
          请选择需要进入的业务模块
        </Typography.Paragraph>
      </div>
      <div className="module-grid">
        {platformModules.map((item) => (
          <button
            type="button"
            className={`module-card module-${item.tone}${item.path ? "" : " module-planned"}`}
            key={item.title}
            onClick={() =>
              item.path
                ? navigate(item.path)
                : message.info(`${item.title}暂定为后续模块，功能尚未启用`)
            }
          >
            <span className="module-icon">{item.icon}</span>
            <span className="module-title">{item.title}</span>
            <span className="module-description">{item.description}</span>
            <span className="module-enter">
              {item.path ? "进入模块 ›" : "待规划"}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function Shell({ principal }: { principal: Principal }) {
  const navigate = useNavigate();
  const location = useLocation();
  const wechatWeb = useQuery({ queryKey: ["wechat-web-config"], queryFn: () => api<{ enabled: boolean }>("/api/auth/wechat-web/config") });
  const [passwordOpen, setPasswordOpen] = useState(false);
  const selected = useMemo(
    () =>
      location.pathname === "/" ? "/" : `/${location.pathname.split("/")[1]}`,
    [location.pathname],
  );
  const sidebarItems = useMemo(
    () => moduleMenuItems(location.pathname),
    [location.pathname],
  );
  const workspaceTitle =
    location.pathname === "/"
      ? "安全生产管理平台"
      : location.pathname.startsWith("/monthly-reports")
        ? "野外项目报送"
        : location.pathname.startsWith("/qualifications")
          ? "资质证照管理"
          : "培训教育";
  return (
    <>
      <Layout className="app-shell">
        <Layout.Sider
          width={228}
          breakpoint="lg"
          collapsedWidth="0"
          theme="light"
        >
          <div className="brand">
            <div className="brand-mark">安</div>
            <div className="brand-copy">
              物化院<small>{workspaceTitle}</small>
            </div>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[selected]}
            items={sidebarItems}
            onClick={({ key }) => navigate(key)}
          />
        </Layout.Sider>
        <Layout>
          <Layout.Header className="topbar">
            <span className="topbar-title">{workspaceTitle}</span>
            <Space>
              <Tag>
                {principal.roles
                  .map((r) => labels[r.role] ?? r.role)
                  .join(" / ") || "无角色"}
              </Tag>
              <Button onClick={() => setPasswordOpen(true)}>修改密码</Button>
              {wechatWeb.data?.enabled && <Button icon={<WechatOutlined />} href="/api/auth/wechat-web/bind/start">绑定网页登录微信</Button>}
              <Button
                onClick={async () => {
                  await api("/api/auth/logout", { method: "POST" });
                  navigate("/login");
                }}
              >
                退出
              </Button>
            </Space>
          </Layout.Header>
          <Layout.Content className="content">
            <Routes>
              <Route path="/" element={<PlatformPortal />} />
              <Route path="/training-dashboard" element={<DashboardPage />} />
              <Route
                path="/people"
                element={<People principal={principal} />}
              />
              <Route
                path="/organization"
                element={<OrganizationProjects principal={principal} />}
              />
              <Route path="/courseware" element={<CoursewarePage />} />
              <Route path="/questions" element={<QuestionsPage />} />
              <Route path="/training" element={<TrainingPage />} />
              <Route path="/records" element={<RecordsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/monthly-reports" element={<MonthlyReportsPage />} />
              <Route
                path="/qualifications"
                element={
                  <QualificationsPage
                    canWrite={principal.roles.some(
                      (role) => role.role === "company_admin",
                    )}
                  />
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout.Content>
        </Layout>
      </Layout>
      <Modal
        title="修改密码"
        open={passwordOpen}
        footer={null}
        onCancel={() => setPasswordOpen(false)}
        destroyOnClose
      >
        <Form
          layout="vertical"
          onFinish={async (values) => {
            try {
              await api("/api/auth/change-password", json("POST", values));
              message.success("密码已修改，请重新登录");
              setPasswordOpen(false);
              navigate("/login");
            } catch (error) {
              message.error((error as Error).message);
            }
          }}
        >
          <Form.Item
            name="currentPassword"
            label="当前密码"
            rules={[{ required: true }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[{ required: true, min: 12 }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={["newPassword"]}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  value === getFieldValue("newPassword")
                    ? Promise.resolve()
                    : Promise.reject(new Error("两次输入的密码不一致")),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            确认修改
          </Button>
        </Form>
      </Modal>
    </>
  );
}

function RequiredPasswordChange() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-shell">
      <Card className="login-card" title="首次登录请修改临时密码">
        <Alert type="warning" showIcon message="完成修改前不能进入管理后台。修改成功后请使用新密码重新登录。" style={{ marginBottom: 16 }} />
        <Form
          layout="vertical"
          onFinish={async (values: { currentPassword: string; newPassword: string }) => {
            setBusy(true);
            try {
              await api("/api/auth/change-password", json("POST", values));
              message.success("密码已修改，请重新登录");
              window.location.assign("/login");
            } catch (error) {
              message.error((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Form.Item name="currentPassword" label="当前临时密码" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 12, max: 128 }]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Form.Item name="confirmPassword" label="确认新密码" dependencies={["newPassword"]} rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, value) => value === getFieldValue("newPassword") ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致")) })]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Button block type="primary" htmlType="submit" loading={busy}>确认修改</Button>
        </Form>
      </Card>
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const principal = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Principal>("/api/auth/me"),
    retry: false,
  });
  if (location.pathname === "/login") return <Login />;
  if (principal.isLoading) return <div className="center">正在加载…</div>;
  if (principal.isError) return <Navigate to="/login" replace />;
  if (principal.data!.mustChangePassword) return <AntApp><RequiredPasswordChange /></AntApp>;
  return (
    <AntApp>
      <Shell principal={principal.data!} />
    </AntApp>
  );
}
