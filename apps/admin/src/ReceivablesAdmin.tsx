import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Form, Input, InputNumber, message, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "./api";
import { normalizeReceivablesGrantDraft, preserveReceivablesConflictDraft, receivablesErrorKind, receivablesQueryKey, receivablesReferenceCategories, receivablesScopeQueryPrefix, receivablesScopedQueryKey, usableReceivablesData, type ReceivablesAccess, type ReceivablesDepartment, type ReceivablesDictionaryOption, type ReceivablesGrant, type ReceivablesGrantCandidate } from "./receivables-types";

type Section = "grants" | "departments" | "dictionaries";
type MigrationPreview = { sourceId: string; targetId: string; impactCount: number; token: string; expiresAt: string };
type AdminRow = ReceivablesGrant | ReceivablesDepartment | ReceivablesDictionaryOption;

const roleLabels = { admin: "财务管理员", reporter: "报账员", readonly: "只读人员" } as const;

export function ReceivablesAdmin({ accountId, scopeFingerprint, access, section }: { accountId: string; scopeFingerprint: string; access: ReceivablesAccess; section: Section }) {
  const qc = useQueryClient();
  const [editor, setEditor] = useState<ReceivablesGrant | ReceivablesDepartment | ReceivablesDictionaryOption | "create">();
  const [migration, setMigration] = useState<MigrationPreview>();
  const [migrationConflict, setMigrationConflict] = useState<ReturnType<typeof preserveReceivablesConflictDraft<MigrationPreview, MigrationPreview>>>();
  const [conflict, setConflict] = useState<ReturnType<typeof preserveReceivablesConflictDraft<Record<string, unknown>, AdminRow>>>();
  const [deactivateTarget, setDeactivateTarget] = useState<AdminRow>();
  const [deactivateReason, setDeactivateReason] = useState("");
  const [deactivateReconfirm, setDeactivateReconfirm] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [form] = Form.useForm();
  const [migrationForm] = Form.useForm();
  const allowed = section === "grants" ? access.canManageAccess : access.canManageConfiguration;
  const baseKey = receivablesScopedQueryKey(accountId, scopeFingerprint, `admin-${section}`);
  const path = section === "grants" ? "/api/receivables/grants" : section === "departments" ? "/api/receivables/departments" : "/api/receivables/dictionary-options";
  const rows = useQuery({ queryKey: baseKey, queryFn: () => api<Array<ReceivablesGrant | ReceivablesDepartment | ReceivablesDictionaryOption>>(path), enabled: allowed, retry: false });
  const departments = useQuery({ queryKey: receivablesScopedQueryKey(accountId, scopeFingerprint, "admin-departments"), queryFn: () => api<ReceivablesDepartment[]>("/api/receivables/departments"), enabled: allowed && section !== "departments", retry: false });
  const candidates = useQuery({ queryKey: receivablesScopedQueryKey(accountId, scopeFingerprint, "grant-candidates", candidateSearch), queryFn: () => api<ReceivablesGrantCandidate[]>(`/api/receivables/grant-candidates?search=${encodeURIComponent(candidateSearch.trim())}`), enabled: access.canManageAccess && section === "grants" && editor === "create" && candidateSearch.trim().length >= 2, retry: false });
  const currentRows = usableReceivablesData(rows);
  const currentDepartments = usableReceivablesData(departments) ?? [];
  const currentCandidates = usableReceivablesData(candidates) ?? [];
  const activeTargets = useMemo(() => ((section === "departments" || section === "dictionaries" ? (currentRows ?? []) : currentDepartments) as Array<ReceivablesDepartment | ReceivablesDictionaryOption>).filter((row) => row.active), [currentDepartments, currentRows, section]);

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: baseKey }),
      qc.invalidateQueries({ queryKey: receivablesQueryKey(accountId, "access") }),
      qc.invalidateQueries({ queryKey: receivablesScopeQueryPrefix(accountId, scopeFingerprint) }),
    ]);
  };
  const fail = (error: Error) => {
    message.error(error.message);
    if (receivablesErrorKind(error) === "revoked") {
      setEditor(undefined); setMigration(undefined); setMigrationConflict(undefined); setDeactivateTarget(undefined); setConflict(undefined); qc.removeQueries({ queryKey: receivablesScopeQueryPrefix(accountId, scopeFingerprint) }); void qc.invalidateQueries({ queryKey: receivablesQueryKey(accountId, "access") });
    }
  };
  useEffect(() => { const error = rows.error ?? departments.error ?? candidates.error; if (error && receivablesErrorKind(error) === "revoked") fail(error); }, [rows.error, departments.error, candidates.error]);
  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      if (section === "grants") {
        const role = values.role as ReceivablesGrant["role"];
        const normalized = normalizeReceivablesGrantDraft(role, { canCreate: !!values.canCreate, canExport: !!values.canExport, canViewAll: !!values.canViewAll, canMaintainCollection: !!values.canMaintainCollection, departments: (values.departmentScopes as Array<{ departmentId: string; canRead: boolean; canWrite: boolean }> | undefined) ?? [] });
        const body = { ...(editor === "create" ? { accountId: values.accountId } : {}), role, ...normalized, departments: normalized.departments.filter((item) => item.canRead || item.canWrite), reason: values.reason, ...(editor !== "create" ? { revision: (editor as ReceivablesGrant).revision } : {}) };
        return api(editor === "create" ? path : `${path}/${(editor as ReceivablesGrant).id}`, json(editor === "create" ? "POST" : "PATCH", body));
      }
      if (section === "departments") {
        const body = { name: values.name, code: values.code || null, sortOrder: values.sortOrder ?? 0, ...(editor !== "create" ? { revision: (editor as ReceivablesDepartment).revision, reason: values.reason } : {}) };
        return api(editor === "create" ? path : `${path}/${(editor as ReceivablesDepartment).id}`, json(editor === "create" ? "POST" : "PATCH", body));
      }
      const body = { ...(editor === "create" ? { category: values.category } : {}), value: values.value, sortOrder: values.sortOrder ?? 0, ...(editor !== "create" ? { revision: (editor as ReceivablesDictionaryOption).revision, reason: values.reason } : {}) };
      return api(editor === "create" ? path : `${path}/${(editor as ReceivablesDictionaryOption).id}`, json(editor === "create" ? "POST" : "PATCH", body));
    },
    onSuccess: async () => { message.success(editor === "create" ? "已创建" : "已保存"); setEditor(undefined); setConflict(undefined); form.resetFields(); await invalidate(); },
    onError: async (error: Error) => {
      if (receivablesErrorKind(error) === "revision_conflict" && editor && editor !== "create") {
        const draft = form.getFieldsValue(true) as Record<string, unknown>;
        const refreshed = await rows.refetch();
        const latest = refreshed.data?.find((row) => row.id === editor.id);
        if (latest) { setEditor(latest); setConflict(preserveReceivablesConflictDraft(draft, latest)); form.setFieldsValue({ ...draft, conflictReconfirm: false }); }
      }
      fail(error);
    },
  });
  const deactivate = async () => {
    const row = deactivateTarget!;
    if (!deactivateReason.trim()) return message.error("请填写原因");
    if (conflict && !deactivateReconfirm) return message.error("请核对服务端最新值并再次确认");
    const body = section === "grants" ? { revision: row.revision, revoke: true, reason: deactivateReason } : { revision: row.revision, active: false, reason: deactivateReason };
    try { await api(`${path}/${row.id}`, json("PATCH", body)); message.success(section === "grants" ? "授权已撤销" : "配置项已停用"); closeDeactivate(); await invalidate(); }
    catch (error) {
      if (receivablesErrorKind(error) === "revision_conflict") {
        const refreshed = await rows.refetch(); const latest = refreshed.data?.find((item) => item.id === row.id);
        if (latest) { setDeactivateTarget(latest); setConflict(preserveReceivablesConflictDraft({ reason: deactivateReason }, latest)); setDeactivateReconfirm(false); }
      }
      fail(error as Error);
    }
  };
  const previewMigration = async (sourceId: string, targetId: string) => {
    try {
      const preview = await api<{ impactCount: number; token: string; expiresAt: string }>(`${path}/${sourceId}/migrate`, json("POST", { mode: "preview", targetId }));
      setMigration({ sourceId, targetId, ...preview }); setMigrationConflict(undefined); migrationForm.resetFields();
    } catch (error) { fail(error as Error); }
  };
  const applyMigration = useMutation({ mutationFn: (values: { reason: string; confirm: boolean; reconfirm?: boolean }) => api<{ impactCount: number }>(`${path}/${migration!.sourceId}/migrate`, json("POST", { mode: "apply", targetId: migration!.targetId, token: migration!.token, reason: values.reason, confirm: true })), onSuccess: async (result) => { message.success(`迁移完成，共更新 ${result.impactCount} 条引用`); closeMigration(); await invalidate(); }, onError: async (error: Error) => {
    if (receivablesErrorKind(error) === "stale" && migration) {
      try {
        const old = migration; const latest = await api<{ impactCount: number; token: string; expiresAt: string }>(`${path}/${migration.sourceId}/migrate`, json("POST", { mode: "preview", targetId: migration.targetId }));
        const fresh = { ...migration, ...latest }; setMigration(fresh); setMigrationConflict(preserveReceivablesConflictDraft(old, fresh)); migrationForm.setFieldValue("reconfirm", false);
      } catch (refreshError) { fail(refreshError as Error); return; }
    }
    fail(error);
  } });

  if (!allowed) return <Alert type="error" showIcon message="当前账号没有此项管理权限" />;
  const title = section === "grants" ? "账号与权限" : section === "departments" ? "财务归属部门" : "业务字典";
  const roleOptions = Object.entries(roleLabels).filter(([role]) => access.role === "owner" ? role === "admin" : role !== "admin").map(([value, label]) => ({ value, label }));
  const changeGrantRole = (role: ReceivablesGrant["role"]) => {
    const currentScopes = (form.getFieldValue("departmentScopes") as Array<{ departmentId: string; canRead: boolean; canWrite: boolean }> | undefined) ?? [];
    const selectableScopes = currentScopes.length || role === "admin" ? currentScopes : currentDepartments.filter((item) => item.active).map((item) => ({ departmentId: item.id, canRead: false, canWrite: false }));
    const normalized = normalizeReceivablesGrantDraft(role, {
      canCreate: !!form.getFieldValue("canCreate"), canExport: !!form.getFieldValue("canExport"), canViewAll: !!form.getFieldValue("canViewAll"), canMaintainCollection: !!form.getFieldValue("canMaintainCollection"),
      departments: selectableScopes,
    });
    form.setFieldsValue({ role, ...normalized, departmentScopes: normalized.departments });
  };
  const openEditor = (row?: ReceivablesGrant | ReceivablesDepartment | ReceivablesDictionaryOption) => {
    setEditor(row ?? "create");
    setConflict(undefined);
    const emptyScopes = currentDepartments.filter((item) => item.active).map((item) => ({ departmentId: item.id, canRead: false, canWrite: false }));
    if (!row) { form.resetFields(); if (section === "grants") form.setFieldsValue({ accountId: undefined, role: undefined, canCreate: false, canExport: false, canViewAll: false, canMaintainCollection: false, departmentScopes: emptyScopes, reason: undefined }); }
    else if (section === "grants") { const grant = row as ReceivablesGrant; const normalized = normalizeReceivablesGrantDraft(grant.role, { canCreate: grant.canCreate, canExport: grant.canExport, canViewAll: grant.canViewAll, canMaintainCollection: grant.canMaintainCollection, departments: emptyScopes.map((scope) => { const existing = grant.departments.find((item) => item.financeDepartmentId === scope.departmentId); return { ...scope, canRead: !!existing?.canRead, canWrite: !!existing?.canWrite }; }) }); form.setFieldsValue({ ...grant, ...normalized, departmentScopes: grant.role === "admin" ? [] : normalized.departments }); }
    else form.setFieldsValue(row);
  };
  const submitEditor = async (values: Record<string, unknown>) => {
    if (section !== "dictionaries" || editor === "create" || !editor || String(values.value).trim() === (editor as ReceivablesDictionaryOption).value) {
      save.mutate(values);
      return;
    }
    const option = editor as ReceivablesDictionaryOption;
    const value = String(values.value).trim();
    const reason = String(values.reason ?? "").trim();
    try {
      const preview = await api<{ impactCount: number; token: string; expiresAt: string }>(`${path}/${option.id}/rename`, json("POST", { mode: "preview", value }));
      Modal.confirm({
        title: "确认同步改名",
        content: `“${option.value}”将改为“${value}”，并同步更新 ${preview.impactCount} 条引用。`,
        okText: "确认改名",
        cancelText: "取消",
        onOk: async () => {
          try {
            await api(`${path}/${option.id}/rename`, json("POST", { mode: "apply", value, token: preview.token, reason, confirm: true }));
            if (Number(values.sortOrder ?? 0) !== option.sortOrder) await api(`${path}/${option.id}`, json("PATCH", { revision: option.revision + 1, sortOrder: values.sortOrder ?? 0, reason }));
            message.success(`改名完成，共更新 ${preview.impactCount} 条引用`);
            setEditor(undefined); setConflict(undefined); form.resetFields(); await invalidate();
          } catch (error) { fail(error as Error); throw error; }
        },
      });
    } catch (error) { fail(error as Error); }
  };
  const closeEditor = () => { setEditor(undefined); setConflict(undefined); form.resetFields(); };
  const closeDeactivate = () => { setDeactivateTarget(undefined); setDeactivateReason(""); setDeactivateReconfirm(false); setConflict(undefined); };
  const closeMigration = () => { setMigration(undefined); setMigrationConflict(undefined); migrationForm.resetFields(); };
  return <div className="receivables-page">
    <div className="page-title receivables-page-title"><div><Typography.Title level={3}>{title}</Typography.Title><Typography.Text type="secondary">所有变更均以服务端权限、修订号和审计原因校验。</Typography.Text></div><Button type="primary" onClick={() => openEditor()}>新建</Button></div>
    {rows.isFetching && <Card loading />}
    {rows.isError && <Alert type="error" showIcon message="数据加载失败，已隐藏缓存内容" action={<Button onClick={() => void rows.refetch()}>重试</Button>} />}
    {currentRows && <Table size="small" rowKey="id" dataSource={currentRows} scroll={{ x: "max-content" }} columns={[
      { title: section === "grants" ? "账号" : section === "departments" ? "名称" : "分类 / 值", render: (_: unknown, row) => section === "grants" ? (row as ReceivablesGrant).accountId : section === "departments" ? (row as ReceivablesDepartment).name : `${(row as ReceivablesDictionaryOption).category} / ${(row as ReceivablesDictionaryOption).value}` },
      { title: "权限 / 状态", render: (_: unknown, row) => section === "grants" ? <Space><Tag>{roleLabels[(row as ReceivablesGrant).role]}</Tag><Tag color={(row as ReceivablesGrant).active ? "green" : "default"}>{(row as ReceivablesGrant).active ? "有效" : "已撤销"}</Tag></Space> : <Tag color={(row as ReceivablesDepartment | ReceivablesDictionaryOption).active ? "green" : "default"}>{(row as ReceivablesDepartment | ReceivablesDictionaryOption).active ? "启用" : "停用"}</Tag> },
      { title: "修订", dataIndex: "revision", width: 80 },
      { title: "操作", render: (_: unknown, row) => { const grantRole = section === "grants" ? (row as ReceivablesGrant).role : null; const lockedGrant = section === "grants" && (access.role === "owner" ? grantRole !== "admin" : grantRole === "admin"); const lockedTitle = lockedGrant ? access.role === "owner" ? "报账员和只读授权由财务管理员管理" : "只有财务资产部负责人可以管理财务管理员" : undefined; return <Space><Button size="small" title={lockedTitle} disabled={("active" in row && !row.active) || lockedGrant} onClick={() => openEditor(row)}>编辑</Button><Button size="small" danger title={lockedTitle} disabled={("active" in row && !row.active) || lockedGrant} onClick={() => { setDeactivateTarget(row); setDeactivateReason(""); setDeactivateReconfirm(false); setConflict(undefined); }}>{section === "grants" ? "撤销" : "停用"}</Button>{section !== "grants" && !(row as ReceivablesDepartment | ReceivablesDictionaryOption).active && access.canManageAccess && <Select aria-label="迁移目标" placeholder="迁移到…" style={{ width: 170 }} options={activeTargets.filter((item) => item.id !== row.id && (section !== "dictionaries" || (item as ReceivablesDictionaryOption).category === (row as ReceivablesDictionaryOption).category)).map((item) => ({ value: item.id, label: "name" in item ? item.name : item.value }))} onChange={(targetId) => void previewMigration(row.id, targetId)} />}</Space>; } },
    ]} />}
    <Modal title={`${editor === "create" ? "新建" : "编辑"}${title}`} open={!!editor} footer={null} destroyOnClose onCancel={closeEditor}>
      <Form form={form} layout="vertical" onFinish={(values) => void submitEditor(values)}>
        {section === "grants" && <><Form.Item name="accountId" label="财务候选账号" rules={[{ required: true }]} extra={editor === "create" ? "输入姓名或用户名至少 2 个字符；仅显示全公司有效账号及人员。" : undefined}><Select showSearch filterOption={false} disabled={editor !== "create"} onSearch={setCandidateSearch} notFoundContent={candidates.isFetching ? "搜索中…" : candidates.isError ? "搜索失败，已关闭候选数据" : "请输入至少 2 个字符"} options={currentCandidates.map((item) => ({ value: item.accountId, disabled: item.hasActiveGrant, label: `${item.name} · ${item.username ?? "无用户名"}${item.hasActiveGrant ? "（已有授权）" : ""}` }))} /></Form.Item><Form.Item name="role" label="角色" rules={[{ required: true }]}><Select onChange={changeGrantRole} options={roleOptions} /></Form.Item><Form.Item noStyle shouldUpdate>{({ getFieldValue, setFieldValue }) => getFieldValue("role") !== "admin" && <Form.List name="departmentScopes">{(fields) => <Space direction="vertical" style={{ width: "100%" }}>{fields.map((field, index) => { const department = currentDepartments.filter((item) => item.active)[index]; return <Space key={field.key}><Form.Item name={[field.name, "departmentId"]} hidden><Input /></Form.Item><Typography.Text style={{ width: 160 }}>{department?.name}</Typography.Text><Form.Item name={[field.name, "canRead"]} valuePropName="checked"><Checkbox>可读</Checkbox></Form.Item><Form.Item name={[field.name, "canWrite"]} valuePropName="checked"><Checkbox disabled={getFieldValue("role") === "readonly"} onChange={(event) => { if (event.target.checked) setFieldValue(["departmentScopes", index, "canRead"], true); }}>可写</Checkbox></Form.Item></Space>; })}</Space>}</Form.List>}</Form.Item><Form.Item noStyle shouldUpdate>{({ getFieldValue }) => { const role = getFieldValue("role") as ReceivablesGrant["role"] | undefined; return role && role !== "admin" ? <Space wrap>{role === "reporter" && <><Form.Item name="canCreate" valuePropName="checked"><Checkbox>允许新建台账</Checkbox></Form.Item><Form.Item name="canMaintainCollection" valuePropName="checked"><Checkbox>允许维护催收进展和上传附件</Checkbox></Form.Item></>}<Form.Item name="canExport" valuePropName="checked"><Checkbox>允许导出</Checkbox></Form.Item><Form.Item name="canViewAll" valuePropName="checked"><Checkbox>允许查看全部部门</Checkbox></Form.Item></Space> : null; }}</Form.Item><Form.Item name="reason" label="变更原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea /></Form.Item></>}
        {section === "departments" && <><Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item><Form.Item name="code" label="代码"><Input /></Form.Item><Form.Item name="sortOrder" label="排序"><InputNumber precision={0} /></Form.Item>{editor !== "create" && <Form.Item name="reason" label="变更原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea /></Form.Item>}</>}
        {section === "dictionaries" && <><Form.Item name="category" label="分类" rules={[{ required: true }]}><Select showSearch disabled={editor !== "create"} options={receivablesReferenceCategories.map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="value" label="值" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item><Form.Item name="sortOrder" label="排序"><InputNumber precision={0} /></Form.Item>{editor !== "create" && <Form.Item name="reason" label="变更原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea /></Form.Item>}</>}
        {conflict && editor && <><Alert type="warning" showIcon message="服务端数据已变化" description={<pre style={{ whiteSpace: "pre-wrap" }}>{`本地草稿：${JSON.stringify(conflict.draft)}\n服务端最新值：${JSON.stringify(conflict.latest)}`}</pre>} /><Form.Item name="conflictReconfirm" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请核对并再次确认")) }]}><Checkbox>我已核对最新值，使用最新修订号重试</Checkbox></Form.Item></>}
        <Space className="receivables-form-actions"><Button htmlType="button" onClick={closeEditor}>取消</Button><Button type="primary" htmlType="submit" loading={save.isPending}>保存</Button></Space>
      </Form>
    </Modal>
    <Modal title={section === "grants" ? "撤销财务授权" : "停用配置项"} open={!!deactivateTarget} onCancel={closeDeactivate} onOk={() => void deactivate()} okButtonProps={{ danger: true }}><Input.TextArea value={deactivateReason} onChange={(event) => setDeactivateReason(event.target.value)} placeholder="请输入原因" />{conflict && <><Alert style={{ marginTop: 12 }} type="warning" showIcon message="服务端数据已变化，请核对最新值" description={<pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(conflict.latest)}</pre>} /><Checkbox checked={deactivateReconfirm} onChange={(event) => setDeactivateReconfirm(event.target.checked)}>使用最新修订号再次确认</Checkbox></>}</Modal>
    <Modal title="迁移引用" open={!!migration} footer={null} destroyOnClose onCancel={closeMigration}>{migration && <><Alert type="warning" showIcon message={`将迁移 ${migration.impactCount} 条引用`} description={`预览有效期至 ${new Date(migration.expiresAt).toLocaleString()}。应用前服务端会再次验证源项、目标项和影响集合。`} />{migrationConflict && <Alert type="warning" showIcon message="旧预览令牌已作废" description={`旧影响 ${migrationConflict.draft.impactCount} 条；最新影响 ${migrationConflict.latest.impactCount} 条。请重新确认。`} />}<Form form={migrationForm} layout="vertical" onFinish={(values) => applyMigration.mutate(values)}><Form.Item name="reason" label="迁移原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea /></Form.Item><Form.Item name={migrationConflict ? "reconfirm" : "confirm"} valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请确认迁移影响")) }]}><Checkbox>我已核对最新影响数量并确认迁移</Checkbox></Form.Item><Space className="receivables-form-actions"><Button htmlType="button" onClick={closeMigration}>取消</Button><Button type="primary" danger htmlType="submit" loading={applyMigration.isPending}>确认应用迁移</Button></Space></Form></>}</Modal>
  </div>;
}
