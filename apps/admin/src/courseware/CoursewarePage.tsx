import { UploadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, message, Modal, Select, Space, Table, Tabs, Tag, Typography, Upload } from "antd";
import type { UploadProps } from "antd";
import { useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
import { api, json } from "../api";
import { CoursewareEditor } from "./CoursewareEditor";
import { coursewareNavigationDecision, createEmptyCoursewareDocument, editorDismissalBlockMessage, replaceSavingEditorIfStillActive, validateCoursewareDocument, type StructuredCoursewareDocument } from "./types";

type Version = { id: string; version: number; status: string; structuredContent?: unknown };
type Courseware = { id: string; title: string; type: string; versions: Version[] };
type Template = { id: string; name: string; type: string; items: Array<{ coursewareVersion: { courseware: { title: string }; version: number } }> };
type Project = { id: string; name: string; status: string; responsibleOrganizationId?: string };
type Organization = { id: string; name: string; type: string };
type Principal = { roles: Array<{ role: string; scopeType: string; scopeId?: string | null }> };
type PublishGrant = { id: string; person: { id: string; name: string }; scopeType: "organization" | "project"; scopeId: string; createdAt: string };
type PersonOption = { id: string; name: string };
type CoursewareScope = { scopeType: "company" | "organization" | "project"; scopeId: string | null };
type EditorTarget = {
  mode: "create" | "edit";
  coursewareTitle: string;
  document: StructuredCoursewareDocument;
  scope?: CoursewareScope;
  coursewareId?: string;
  versionId?: string;
};

const typeNames: Record<string, string> = { three_level: "三级安全教育", project_induction: "项目入场教育", routine: "日常/年度培训", change_update: "变化内容培训" };
const trainingTypes = Object.entries(typeNames).map(([value, label]) => ({ value, label }));

function parseScopeKey(value: string): CoursewareScope {
  const [scopeType, scopeId] = value.split(":", 2) as [CoursewareScope["scopeType"], string?];
  return { scopeType, scopeId: scopeType === "company" ? null : scopeId ?? null };
}

export function CoursewarePage() {
  const qc = useQueryClient();
  const coursewares = useQuery({ queryKey: ["coursewares"], queryFn: () => api<Courseware[]>("/api/coursewares") });
  const templates = useQuery({ queryKey: ["training-templates"], queryFn: () => api<Template[]>("/api/training-templates") });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Principal>("/api/auth/me") });
  const companyAdmin = me.data?.roles.some(({ role }) => role === "company_admin") ?? false;
  const people = useQuery({ queryKey: ["persons"], queryFn: () => api<PersonOption[]>("/api/persons"), enabled: companyAdmin });
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: () => api<Organization[]>("/api/organizations") });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/api/projects") });
  const grants = useQuery({ queryKey: ["courseware-publish-grants"], queryFn: () => api<PublishGrant[]>("/api/courseware-publish-grants"), enabled: companyAdmin });

  const [courseOpen, setCourseOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantScopeType, setGrantScopeType] = useState<"organization" | "project">("organization");
  const [kind, setKind] = useState<"rich_text" | "single_html" | "structured">("rich_text");
  const [fileId, setFileId] = useState<string>();
  const [structuredEditor, setStructuredEditor] = useState<EditorTarget>();
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("course");
  const navigationConfirmOpen = useRef(false);
  const navigationDecision = coursewareNavigationDecision({ editorOpen: !!structuredEditor, dirty: editorDirty, saving: editorSaving });
  const blocker = useBlocker(navigationDecision !== "allow");

  const scopeOptions = [
    ...(companyAdmin ? [{ value: "company:", label: "全公司" }] : []),
    ...(organizations.data ?? []).filter((row) => ["department", "business_entity"].includes(row.type)).map((row) => ({ value: `organization:${row.id}`, label: `组织 · ${row.name}` })),
    ...(projects.data ?? []).map((row) => ({ value: `project:${row.id}`, label: `项目 · ${row.name}` }))
  ];

  const createCourse = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Courseware>("/api/coursewares", json("POST", body)),
    onSuccess: () => { setCourseOpen(false); message.success("课件草稿已创建"); void qc.invalidateQueries({ queryKey: ["coursewares"] }); },
    onError: (error) => message.error(error.message)
  });
  const createTemplate = useMutation({ mutationFn: (value: unknown) => api("/api/training-templates", json("POST", { scopeType: "company", scopeId: null, ...(value as object) })), onSuccess: () => { setTemplateOpen(false); void qc.invalidateQueries({ queryKey: ["training-templates"] }); }, onError: (error) => message.error(error.message) });
  const publishVersion = useMutation({
    mutationFn: (versionId: string) => api(`/api/courseware-versions/${versionId}/publish`, { method: "POST" }),
    onSuccess: () => { message.success("课件版本已发布"); void qc.invalidateQueries({ queryKey: ["coursewares"] }); },
    onError: (error) => message.error(`发布失败：${error.message}`)
  });
  const createVersion = useMutation({
    mutationFn: async ({ courseware, document }: { courseware: Courseware; version: Version; document: StructuredCoursewareDocument }) => ({
      courseware,
      version: await api<Version>(`/api/coursewares/${courseware.id}/versions`, json("POST", { structuredContent: document }))
    }),
    onSuccess: ({ courseware, version }) => {
      const parsed = validateCoursewareDocument(version.structuredContent);
      if (!parsed.success) { message.error("新草稿内容不符合当前结构化课件规范"); return; }
      setEditorDirty(false);
      setStructuredEditor({ mode: "edit", coursewareId: courseware.id, versionId: version.id, coursewareTitle: courseware.title, document: parsed.data });
      message.success("已从已发布内容创建新草稿版本");
      void qc.invalidateQueries({ queryKey: ["coursewares"] });
    },
    onError: (error) => message.error(`创建新版本失败：${error.message}`)
  });

  const upload: NonNullable<UploadProps["customRequest"]> = async ({ file, onSuccess, onError }) => { try { const body = new FormData(); body.append("file", file as Blob); const result = await api<{ id: string }>("/api/files?kind=courseware", { method: "POST", body }); setFileId(result.id); onSuccess?.(result); } catch (error) { onError?.(error as Error); } };
  const versionOptions = (coursewares.data ?? []).flatMap((courseware) => courseware.versions.filter((version) => version.status === "published").map((version) => ({ value: version.id, label: `${courseware.title} v${version.version}` })));

  const clearEditor = () => { setStructuredEditor(undefined); setEditorDirty(false); setEditorSaving(false); };
  const confirmDiscard = (after?: () => void) => {
    const blockedMessage = editorDismissalBlockMessage(editorSaving);
    if (blockedMessage) { message.info(blockedMessage); return; }
    const leave = () => { clearEditor(); after?.(); };
    if (!editorDirty) { leave(); return; }
    Modal.confirm({ title: "确认放弃未保存的修改？", content: "当前本地修改尚未保存，离开后无法恢复。", okText: "放弃修改", okButtonProps: { danger: true }, cancelText: "继续编辑", onOk: leave });
  };
  const switchTab = (key: string) => {
    if (structuredEditor) { confirmDiscard(() => setActiveTab(key)); return; }
    setActiveTab(key);
  };
  useEffect(() => {
    if (blocker.state !== "blocked") { navigationConfirmOpen.current = false; return; }
    const decision = coursewareNavigationDecision({ editorOpen: !!structuredEditor, dirty: editorDirty, saving: editorSaving });
    if (decision === "block_saving") {
      message.info(editorDismissalBlockMessage(true));
      blocker.reset();
      return;
    }
    if (decision === "confirm_discard") {
      if (navigationConfirmOpen.current) return;
      navigationConfirmOpen.current = true;
      Modal.confirm({
        title: "确认放弃未保存的修改？",
        content: "当前本地修改尚未保存，离开后无法恢复。",
        okText: "放弃修改并离开",
        okButtonProps: { danger: true },
        cancelText: "继续编辑",
        onOk: () => { navigationConfirmOpen.current = false; clearEditor(); blocker.proceed(); },
        onCancel: () => { navigationConfirmOpen.current = false; blocker.reset(); }
      });
      return;
    }
    blocker.proceed();
  }, [blocker, editorDirty, editorSaving, structuredEditor]);
  const editStructured = (courseware: Courseware, version: Version) => {
    const parsed = validateCoursewareDocument(version.structuredContent);
    if (!parsed.success) { message.error("该草稿内容不符合当前结构化课件规范，无法安全编辑"); return; }
    setEditorDirty(false);
    setStructuredEditor({ mode: "edit", coursewareId: courseware.id, versionId: version.id, coursewareTitle: courseware.title, document: parsed.data });
  };
  const newStructuredVersion = (courseware: Courseware, version: Version) => {
    const parsed = validateCoursewareDocument(version.structuredContent);
    if (!parsed.success) { message.error("该已发布版本不符合当前结构化课件规范，无法复制"); return; }
    createVersion.mutate({ courseware, version, document: parsed.data });
  };
  const saveStructured = async (document: StructuredCoursewareDocument) => {
    const savingEditor = structuredEditor;
    if (!savingEditor) return;
    if (savingEditor.mode === "create") {
      if (!savingEditor.scope) throw new Error("请选择课件适用范围");
      const created = await api<Courseware>("/api/coursewares", json("POST", { ...savingEditor.scope, title: savingEditor.coursewareTitle, type: "structured", structuredContent: { ...document, title: savingEditor.coursewareTitle } }));
      const version = created.versions[0];
      if (!version) throw new Error("草稿已创建，但未返回课件版本");
      const savedEditor: EditorTarget = { mode: "edit", coursewareId: created.id, versionId: version.id, coursewareTitle: created.title, document };
      setStructuredEditor((current) => replaceSavingEditorIfStillActive(current, savingEditor, savedEditor));
    } else {
      await api(`/api/courseware-versions/${savingEditor.versionId}/draft`, json("PUT", { structuredContent: { ...document, title: savingEditor.coursewareTitle } }));
    }
    message.success("结构化课件草稿已保存");
    void qc.invalidateQueries({ queryKey: ["coursewares"] });
  };

  const coursewareList = coursewares.isError
    ? <Alert type="error" showIcon message="课件列表加载失败" description={coursewares.error.message} action={<Button onClick={() => void coursewares.refetch()}>重新加载</Button>} />
    : <Table rowKey="id" loading={coursewares.isLoading || coursewares.isFetching} locale={{ emptyText: "暂无课件，点击“新建课件”开始制作" }} dataSource={coursewares.data ?? []} columns={[
      { title: "名称", dataIndex: "title" },
      { title: "类型", dataIndex: "type", render: (value: string) => ({ rich_text: "图文课件", single_html: "HTML 交互课件", structured: "结构化互动课件" })[value] ?? value },
      { title: "版本", render: (_: unknown, row: Courseware) => <Space wrap>{row.versions.map((version) => <Tag key={version.id} color={version.status === "published" ? "green" : "default"}>v{version.version} {version.status === "published" ? "已发布" : "草稿"}{row.type === "structured" && version.status === "draft" && <Button type="link" size="small" onClick={() => editStructured(row, version)}>编辑草稿</Button>}{row.type === "structured" && version.status === "published" && <Button type="link" size="small" loading={createVersion.isPending && createVersion.variables?.version.id === version.id} onClick={() => newStructuredVersion(row, version)}>创建新版本</Button>}<Button type="link" size="small" disabled={version.status === "published"} loading={publishVersion.isPending && publishVersion.variables === version.id} onClick={() => publishVersion.mutate(version.id)}>发布</Button></Tag>)}</Space> }
    ]} />;
  const templateList = templates.isError
    ? <Alert type="error" showIcon message="培训模板加载失败" description={templates.error.message} action={<Button onClick={() => void templates.refetch()}>重新加载</Button>} />
    : <Table rowKey="id" loading={templates.isLoading || templates.isFetching} locale={{ emptyText: "暂无培训模板" }} dataSource={templates.data ?? []} columns={[{ title: "名称", dataIndex: "name" }, { title: "培训类型", dataIndex: "type", render: (value: string) => typeNames[value] ?? value }, { title: "课件顺序", render: (_: unknown, row: Template) => row.items.map((item) => `${item.coursewareVersion.courseware.title} v${item.coursewareVersion.version}`).join(" → ") }]} />;

  return <>
    <Space className="page-title"><Typography.Title level={3}>课件与模板</Typography.Title><Button disabled={!scopeOptions.length} onClick={() => { setKind("rich_text"); setFileId(undefined); setCourseOpen(true); }}>新建课件</Button><Button type="primary" onClick={() => setTemplateOpen(true)}>新建模板</Button>{companyAdmin && <Button onClick={() => setGrantOpen(true)}>发布权限</Button>}</Space>
    {!scopeOptions.length && <Alert type="warning" showIcon message="当前账号没有可创建课件的授权范围" />}
    <Tabs activeKey={activeTab} onChange={switchTab} items={[{ key: "course", label: "课件版本", children: coursewareList }, { key: "template", label: "培训模板", children: templateList }]} />

    <Modal title="新建课件" open={courseOpen} footer={null} onCancel={() => setCourseOpen(false)}><Form layout="vertical" onFinish={(values) => { const selectedScope = parseScopeKey(String(values.scopeKey)); const content = { ...selectedScope, title: values.title, type: kind, ...(kind === "rich_text" ? { richText: values.richText } : { fileId }) }; if (kind !== "structured") { createCourse.mutate(content); return; } const document = createEmptyCoursewareDocument(); document.title = String(values.title); setCourseOpen(false); setEditorDirty(true); setStructuredEditor({ mode: "create", coursewareTitle: String(values.title), scope: selectedScope, document }); }}><Form.Item name="title" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="scopeKey" label="适用范围" rules={[{ required: true, message: "请选择适用范围" }]}><Select showSearch optionFilterProp="label" options={scopeOptions} /></Form.Item><Form.Item label="类型"><Select value={kind} onChange={setKind} options={[{ value: "rich_text", label: "图文课件" }, { value: "single_html", label: "单文件 HTML" }, { value: "structured", label: "结构化互动课件" }]} /></Form.Item>{kind === "rich_text" && <Form.Item name="richText" label="图文内容" rules={[{ required: true }]}><Input.TextArea rows={8} /></Form.Item>}{kind === "single_html" && <Form.Item label="HTML 文件" required><Upload accept=".html,text/html" maxCount={1} customRequest={upload}><Button icon={<UploadOutlined />}>上传</Button></Upload></Form.Item>}<Button type="primary" htmlType="submit" loading={createCourse.isPending}>{kind === "structured" ? "进入内容编辑器" : "创建草稿"}</Button></Form></Modal>
    <Modal title="编辑结构化课件" open={!!structuredEditor} footer={null} width="calc(100vw - 48px)" destroyOnHidden onCancel={() => confirmDiscard()}>{structuredEditor && <CoursewareEditor initialDocument={structuredEditor.document} initiallyDirty={structuredEditor.mode === "create"} coursewareTitle={structuredEditor.coursewareTitle} onSave={saveStructured} onClose={() => confirmDiscard()} onDirtyChange={setEditorDirty} onSavingChange={setEditorSaving} />}</Modal>
    <Modal title="新建培训模板" open={templateOpen} footer={null} onCancel={() => setTemplateOpen(false)}><Form layout="vertical" onFinish={(value) => createTemplate.mutate(value)}><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="type" label="培训类型" rules={[{ required: true }]}><Select options={trainingTypes} /></Form.Item><Form.Item name="coursewareVersionIds" label="已发布课件（选择顺序即展示顺序）" rules={[{ required: true }]}><Select mode="multiple" options={versionOptions} /></Form.Item><Button type="primary" htmlType="submit">保存模板</Button></Form></Modal>
    <Modal title="课件发布权限" open={grantOpen} footer={null} width={760} onCancel={() => setGrantOpen(false)}><Table size="small" rowKey="id" pagination={false} dataSource={grants.data} columns={[{ title: "人员", render: (_: unknown, row: PublishGrant) => row.person.name }, { title: "范围", render: (_: unknown, row: PublishGrant) => `${row.scopeType === "organization" ? "组织" : "项目"} · ${[...(organizations.data ?? []), ...(projects.data ?? [])].find((item) => item.id === row.scopeId)?.name ?? row.scopeId}` }, { title: "操作", render: (_: unknown, row: PublishGrant) => <Button danger size="small" onClick={() => { let reason = ""; Modal.confirm({ title: "取消发布权限", content: <Input.TextArea placeholder="请输入取消原因" onChange={(event) => { reason = event.target.value; }} />, onOk: async () => { if (reason.trim().length < 2) throw new Error("请输入至少 2 个字的原因"); await api(`/api/courseware-publish-grants/${row.id}`, json("DELETE", { reason: reason.trim() })); message.success("发布权限已取消"); void grants.refetch(); } }); }}>取消</Button> }]} /><Form layout="inline" style={{ marginTop: 16 }} onFinish={async (values) => { await api("/api/courseware-publish-grants", json("POST", values)); message.success("发布权限已授予"); void grants.refetch(); }} initialValues={{ scopeType: "organization" }}><Form.Item name="personId" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" placeholder="选择管理员" style={{ width: 180 }} options={(people.data ?? []).map((person) => ({ value: person.id, label: person.name }))} /></Form.Item><Form.Item name="scopeType" rules={[{ required: true }]}><Select style={{ width: 120 }} options={[{ value: "organization", label: "组织" }, { value: "project", label: "项目" }]} onChange={setGrantScopeType} /></Form.Item><Form.Item name="scopeId" rules={[{ required: true }]}><Select placeholder="选择范围" style={{ width: 180 }} options={(grantScopeType === "organization" ? organizations.data ?? [] : projects.data ?? []).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="reason" rules={[{ required: true, min: 2 }]}><Input placeholder="授权原因" /></Form.Item><Button type="primary" htmlType="submit">授予</Button></Form></Modal>
  </>;
}
