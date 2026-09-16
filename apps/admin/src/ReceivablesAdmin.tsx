import { useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Form, Input, InputNumber, message, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "./api";
import { receivablesErrorKind, receivablesQueryKey, receivablesScopedQueryKey, usableReceivablesData, type ReceivablesAccess, type ReceivablesDepartment, type ReceivablesDictionaryOption, type ReceivablesGrant } from "./receivables-types";

type Section = "grants" | "departments" | "dictionaries";
type AccountOption = { id: string; username: string | null; person: { name: string } | null };
type MigrationPreview = { sourceId: string; targetId: string; impactCount: number; token: string; expiresAt: string };

const roleLabels = { admin: "财务管理员", reporter: "财务填报人", readonly: "只读人员" } as const;
const categories = ["customer_type", "creditor_unit", "work_nature", "sector", "project_status", "settlement_method", "debt_status"];

export function ReceivablesAdmin({ accountId, scopeFingerprint, access, section }: { accountId: string; scopeFingerprint: string; access: ReceivablesAccess; section: Section }) {
  const qc = useQueryClient();
  const [editor, setEditor] = useState<ReceivablesGrant | ReceivablesDepartment | ReceivablesDictionaryOption | "create">();
  const [migration, setMigration] = useState<MigrationPreview>();
  const [form] = Form.useForm();
  const allowed = section === "grants" ? access.canManageAccess : access.canManageConfiguration;
  const baseKey = receivablesScopedQueryKey(accountId, scopeFingerprint, `admin-${section}`);
  const path = section === "grants" ? "/api/receivables/grants" : section === "departments" ? "/api/receivables/departments" : "/api/receivables/dictionary-options";
  const rows = useQuery({ queryKey: baseKey, queryFn: () => api<Array<ReceivablesGrant | ReceivablesDepartment | ReceivablesDictionaryOption>>(path), enabled: allowed, retry: false });
  const departments = useQuery({ queryKey: receivablesScopedQueryKey(accountId, scopeFingerprint, "admin-departments"), queryFn: () => api<ReceivablesDepartment[]>("/api/receivables/departments"), enabled: allowed && section !== "departments", retry: false });
  const accounts = useQuery({ queryKey: ["receivables", accountId, scopeFingerprint, "grant-account-options"], queryFn: () => api<AccountOption[]>("/api/accounts"), enabled: access.canManageAccess && section === "grants", retry: false });
  const currentRows = usableReceivablesData(rows);
  const currentDepartments = usableReceivablesData(departments) ?? [];
  const activeTargets = useMemo(() => ((section === "departments" ? (currentRows ?? []) : currentDepartments) as Array<ReceivablesDepartment | ReceivablesDictionaryOption>).filter((row) => row.active), [currentDepartments, currentRows, section]);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: baseKey }),
      qc.invalidateQueries({ queryKey: receivablesQueryKey(accountId, "access") }),
      qc.invalidateQueries({ queryKey: ["receivables", accountId, scopeFingerprint] }),
    ]);
  };
  const fail = (error: Error) => {
    message.error(error.message);
    if (receivablesErrorKind(error) === "revoked") {
      setEditor(undefined); setMigration(undefined); qc.removeQueries({ queryKey: ["receivables", accountId, scopeFingerprint] }); void qc.invalidateQueries({ queryKey: receivablesQueryKey(accountId, "access") });
    } else if (receivablesErrorKind(error) === "conflict") void rows.refetch();
  };
  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      if (section === "grants") {
        const departmentsValue = (values.departments as string[] | undefined)?.map((departmentId) => ({ departmentId, canRead: true, canWrite: values.role === "reporter" })) ?? [];
        const body = { ...(editor === "create" ? { accountId: values.accountId } : {}), role: values.role, canCreate: !!values.canCreate, canExport: !!values.canExport, canViewAll: !!values.canViewAll, departments: values.role === "admin" ? [] : departmentsValue, reason: values.reason, ...(editor !== "create" ? { revision: (editor as ReceivablesGrant).revision } : {}) };
        return api(editor === "create" ? path : `${path}/${(editor as ReceivablesGrant).id}`, json(editor === "create" ? "POST" : "PATCH", body));
      }
      if (section === "departments") {
        const body = { name: values.name, code: values.code || null, sortOrder: values.sortOrder ?? 0, ...(editor !== "create" ? { revision: (editor as ReceivablesDepartment).revision, reason: values.reason } : {}) };
        return api(editor === "create" ? path : `${path}/${(editor as ReceivablesDepartment).id}`, json(editor === "create" ? "POST" : "PATCH", body));
      }
      const body = { ...(editor === "create" ? { category: values.category } : {}), value: values.value, sortOrder: values.sortOrder ?? 0, ...(editor !== "create" ? { revision: (editor as ReceivablesDictionaryOption).revision, reason: values.reason } : {}) };
      return api(editor === "create" ? path : `${path}/${(editor as ReceivablesDictionaryOption).id}`, json(editor === "create" ? "POST" : "PATCH", body));
    },
    onSuccess: async () => { message.success(editor === "create" ? "已创建" : "已保存"); setEditor(undefined); form.resetFields(); await invalidate(); },
    onError: fail,
  });
  const deactivate = (row: ReceivablesGrant | ReceivablesDepartment | ReceivablesDictionaryOption) => {
    let reason = "";
    Modal.confirm({ title: section === "grants" ? "撤销这项财务授权？" : "停用该配置项？", content: <Input.TextArea autoFocus placeholder="请输入原因" onChange={(event) => { reason = event.target.value; }} />, okText: "确认", okButtonProps: { danger: true }, onOk: async () => {
      if (!reason.trim()) throw new Error("请填写原因");
      const body = section === "grants" ? { revision: row.revision, revoke: true, reason } : { revision: row.revision, active: false, reason };
      try { await api(`${path}/${row.id}`, json("PATCH", body)); message.success(section === "grants" ? "授权已撤销" : "配置项已停用"); await invalidate(); } catch (error) { fail(error as Error); throw error; }
    } });
  };
  const previewMigration = async (sourceId: string, targetId: string) => {
    try {
      const preview = await api<{ impactCount: number; token: string; expiresAt: string }>(`${path}/${sourceId}/migrate`, json("POST", { mode: "preview", targetId }));
      setMigration({ sourceId, targetId, ...preview });
    } catch (error) { fail(error as Error); }
  };
  const applyMigration = useMutation({ mutationFn: (values: { reason: string; confirm: boolean }) => api<{ impactCount: number }>(`${path}/${migration!.sourceId}/migrate`, json("POST", { mode: "apply", targetId: migration!.targetId, token: migration!.token, reason: values.reason, confirm: true })), onSuccess: async (result) => { message.success(`迁移完成，共更新 ${result.impactCount} 条引用`); setMigration(undefined); await invalidate(); }, onError: fail });

  if (!allowed) return <Alert type="error" showIcon message="当前账号没有此项管理权限" />;
  const title = section === "grants" ? "财务授权" : section === "departments" ? "财务归属部门" : "业务字典";
  const openEditor = (row?: ReceivablesGrant | ReceivablesDepartment | ReceivablesDictionaryOption) => {
    setEditor(row ?? "create");
    if (!row) form.resetFields();
    else if (section === "grants") form.setFieldsValue({ ...row, departments: (row as ReceivablesGrant).departments.map((item) => item.financeDepartmentId) });
    else form.setFieldsValue(row);
  };
  return <div className="receivables-page">
    <div className="page-title receivables-page-title"><div><Typography.Title level={3}>{title}</Typography.Title><Typography.Text type="secondary">所有变更均以服务端权限、修订号和审计原因校验。</Typography.Text></div><Button type="primary" onClick={() => openEditor()}>新建</Button></div>
    {rows.isFetching && <Card loading />}
    {rows.isError && <Alert type="error" showIcon message="数据加载失败，已隐藏缓存内容" action={<Button onClick={() => void rows.refetch()}>重试</Button>} />}
    {currentRows && <Table rowKey="id" dataSource={currentRows} scroll={{ x: "max-content" }} columns={[
      { title: section === "grants" ? "账号" : section === "departments" ? "名称" : "分类 / 值", render: (_: unknown, row) => section === "grants" ? (accounts.data?.find((item) => item.id === (row as ReceivablesGrant).accountId)?.person?.name ?? (row as ReceivablesGrant).accountId) : section === "departments" ? (row as ReceivablesDepartment).name : `${(row as ReceivablesDictionaryOption).category} / ${(row as ReceivablesDictionaryOption).value}` },
      { title: "权限 / 状态", render: (_: unknown, row) => section === "grants" ? <Space><Tag>{roleLabels[(row as ReceivablesGrant).role]}</Tag><Tag color={(row as ReceivablesGrant).active ? "green" : "default"}>{(row as ReceivablesGrant).active ? "有效" : "已撤销"}</Tag></Space> : <Tag color={(row as ReceivablesDepartment | ReceivablesDictionaryOption).active ? "green" : "default"}>{(row as ReceivablesDepartment | ReceivablesDictionaryOption).active ? "启用" : "停用"}</Tag> },
      { title: "修订", dataIndex: "revision", width: 80 },
      { title: "操作", render: (_: unknown, row) => <Space><Button size="small" disabled={"active" in row && !row.active} onClick={() => openEditor(row)}>编辑</Button><Button size="small" danger disabled={"active" in row && !row.active} onClick={() => deactivate(row)}>{section === "grants" ? "撤销" : "停用"}</Button>{section !== "grants" && !(row as ReceivablesDepartment | ReceivablesDictionaryOption).active && access.canManageAccess && <Select aria-label="迁移目标" placeholder="迁移到…" style={{ width: 170 }} options={activeTargets.filter((item) => item.id !== row.id && (section !== "dictionaries" || (item as ReceivablesDictionaryOption).category === (row as ReceivablesDictionaryOption).category)).map((item) => ({ value: item.id, label: "name" in item ? item.name : item.value }))} onChange={(targetId) => void previewMigration(row.id, targetId)} />}</Space> },
    ]} />}
    <Modal title={`${editor === "create" ? "新建" : "编辑"}${title}`} open={!!editor} footer={null} destroyOnClose onCancel={() => setEditor(undefined)}>
      <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
        {section === "grants" && <><Form.Item name="accountId" label="已有主系统账号" rules={[{ required: true }]}><Select showSearch disabled={editor !== "create"} optionFilterProp="label" options={(accounts.data ?? []).map((item) => ({ value: item.id, label: `${item.person?.name ?? item.username ?? "未命名账号"} · ${item.id}` }))} /></Form.Item><Form.Item name="role" label="角色" rules={[{ required: true }]}><Select options={Object.entries(roleLabels).map(([value, label]) => ({ value, label }))} /></Form.Item><Form.Item noStyle shouldUpdate>{({ getFieldValue }) => getFieldValue("role") !== "admin" && <Form.Item name="departments" label="部门范围" rules={[{ required: true }]}><Select mode="multiple" options={currentDepartments.filter((item) => item.active).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>}</Form.Item><Space wrap><Form.Item name="canCreate" valuePropName="checked"><Checkbox>允许新建台账</Checkbox></Form.Item><Form.Item name="canExport" valuePropName="checked"><Checkbox>允许导出</Checkbox></Form.Item><Form.Item name="canViewAll" valuePropName="checked"><Checkbox>允许查看全部部门</Checkbox></Form.Item></Space><Form.Item name="reason" label="变更原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea /></Form.Item></>}
        {section === "departments" && <><Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item><Form.Item name="code" label="代码"><Input /></Form.Item><Form.Item name="sortOrder" label="排序"><InputNumber precision={0} /></Form.Item>{editor !== "create" && <Form.Item name="reason" label="变更原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea /></Form.Item>}</>}
        {section === "dictionaries" && <><Form.Item name="category" label="分类" rules={[{ required: true }]}><Select showSearch disabled={editor !== "create"} options={categories.map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="value" label="值" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item><Form.Item name="sortOrder" label="排序"><InputNumber precision={0} /></Form.Item>{editor !== "create" && <Form.Item name="reason" label="变更原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea /></Form.Item>}</>}
        <Space><Button onClick={() => setEditor(undefined)}>取消</Button><Button type="primary" htmlType="submit" loading={save.isPending}>保存</Button></Space>
      </Form>
    </Modal>
    <Modal title="迁移引用" open={!!migration} footer={null} destroyOnClose onCancel={() => setMigration(undefined)}>{migration && <><Alert type="warning" showIcon message={`将迁移 ${migration.impactCount} 条引用`} description={`预览有效期至 ${new Date(migration.expiresAt).toLocaleString()}。应用前服务端会再次验证源项、目标项和影响集合。`} /><Form layout="vertical" onFinish={(values) => applyMigration.mutate(values)}><Form.Item name="reason" label="迁移原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea /></Form.Item><Form.Item name="confirm" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请确认迁移影响")) }]}><Checkbox>我已核对影响数量并确认迁移</Checkbox></Form.Item><Button type="primary" danger htmlType="submit" loading={applyMigration.isPending}>确认应用迁移</Button></Form></>}</Modal>
  </div>;
}
