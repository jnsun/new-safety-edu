import { ArrowDownOutlined, ArrowUpOutlined, CheckCircleOutlined, FileAddOutlined, PlusOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Checkbox, Descriptions, Divider, Drawer, Empty, Form, Input, InputNumber, List, message, Modal, Result, Select, Space, Spin, Steps, Switch, Table, Tabs, Tag, Typography, Upload } from "antd";
import type { UploadProps } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import { api, json } from "../api";
import { AdminPageHeader } from "../AdminUi";
import { CoursewareEditor } from "../courseware/CoursewareEditor";
import { createEmptyCoursewareDocument, type StructuredCoursewareDocument } from "../courseware/types";

type TrainingType = "three_level" | "project_induction" | "routine" | "change_update";
type ScopeType = "company" | "organization" | "project";
type Version = { id: string; version: number; status: "draft" | "published"; richText?: string | null };
type Courseware = { id: string; title: string; type: string; scopeType: ScopeType; scopeId?: string | null; versions: Version[] };
type Template = { id: string; name: string; type: TrainingType; scopeType: ScopeType; scopeId?: string | null; items: Array<{ coursewareVersion: Version & { courseware: { id: string; title: string; type: string } } }> };
type Paper = { id: string; name: string; mode: "fixed" | "random"; randomCount?: number | null; bank?: { id: string; name: string } | null; items: Array<{ question: { id: string; prompt: string }; score: number }> };
type Bank = { id: string; name: string; scopeType: ScopeType; scopeId?: string | null; _count: { questions: number } };
type Question = { id: string; prompt: string; type: string };
type Organization = { id: string; name: string; type: string };
type Project = { id: string; name: string; status: string };
type Principal = { roles: Array<{ role: string; scopeType: string; scopeId?: string | null }> };
type Draft = {
  name: string; description: string; type: TrainingType; templateId?: string | undefined; examRequired: boolean; paperId?: string | undefined;
  targetType: "organization" | "project"; organizationIds: string[]; projectId?: string | undefined; dueAt?: string | undefined;
  durationMin: number; passScore: number; maxAttempts: number;
};
type CoveragePerson = { id: string; name: string; personType: string; reason?: string };
type Preflight = { ready: boolean; token?: string; fingerprint: string; blockers: Array<{ code: string; message: string; field?: string }>; coverage: { includedCount: number; excludedCount: number; deduplicatedCount: number; included: CoveragePerson[]; excluded: CoveragePerson[] }; coursewares: Array<{ title: string; version: number }>; paper: { name: string; availableQuestions: number; randomCount?: number | null } | null };
type DispatchResult = { batchId: string; assignmentCount: number; excludedCount: number; failedCount: number; duplicate: boolean; excluded: CoveragePerson[]; notification: { systemCreated: number; externalDelivery: string } };

const typeNames: Record<TrainingType, string> = { three_level: "三级安全教育", project_induction: "项目入场教育", routine: "日常/年度培训", change_update: "变化内容培训" };
const mandatoryExam = (type: TrainingType) => type === "three_level" || type === "project_induction";
const newIdempotencyKey = () => globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
  const random = Math.floor(Math.random() * 16);
  return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
});
const errorText = (error: unknown) => error instanceof Error ? error.message : "操作失败，请稍后重试";

export function TrainingWorkflowPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ["training-templates"], queryFn: () => api<Template[]>("/api/training-templates") });
  const coursewares = useQuery({ queryKey: ["coursewares"], queryFn: () => api<Courseware[]>("/api/coursewares") });
  const papers = useQuery({ queryKey: ["exam-papers"], queryFn: () => api<Paper[]>("/api/exam-papers") });
  const banks = useQuery({ queryKey: ["question-banks"], queryFn: () => api<Bank[]>("/api/question-banks") });
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: () => api<Organization[]>("/api/organizations") });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/api/projects") });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Principal>("/api/auth/me") });
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({ name: "", description: "", type: "routine", examRequired: false, targetType: "organization", organizationIds: [], durationMin: 30, passScore: 80, maxAttempts: 3 });
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [savedTemplateKey, setSavedTemplateKey] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [quickCourse, setQuickCourse] = useState(false);
  const [paperBuilder, setPaperBuilder] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [preflight, setPreflight] = useState<Preflight>();
  const [preflighting, setPreflighting] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<DispatchResult>();
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const leaveConfirmed = useRef(false);
  const blocker = useBlocker(dirty && !dispatchResult && !leaveConfirmed.current);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    Modal.confirm({ title: "离开培训制作？", content: "当前制作内容尚未下发。已真正保存的模板会保留，本页其他内容离开后将丢失。", okText: "离开", okButtonProps: { danger: true }, cancelText: "继续制作", onOk: () => { leaveConfirmed.current = true; blocker.proceed(); }, onCancel: () => blocker.reset() });
  }, [blocker]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty && !dispatchResult) event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty, dispatchResult]);

  const companyAdmin = me.data?.roles.some(({ role }) => role === "company_admin") ?? false;
  const organizationManager = me.data?.roles.some(({ role }) => ["org_leader", "org_admin"].includes(role)) ?? false;
  const projectOnlyManager = !!me.data && !companyAdmin && !organizationManager && me.data.roles.some(({ role }) => role === "project_admin");
  const authoringScope = useMemo<{ scopeType: ScopeType; scopeId: string | null }>(() => {
    if (companyAdmin) return { scopeType: "company", scopeId: null };
    const scopedRole = me.data?.roles.find(({ role, scopeType, scopeId }) => ["org_leader", "org_admin", "project_admin"].includes(role) && ["organization", "project"].includes(scopeType) && !!scopeId);
    return scopedRole ? { scopeType: scopedRole.scopeType as ScopeType, scopeId: scopedRole.scopeId ?? null } : { scopeType: "company", scopeId: null };
  }, [companyAdmin, me.data]);
  useEffect(() => {
    if (!projectOnlyManager || draft.targetType === "project") return;
    setDraft((current) => ({ ...current, targetType: "project", organizationIds: [] }));
  }, [draft.targetType, projectOnlyManager]);
  const published = useMemo(() => (coursewares.data ?? []).flatMap((courseware) => courseware.versions.filter(({ status }) => status === "published").map((version) => ({ ...version, courseware }))), [coursewares.data]);
  const selected = selectedVersions.map((id) => published.find((row) => row.id === id)).filter(Boolean) as Array<Version & { courseware: Courseware }>;
  const activeProjects = (projects.data ?? []).filter(({ status }) => status === "active");
  const orgOptions = (organizations.data ?? []).filter(({ type }) => ["department", "business_entity"].includes(type)).map(({ id, name }) => ({ value: id, label: name }));
  const invalidatePreflight = () => { setPreflight(undefined); setIdempotencyKey(newIdempotencyKey()); };
  const updateDraft = (patch: Partial<Draft>) => { setDraft((current) => ({ ...current, ...patch })); setDirty(true); invalidatePreflight(); };
  const contentKey = `${draft.type}|${selectedVersions.join(",")}`;

  const applyTemplate = (templateId: string) => {
    const template = templates.data?.find(({ id }) => id === templateId);
    if (!template) return;
    const isMandatory = mandatoryExam(template.type);
    setSelectedVersions(template.items.map(({ coursewareVersion }) => coursewareVersion.id));
    setDraft((current) => ({ ...current, type: template.type, templateId, examRequired: isMandatory ? true : current.examRequired, targetType: template.type === "project_induction" ? "project" : current.targetType }));
    setSavedTemplateKey(`${template.type}|${template.items.map(({ coursewareVersion }) => coursewareVersion.id).join(",")}`);
    setDirty(true); invalidatePreflight();
  };
  const changeType = (type: TrainingType) => {
    const required = mandatoryExam(type);
    updateDraft({ type, examRequired: required, ...(required ? {} : { paperId: undefined }), ...(type === "project_induction" ? { targetType: "project", organizationIds: [] } : {}) });
    if (draft.templateId && templates.data?.find(({ id }) => id === draft.templateId)?.type !== type) { setSelectedVersions([]); setSavedTemplateKey(undefined); updateDraft({ templateId: undefined }); }
  };
  const reorder = (index: number, delta: number) => { const next = [...selectedVersions]; const target = index + delta; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target]!, next[index]!]; setSelectedVersions(next); setDirty(true); invalidatePreflight(); };
  const removeVersion = (id: string) => { setSelectedVersions((current) => current.filter((item) => item !== id)); setDirty(true); invalidatePreflight(); };

  const saveTemplate = async () => {
    if (!selectedVersions.length) throw new Error("请至少选择一个已发布课件");
    const name = await new Promise<string>((resolve, reject) => { let value = `${draft.name || typeNames[draft.type]}模板`; Modal.confirm({ title: "保存培训模板", content: <Input defaultValue={value} onChange={(event) => { value = event.target.value; }} />, okText: "保存", onOk: () => value.trim().length >= 2 ? resolve(value.trim()) : Promise.reject(new Error("模板名称至少 2 个字")), onCancel: () => reject(new Error("cancelled")) }); });
    const created = await api<{ id: string }>("/api/training-templates", json("POST", { name, type: draft.type, ...authoringScope, coursewareVersionIds: selectedVersions }));
    updateDraft({ templateId: created.id }); setSavedTemplateKey(contentKey); await qc.invalidateQueries({ queryKey: ["training-templates"] }); message.success("模板已保存并用于本次培训");
  };

  const validateStep = (current: number) => {
    if (current === 0 && draft.name.trim().length < 2) return "请输入至少 2 个字的培训名称";
    if (current === 1 && !selectedVersions.length) return "请至少选择一个已发布课件";
    if (current === 1 && (!draft.templateId || savedTemplateKey !== contentKey)) return "课件顺序已变化，请先真实保存为培训模板";
    if (current === 2 && draft.examRequired && !draft.paperId) return "请选择或创建试卷";
    return undefined;
  };
  const next = () => { const error = validateStep(step); if (error) return message.warning(error); setStep((value) => Math.min(4, value + 1)); };
  const requestDraft = () => ({ ...draft, description: draft.description.trim(), name: draft.name.trim(), dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : undefined });
  const runPreflight = async () => { try { setPreflighting(true); const result = await api<Preflight>("/api/training-batches/preflight", json("POST", requestDraft())); setPreflight(result); setCoverageOpen(true); if (!result.ready) message.warning("预检发现阻断项，请修正后重新检查"); } catch (error) { message.error(errorText(error)); } finally { setPreflighting(false); } };
  const dispatch = async () => { if (!preflight?.ready || !preflight.token) return message.warning("请先通过服务端预检"); try { setDispatching(true); const result = await api<DispatchResult>("/api/training-batches", json("POST", { draft: requestDraft(), preflightToken: preflight.token, preflightFingerprint: preflight.fingerprint, idempotencyKey })); setDispatchResult(result); setDirty(false); setCoverageOpen(false); message.success(result.duplicate ? "已返回同一次下发结果，未重复创建任务" : "培训已下发"); } catch (error) { invalidatePreflight(); message.error(errorText(error)); } finally { setDispatching(false); } };

  if ([templates, coursewares, papers, banks, organizations, projects, me].some(({ isLoading }) => isLoading)) return <Spin fullscreen tip="正在加载培训制作数据" />;
  if ([templates, coursewares, papers, banks, organizations, projects, me].some(({ isError }) => isError)) return <Result status="error" title="培训制作数据加载失败" subTitle="请检查网络后重新进入。" extra={<Button onClick={() => window.location.reload()}>重新加载</Button>} />;
  if (dispatchResult) return <div className="admin-workspace training-workflow-page"><Result status="success" title={dispatchResult.duplicate ? "本次培训已下发" : "培训下发完成"} subTitle={`实际生成 ${dispatchResult.assignmentCount} 项任务，排除 ${dispatchResult.excludedCount} 人，失败 ${dispatchResult.failedCount} 人。`} extra={[<Button key="progress" type="primary" onClick={() => navigate(`/records?batchId=${dispatchResult.batchId}`)}>查看本批次培训进度</Button>, <Button key="again" onClick={() => window.location.reload()}>继续制作培训</Button>]}><Descriptions bordered column={1} size="small"><Descriptions.Item label="培训批次">{dispatchResult.batchId}</Descriptions.Item><Descriptions.Item label="系统任务">已生成 {dispatchResult.notification.systemCreated} 项</Descriptions.Item><Descriptions.Item label="外部通知">{dispatchResult.notification.externalDelivery === "queued" ? "已进入发送队列" : "未配置，不影响任务下发"}</Descriptions.Item><Descriptions.Item label="幂等保护">{dispatchResult.duplicate ? "已阻止重复派发" : "本次首次派发"}</Descriptions.Item></Descriptions></Result></div>;

  return <div className="admin-workspace training-workflow-page">
    <AdminPageHeader title="新建培训" description="同一制作上下文完成课件、考试、预览、范围预检与下发。预览不会产生学习、考试或签字记录。" actions={<Button onClick={() => navigate("/training")}>返回培训安排</Button>} />
    <Card className="training-workflow-shell"><Steps current={step} items={["基本信息", "学习内容", "考试设置", "保存与预览", "范围并下发"].map((title) => ({ title }))} />
      <Divider />
      {step === 0 && <BasicStep draft={draft} update={updateDraft} changeType={changeType} templates={templates.data ?? []} applyTemplate={applyTemplate} />}
      {step === 1 && <LearningStep selected={selected} published={published} choose={(ids) => { setSelectedVersions(ids); setDirty(true); invalidatePreflight(); }} reorder={reorder} remove={removeVersion} quick={() => setQuickCourse(true)} saveTemplate={saveTemplate} saved={!!draft.templateId && savedTemplateKey === contentKey} />}
      {step === 2 && <ExamStep draft={draft} update={updateDraft} papers={papers.data ?? []} openBuilder={() => setPaperBuilder(true)} />}
      {step === 3 && <PreviewStep draft={draft} selected={selected} paper={papers.data?.find(({ id }) => id === draft.paperId)} />}
      {step === 4 && <ScopeStep draft={draft} update={updateDraft} projects={activeProjects} orgOptions={orgOptions} companyAdmin={companyAdmin} forceProject={projectOnlyManager} preflight={preflight} runPreflight={runPreflight} preflighting={preflighting} openCoverage={() => setCoverageOpen(true)} />}
      <Divider /><div className="training-workflow-actions"><Button disabled={step === 0} onClick={() => setStep((value) => value - 1)}>上一步</Button>{step < 4 ? <Button type="primary" onClick={next}>下一步</Button> : <Button type="primary" loading={preflighting} onClick={runPreflight}>预检覆盖范围</Button>}</div>
    </Card>
    <QuickCourseModal open={quickCourse} scope={authoringScope} onClose={() => setQuickCourse(false)} onCreated={async (versionId) => { await qc.invalidateQueries({ queryKey: ["coursewares"] }); setSelectedVersions((current) => [...current, versionId]); setQuickCourse(false); setDirty(true); invalidatePreflight(); }} />
    <PaperBuilder open={paperBuilder} scope={authoringScope} onClose={() => setPaperBuilder(false)} banks={banks.data ?? []} onCreated={async (paperId) => { await Promise.all([qc.invalidateQueries({ queryKey: ["exam-papers"] }), qc.invalidateQueries({ queryKey: ["question-banks"] })]); updateDraft({ paperId }); setPaperBuilder(false); }} />
    <Drawer rootClassName="training-preflight-drawer" title="服务端覆盖预检" width={680} open={coverageOpen} onClose={() => setCoverageOpen(false)} extra={preflight?.ready && <Button type="primary" loading={dispatching} onClick={dispatch}>确认下发</Button>}>
      {!preflight ? <Alert type="info" showIcon message="尚未执行预检" /> : <><div className="training-preflight-summary"><div><Tag color={preflight.ready ? "success" : "error"}>{preflight.ready ? "准备就绪" : "存在阻断"}</Tag><strong>{preflight.ready ? `将生成 ${preflight.coverage.includedCount} 项任务` : `${preflight.blockers.length} 项阻断需要处理`}</strong></div><Space wrap><Tag>排除 {preflight.coverage.excludedCount}</Tag><Tag>去重 {preflight.coverage.deduplicatedCount}</Tag></Space></div><div className="training-readiness-list">{[
        { label: "课件与发布状态", ready: preflight.coursewares.length > 0 && !preflight.blockers.some(({ code }) => code === "UNPUBLISHED_COURSEWARE"), detail: `${preflight.coursewares.length} 个课件版本` },
        { label: "考试与题量", ready: !draft.examRequired || (!!preflight.paper && !preflight.blockers.some(({ code }) => code === "INSUFFICIENT_QUESTIONS")), detail: draft.examRequired ? (preflight.paper ? `${preflight.paper.name} · 可用 ${preflight.paper.availableQuestions} 题` : "尚未满足考试条件") : "本次不要求正式考试" },
        { label: "完整范围与有效人员", ready: preflight.coverage.includedCount > 0 && !preflight.blockers.some(({ code }) => code === "NO_TARGETS"), detail: `纳入 ${preflight.coverage.includedCount}，排除 ${preflight.coverage.excludedCount}` },
        { label: "服务端范围权限", ready: true, detail: "本次预检已通过服务端授权入口" },
      ].map((item) => <div className={`training-readiness-row ${item.ready ? "is-ready" : "is-blocked"}`} key={item.label}><CheckCircleOutlined /><span><strong>{item.label}</strong><small>{item.detail}</small></span><Tag color={item.ready ? "success" : "error"}>{item.ready ? "通过" : "阻断"}</Tag></div>)}</div>{preflight.blockers.map((item) => <Alert key={item.code} style={{ marginTop: 12 }} type="error" showIcon message={item.message} />)}<Tabs className="training-coverage-tabs" items={[{ key: "included", label: `纳入人员（${preflight.coverage.includedCount}）`, children: <Table size="small" rowKey="id" pagination={{ pageSize: 8 }} dataSource={preflight.coverage.included} columns={[{ title: "姓名", dataIndex: "name" }, { title: "人员类型", dataIndex: "personType" }]} /> }, { key: "excluded", label: `排除明细（${preflight.coverage.excludedCount}）`, children: <Table size="small" rowKey="id" pagination={{ pageSize: 8 }} dataSource={preflight.coverage.excluded} columns={[{ title: "姓名", dataIndex: "name" }, { title: "原因", dataIndex: "reason" }]} /> }]} /></>}
    </Drawer>
  </div>;
}

function BasicStep({ draft, update, changeType, templates, applyTemplate }: { draft: Draft; update: (patch: Partial<Draft>) => void; changeType: (type: TrainingType) => void; templates: Template[]; applyTemplate: (id: string) => void }) {
  return <div className="training-step"><Typography.Title level={3}>基本信息</Typography.Title><Alert type="info" showIcon message={mandatoryExam(draft.type) ? "此培训类型必须考试，后续不可关闭考试。" : "此培训类型默认不考试，可在第三步主动开启。"} /><Form layout="vertical" style={{ marginTop: 20 }}><Form.Item required label="培训名称"><Input value={draft.name} maxLength={180} showCount onChange={(event) => update({ name: event.target.value })} /></Form.Item><Form.Item required label="培训类型"><Select value={draft.type} options={Object.entries(typeNames).map(([value, label]) => ({ value, label }))} onChange={changeType} /></Form.Item><Form.Item label="从已有模板开始（可选）"><Select allowClear value={draft.templateId} options={templates.filter(({ type }) => type === draft.type).map(({ id, name }) => ({ value: id, label: name }))} onChange={(value) => value ? applyTemplate(value) : update({ templateId: undefined })} /></Form.Item><Form.Item label="培训说明"><Input.TextArea value={draft.description} rows={4} maxLength={1000} showCount onChange={(event) => update({ description: event.target.value })} /></Form.Item></Form></div>;
}

function LearningStep({ selected, published, choose, reorder, remove, quick, saveTemplate, saved }: { selected: Array<Version & { courseware: Courseware }>; published: Array<Version & { courseware: Courseware }>; choose: (ids: string[]) => void; reorder: (index: number, delta: number) => void; remove: (id: string) => void; quick: () => void; saveTemplate: () => Promise<void>; saved: boolean }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerSelection, setPickerSelection] = useState<string[]>([]);
  const openPicker = () => {
    setPickerSelection(selected.map(({ id }) => id));
    setPickerSearch("");
    setPickerOpen(true);
  };
  const closePicker = () => {
    setPickerOpen(false);
    setPickerSearch("");
  };
  const filtered = published.filter(({ courseware, version }) => `${courseware.title} ${courseware.type} ${version}`.toLowerCase().includes(pickerSearch.trim().toLowerCase()));
  const totalMinutes = selected.reduce((sum, item) => sum + (item.courseware.type === "structured" ? 15 : 10), 0);
  return <div className="training-step training-learning-step">
    <div className="training-step-heading"><div><Typography.Title level={3}>学习内容</Typography.Title><Typography.Text type="secondary">在当前制作上下文选择、制作和排序课件；只有已发布版本可以进入培训。</Typography.Text></div><Space wrap><Button icon={<FileAddOutlined />} onClick={quick}>快速新建课件</Button><Button type="primary" icon={<SearchOutlined />} onClick={openPicker}>从课件库选择</Button></Space></div>
    <div className="training-learning-workspace">
      <section className="training-learning-main" aria-label="已选学习内容">
        <div className="training-section-bar"><div><strong>已选课件</strong><span>{selected.length ? `共 ${selected.length} 项，可调整学习顺序` : "尚未添加学习内容"}</span></div>{selected.length > 0 && <Tag color="blue">仅已发布版本</Tag>}</div>
        {selected.length ? <List className="training-course-list" dataSource={selected} renderItem={(item, index) => <List.Item actions={[<Button key="up" aria-label={`上移${item.courseware.title}`} type="text" disabled={index === 0} icon={<ArrowUpOutlined />} onClick={() => reorder(index, -1)} />, <Button key="down" aria-label={`下移${item.courseware.title}`} type="text" disabled={index === selected.length - 1} icon={<ArrowDownOutlined />} onClick={() => reorder(index, 1)} />, <Button key="preview" type="link" onClick={() => Modal.info({ width: 720, title: `${item.courseware.title} v${item.version}`, content: item.richText ? <div dangerouslySetInnerHTML={{ __html: item.richText }} /> : <Alert type="info" showIcon message="该类型课件请在课件库使用对应预览器查看。" /> })}>预览</Button>, <Button key="remove" danger type="link" onClick={() => remove(item.id)}>移除</Button>]}><List.Item.Meta avatar={<div className="training-order">{index + 1}</div>} title={<Space wrap><span>{item.courseware.title}</span><Tag color="success">已发布</Tag></Space>} description={`${item.courseware.type === "structured" ? "结构化互动课件" : item.courseware.type === "single_html" ? "单文件 HTML" : "图文课件"} · 版本 ${item.version}`} /></List.Item>} /> : <Empty className="training-learning-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span>还没有学习内容<br />可以从课件库选择，或在此新建并发布</span>}><Space><Button onClick={openPicker}>选择课件</Button><Button type="primary" onClick={quick}>新建课件</Button></Space></Empty>}
        <Alert className="training-template-state" type={saved ? "success" : "warning"} showIcon message={saved ? "当前课件顺序已真实保存为模板" : "下发前必须将当前有序课件保存为模板"} description="模板只保存名称、培训类型和有序已发布课件；本次考试、范围和截止时间仍保留在当前安排中。" action={!saved && <Button size="small" disabled={!selected.length} onClick={() => void saveTemplate().catch((error) => errorText(error) !== "cancelled" && message.error(errorText(error)))}>保存模板</Button>} />
      </section>
      <aside className="training-learning-summary" aria-label="学习顺序预览"><span className="training-summary-kicker">学习顺序预览</span><Typography.Title level={4}>{selected.length || 0} 项内容</Typography.Title><Typography.Text type="secondary">预计约 {totalMinutes} 分钟</Typography.Text><ol>{selected.map((item) => <li key={item.id}><span>{item.courseware.title}</span><small>v{item.version}</small></li>)}</ol><Divider /><div className="training-flow-tail"><span>随后</span><strong>考试设置</strong><span>→ 签字{selected.length ? " → 完成" : ""}</span></div></aside>
    </div>
    <Drawer rootClassName="training-picker-drawer" title="从课件库选择" width={720} open={pickerOpen} onClose={closePicker} destroyOnHidden extra={<Space><Button onClick={closePicker}>取消</Button><Button type="primary" onClick={() => { choose(pickerSelection); closePicker(); }}>确认选择（{pickerSelection.length}）</Button></Space>}>
      <Alert type="info" showIcon message="选择在确认后才会回填；直接关闭或取消不会改变当前学习内容。" />
      <Input allowClear prefix={<SearchOutlined />} value={pickerSearch} onChange={(event) => setPickerSearch(event.target.value)} placeholder="搜索课件名称、类型或版本" className="training-picker-search" />
      <Checkbox.Group value={pickerSelection} onChange={(values) => setPickerSelection(values as string[])} className="training-picker-options">
        {filtered.map((item) => <label className={`training-picker-row ${pickerSelection.includes(item.id) ? "is-selected" : ""}`} key={item.id}><Checkbox value={item.id} /><span><strong>{item.courseware.title}</strong><small>{item.courseware.type === "structured" ? "结构化互动课件" : item.courseware.type === "single_html" ? "单文件 HTML" : "图文课件"} · v{item.version}</small></span><Tag color="success">已发布</Tag></label>)}
      </Checkbox.Group>
      {!filtered.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的已发布课件" />}
    </Drawer>
  </div>;
}

function ExamStep({ draft, update, papers, openBuilder }: { draft: Draft; update: (patch: Partial<Draft>) => void; papers: Paper[]; openBuilder: () => void }) {
  const required = mandatoryExam(draft.type);
  return <div className="training-step"><Typography.Title level={3}>考试设置</Typography.Title><Card><Space direction="vertical" size="large" style={{ width: "100%" }}><Space><Switch checked={draft.examRequired} disabled={required} onChange={(checked) => update({ examRequired: checked, ...(checked ? {} : { paperId: undefined }) })} /><Typography.Text strong>需要正式考试</Typography.Text>{required && <Tag color="red">类型规则强制</Tag>}</Space>{draft.examRequired && <><Space.Compact style={{ width: "100%" }}><Select style={{ flex: 1 }} value={draft.paperId} placeholder="选择已有试卷" options={papers.map(({ id, name, mode, randomCount, items }) => ({ value: id, label: `${name} · ${mode === "random" ? `随机 ${randomCount} 题` : `固定 ${items.length} 题`}` }))} onChange={(paperId) => update({ paperId })} /><Button onClick={openBuilder}>就地维护题库并新建试卷</Button></Space.Compact><Space wrap><label>限时 <InputNumber min={1} max={240} value={draft.durationMin} onChange={(value) => update({ durationMin: value ?? 30 })} /> 分钟</label><label>合格 <InputNumber min={0} max={100} value={draft.passScore} onChange={(value) => update({ passScore: value ?? 80 })} /> 分</label><label>最多 <InputNumber min={1} max={10} value={draft.maxAttempts} onChange={(value) => update({ maxAttempts: value ?? 3 })} /> 次</label></Space></>}</Space></Card></div>;
}

function PreviewStep({ draft, selected, paper }: { draft: Draft; selected: Array<Version & { courseware: Courseware }>; paper: Paper | undefined }) {
  return <div className="training-step"><Typography.Title level={3}>保存与预览</Typography.Title><Alert type="info" showIcon message="这是本次培训配置的连续预览，不会创建学习进度、考试次数、签字或项目确认事实。" /><Descriptions bordered column={1} style={{ marginTop: 16 }}><Descriptions.Item label="名称">{draft.name}</Descriptions.Item><Descriptions.Item label="类型">{typeNames[draft.type]}</Descriptions.Item><Descriptions.Item label="说明">{draft.description || "未填写"}</Descriptions.Item><Descriptions.Item label="学习内容">{selected.map(({ courseware, version }, index) => `${index + 1}. ${courseware.title} v${version}`).join("；")}</Descriptions.Item><Descriptions.Item label="考试">{draft.examRequired ? `${paper?.name ?? "未选择"}；${draft.durationMin} 分钟；${draft.passScore} 分合格；最多 ${draft.maxAttempts} 次` : "本次不要求正式考试"}</Descriptions.Item><Descriptions.Item label="签字">按现有培训完成规则执行</Descriptions.Item><Descriptions.Item label="项目确认">{draft.type === "project_induction" ? "适用，按项目现场确认规则执行" : "不适用"}</Descriptions.Item></Descriptions></div>;
}

function ScopeStep({ draft, update, projects, orgOptions, companyAdmin, forceProject, preflight, runPreflight, preflighting, openCoverage }: { draft: Draft; update: (patch: Partial<Draft>) => void; projects: Project[]; orgOptions: Array<{ value: string; label: string }>; companyAdmin: boolean; forceProject: boolean; preflight: Preflight | undefined; runPreflight: () => Promise<void>; preflighting: boolean; openCoverage: () => void }) {
  return <div className="training-step"><Typography.Title level={3}>范围并下发</Typography.Title><Alert type="info" showIcon message="只能选择完整组织或完整项目。人员预览仅用于核对，不能零散勾选人员。正式确认时服务端会再次校验。" /><Form layout="vertical" style={{ marginTop: 20 }}>{draft.type !== "project_induction" && !forceProject && <Form.Item label="范围类型"><Select value={draft.targetType} options={[{ value: "organization", label: "完整组织" }, { value: "project", label: "完整项目" }]} onChange={(targetType) => update({ targetType, projectId: undefined, organizationIds: [] })} /></Form.Item>}{draft.targetType === "project" ? <Form.Item required label="项目"><Select value={draft.projectId} options={projects.map(({ id, name }) => ({ value: id, label: name }))} onChange={(projectId) => update({ projectId })} /></Form.Item> : companyAdmin ? <Form.Item required label="组织"><Select mode="multiple" maxTagCount="responsive" value={draft.organizationIds} options={orgOptions} onChange={(organizationIds) => update({ organizationIds })} /></Form.Item> : <Alert type="info" showIcon message="将使用当前账号服务端授权的完整组织范围。" style={{ marginBottom: 16 }} />}<Form.Item label="截止时间"><Input type="datetime-local" value={draft.dueAt} onChange={(event) => update({ dueAt: event.target.value || undefined })} /></Form.Item></Form><Space><Button type="primary" loading={preflighting} onClick={() => void runPreflight()}>服务端预检</Button>{preflight && <Button onClick={openCoverage}>查看覆盖与排除明细</Button>}</Space>{preflight && <Alert style={{ marginTop: 16 }} type={preflight.ready ? "success" : "error"} showIcon message={preflight.ready ? `预检通过：将生成 ${preflight.coverage.includedCount} 项任务，排除 ${preflight.coverage.excludedCount} 人` : `预检未通过：${preflight.blockers.map(({ message: text }) => text).join("；")}`} />}</div>;
}

function QuickCourseModal({ open, scope, onClose, onCreated }: { open: boolean; scope: { scopeType: ScopeType; scopeId: string | null }; onClose: () => void; onCreated: (versionId: string) => Promise<void> }) {
  const [form] = Form.useForm();
  const [kind, setKind] = useState<"rich_text" | "single_html" | "structured">("rich_text");
  const [saving, setSaving] = useState(false);
  const [fileId, setFileId] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [structured, setStructured] = useState<{ title: string; document: StructuredCoursewareDocument }>();
  const finish = async (payload: Record<string, unknown>) => {
    const created = await api<Courseware>("/api/coursewares", json("POST", { ...payload, ...scope }));
    const version = created.versions[0];
    if (!version) throw new Error("课件版本创建失败");
    await api(`/api/courseware-versions/${version.id}/publish`, { method: "POST" });
    await onCreated(version.id);
    form.resetFields(); setFileId(undefined); setKind("rich_text"); setStructured(undefined);
    message.success("课件已发布并回填到当前学习内容");
  };
  const requestClose = () => {
    if (saving || uploading) return message.warning("当前操作尚未完成，请稍候");
    if (form.isFieldsTouched() || structured) return Modal.confirm({ title: "放弃当前课件草稿？", content: "已选的原学习内容不会变化；本弹窗中尚未发布的内容将丢失。", okText: "放弃", okButtonProps: { danger: true }, cancelText: "继续编辑", onOk: () => { form.resetFields(); setFileId(undefined); setStructured(undefined); setKind("rich_text"); onClose(); } });
    onClose();
  };
  if (structured) return <Drawer rootClassName="training-course-editor-drawer" title="新建结构化课件" width="calc(100vw - 48px)" open={open} onClose={requestClose} destroyOnHidden={false}><Alert type="info" showIcon message="保存内容后系统将创建草稿、发布该版本，并把真实版本回填到当前培训。任一步失败都不会显示成功。" /><CoursewareEditor coursewareTitle={structured.title} initialDocument={structured.document} initiallyDirty onClose={requestClose} onSave={async (document) => { try { setSaving(true); await finish({ title: structured.title, type: "structured", structuredContent: document }); } finally { setSaving(false); } }} /></Drawer>;
  const upload: NonNullable<UploadProps["customRequest"]> = async ({ file, onSuccess, onError }) => {
    try { setUploading(true); const body = new FormData(); body.append("file", file as Blob); const result = await api<{ id: string }>("/api/files?kind=courseware", { method: "POST", body }); setFileId(result.id); onSuccess?.(result); }
    catch (error) { onError?.(error as Error); message.error(`文件上传失败：${errorText(error)}`); }
    finally { setUploading(false); }
  };
  return <Modal rootClassName="training-quick-course-modal" title="在当前培训中新建课件" open={open} footer={null} width={760} destroyOnHidden={false} onCancel={requestClose}><Alert type="info" showIcon message="当前流程：编辑内容 → 创建草稿 → 发布版本 → 回填学习内容" description="不会清空已选课件；只有全部步骤成功后才会显示完成。" /><div className="training-authoring-stages" aria-label="课件创建阶段"><span className="is-current">1 编辑内容</span><span>2 创建草稿</span><span>3 发布版本</span><span>4 回填培训</span></div><Form form={form} layout="vertical" onValuesChange={() => undefined} onFinish={async (values) => { if (kind === "structured") { const document = createEmptyCoursewareDocument(); document.title = values.title; setStructured({ title: values.title, document }); return; } if (kind === "single_html" && !fileId) return message.warning("请先上传 HTML 文件"); try { setSaving(true); await finish({ title: values.title, type: kind, ...(kind === "rich_text" ? { richText: values.richText } : { fileId }) }); } catch (error) { message.error(`课件未发布：${errorText(error)}`); } finally { setSaving(false); } }}><Form.Item name="title" label="课件名称" rules={[{ required: true, min: 2, message: "请输入至少 2 个字的课件名称" }]}><Input maxLength={180} showCount /></Form.Item><Form.Item label="课件类型"><Select value={kind} onChange={(value) => { setKind(value); setFileId(undefined); }} options={[{ value: "rich_text", label: "图文课件" }, { value: "structured", label: "结构化互动课件" }, { value: "single_html", label: "单文件 HTML" }]} /></Form.Item>{kind === "rich_text" && <Form.Item name="richText" label="课件内容" rules={[{ required: true, min: 2 }]}><Input.TextArea rows={10} placeholder="输入培训正文" /></Form.Item>}{kind === "single_html" && <Form.Item label="HTML 文件" required><Upload accept=".html,text/html" maxCount={1} customRequest={upload} onRemove={() => { setFileId(undefined); return true; }}><Button icon={<UploadOutlined />} loading={uploading}>{uploading ? "正在上传" : "选择并上传文件"}</Button></Upload>{fileId && <Typography.Text type="success"><CheckCircleOutlined /> 文件已上传，可创建草稿</Typography.Text>}</Form.Item>}<Space><Button onClick={requestClose}>取消并返回学习内容</Button><Button type="primary" htmlType="submit" loading={saving || uploading}>{kind === "structured" ? "进入内容编辑" : "创建、发布并回填"}</Button></Space></Form></Modal>;
}

function PaperBuilder({ open, scope, onClose, banks, onCreated }: { open: boolean; scope: { scopeType: ScopeType; scopeId: string | null }; onClose: () => void; banks: Bank[]; onCreated: (id: string) => Promise<void> }) {
  const qc = useQueryClient(); const [bankId, setBankId] = useState<string>(); const [questions, setQuestions] = useState<Question[]>([]); const [selected, setSelected] = useState<string[]>([]); const [mode, setMode] = useState<"fixed" | "random">("fixed"); const [name, setName] = useState(""); const [randomCount, setRandomCount] = useState(10); const [bankOpen, setBankOpen] = useState(false); const [questionOpen, setQuestionOpen] = useState(false); const [importing, setImporting] = useState(false); const [saving, setSaving] = useState(false);
  const loadQuestions = async (id: string | undefined) => { if (!id) return; setBankId(id); const result = await api<{ items: Question[] }>(`/api/question-banks/${id}/questions?page=1&pageSize=100`); setQuestions(result.items); setSelected([]); };
  const createPaper = async () => { if (!bankId) return message.warning("请先选择题库"); if (mode === "fixed" && !selected.length) return message.warning("固定组卷至少选择一道题"); try { setSaving(true); const result = await api<{ id: string }>("/api/exam-papers", json("POST", mode === "random" ? { name, mode, bankId, randomCount } : { name, mode, items: selected.map((questionId) => ({ questionId, score: 100 / selected.length })) })); message.success("试卷已创建并回填"); await onCreated(result.id); } catch (error) { message.error(errorText(error)); } finally { setSaving(false); } };
  return <Modal title="就地维护题库与新建试卷" open={open} onCancel={onClose} footer={null} width={920} destroyOnHidden><Space wrap><Select style={{ width: 260 }} placeholder="选择题库" value={bankId} options={banks.map(({ id, name: label, _count }) => ({ value: id, label: `${label}（${_count.questions}题）` }))} onChange={(id) => void loadQuestions(id)} /><Button onClick={() => setBankOpen(true)}>新建题库</Button><Button disabled={!bankId} onClick={() => setQuestionOpen(true)}>新建题目</Button><Upload showUploadList={false} disabled={!bankId || importing} beforeUpload={(file) => { void (async () => { try { setImporting(true); const body = new FormData(); body.append("file", file); const result = await api<{ created: number; failed: number; errors: Array<{ rowNumber: number; reason: string }> }>(`/api/question-banks/${bankId}/questions/import`, { method: "POST", body }); if (result.failed) Modal.error({ title: "导入未写入", content: result.errors.map(({ rowNumber, reason }) => `第${rowNumber}行：${reason}`).join("；") }); else { message.success(`已导入 ${result.created} 道题`); await loadQuestions(bankId!); await qc.invalidateQueries({ queryKey: ["question-banks"] }); } } catch (error) { message.error(errorText(error)); } finally { setImporting(false); } })(); return false; }}><Button loading={importing} disabled={!bankId}>统一导入题目</Button></Upload></Space><Divider /><Space direction="vertical" style={{ width: "100%" }}><Input value={name} placeholder="试卷名称" onChange={(event) => setName(event.target.value)} /><Select value={mode} options={[{ value: "fixed", label: "固定组卷" }, { value: "random", label: "随机组卷" }]} onChange={setMode} />{mode === "random" ? <InputNumber min={1} max={200} value={randomCount} onChange={(value) => setRandomCount(value ?? 1)} addonAfter={`当前题库 ${questions.length} 题`} /> : <Table size="small" rowKey="id" pagination={{ pageSize: 6 }} rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }} dataSource={questions} columns={[{ title: "题型", dataIndex: "type", width: 140 }, { title: "题目", dataIndex: "prompt" }]} />}<Alert type={mode === "random" && randomCount > questions.length ? "error" : "info"} showIcon message={mode === "random" && randomCount > questions.length ? `题量不足：需要 ${randomCount} 题，当前 ${questions.length} 题，服务端也会阻止下发。` : "试卷创建成功后自动回填到当前考试设置。"} /><Space><Button onClick={onClose}>取消并返回考试设置</Button><Button type="primary" disabled={name.trim().length < 2 || (mode === "random" && randomCount > questions.length)} loading={saving} onClick={() => void createPaper()}>创建并回填试卷</Button></Space></Space><Modal title="新建题库" open={bankOpen} footer={null} onCancel={() => setBankOpen(false)}><Form layout="vertical" onFinish={async ({ bankName }) => { try { const bank = await api<Bank>("/api/question-banks", json("POST", { name: bankName, ...scope })); await qc.invalidateQueries({ queryKey: ["question-banks"] }); setBankOpen(false); await loadQuestions(bank.id); message.success("题库已创建并选中"); } catch (error) { message.error(errorText(error)); } }}><Form.Item name="bankName" label="题库名称" rules={[{ required: true, min: 2 }]}><Input /></Form.Item><Button type="primary" htmlType="submit">创建并返回</Button></Form></Modal><Modal title="新建题目" open={questionOpen} footer={null} onCancel={() => setQuestionOpen(false)}><Form layout="vertical" initialValues={{ type: "single_choice", options: "正确选项\n错误选项", correct: "正确选项" }} onFinish={async (values) => { try { await api(`/api/question-banks/${bankId}/questions`, json("POST", { type: values.type, prompt: values.prompt, options: String(values.options).split("\n").map((item) => item.trim()).filter(Boolean), correct: String(values.correct).split("\n").map((item) => item.trim()).filter(Boolean), explanation: values.explanation })); setQuestionOpen(false); await loadQuestions(bankId!); await qc.invalidateQueries({ queryKey: ["question-banks"] }); message.success("题目已创建并返回"); } catch (error) { message.error(errorText(error)); } }}><Form.Item name="type" label="题型"><Select options={[{ value: "single_choice", label: "单选" }, { value: "multiple_choice", label: "多选" }, { value: "true_false", label: "判断" }]} /></Form.Item><Form.Item name="prompt" label="题干" rules={[{ required: true, min: 2 }]}><Input.TextArea /></Form.Item><Form.Item name="options" label="选项（每行一个）" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item><Form.Item name="correct" label="正确答案（每行一个，必须与选项完全一致）" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item><Form.Item name="explanation" label="解析"><Input.TextArea /></Form.Item><Button type="primary" htmlType="submit">创建并返回</Button></Form></Modal></Modal>;
}
