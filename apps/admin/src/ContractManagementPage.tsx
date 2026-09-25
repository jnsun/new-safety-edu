import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Checkbox, Empty, Input, Modal, Result, Select, Skeleton, Space, Table, Tag, message } from "antd";
import { DownloadOutlined, LockOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError, api, json } from "./api";
import { ProjectDetailPage } from "./contracts/ProjectDetailPage";
import { ProjectFormDrawer } from "./contracts/ProjectFormDrawer";
import { bidLabels, projectStatusLabels, type ContractAccess, type Organization, type ProjectCandidate, type ProjectDetail, type ProjectRow } from "./contracts/model";
import "./contracts/contracts.css";

const projectKey = ["contracts", "projects"] as const;

export function useContractAccess(accountId: string) {
  return useQuery({ queryKey: ["contracts", accountId, "access"], queryFn: () => api<ContractAccess>("/api/contracts/access"), retry: false, refetchOnMount: "always" });
}

export function ContractManagementPage({ accountId }: { accountId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const accessQuery = useContractAccess(accountId);
  const access = accessQuery.data;
  const [draftFilters, setDraftFilters] = useState({ q: "", bidStatus: "", organizationId: "" });
  const [filters, setFilters] = useState(draftFilters);
  const [page, setPage] = useState(1);
  const applyFilters = () => { setPage(1); setFilters(draftFilters); };
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.bidStatus) params.set("bidStatus", filters.bidStatus);
    if (filters.organizationId) params.set("organizationId", filters.organizationId);
    params.set("page", String(page));
    params.set("pageSize", "20");
    return params.toString();
  }, [filters, page]);
  const projects = useQuery({ queryKey: [...projectKey, queryString], queryFn: () => api<{ items: ProjectRow[]; total: number }>(`/api/contracts/projects?${queryString}`), enabled: !!access?.canEnter, retry: false });
  const organizations = useQuery({ queryKey: ["contracts", "organizations"], queryFn: () => api<Organization[]>("/api/contracts/organizations"), enabled: !!access?.canEnter, retry: false });
  const candidates = useQuery({ queryKey: ["contracts", "project-candidates"], queryFn: () => api<ProjectCandidate[]>("/api/contracts/project-candidates"), enabled: !!access?.canCreateProject, retry: false });
  const detailMatch = location.pathname.match(/^\/contracts\/projects\/([0-9a-f-]{36})(?:\/edit)?$/i);
  const selectedId = detailMatch?.[1];
  const detail = useQuery({ queryKey: ["contracts", "project", selectedId], queryFn: () => api<ProjectDetail>(`/api/contracts/projects/${selectedId}`), enabled: !!selectedId && !!access?.canEnter, retry: false });
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["contracts"] }); };
  const createOpen = location.pathname === "/contracts/projects/new";
  const editOpen = !!selectedId && location.pathname.endsWith("/edit");
  const adoptOpen = location.pathname === "/contracts/projects/adopt";
  const detailOpen = !!selectedId;
  const activeTab = new URLSearchParams(location.search).get("tab") ?? "main";
  const [conflictOpen, setConflictOpen] = useState(false);

  if (accessQuery.isLoading) return <ContractLoading label="正在核对项目与合同权限…" />;
  if (accessQuery.isError) return <ContractRequestError error={accessQuery.error} onRetry={() => void accessQuery.refetch()} />;
  if (!access?.canEnter) return <div className="contract-state-page"><Result icon={<LockOutlined />} status="403" title="无权访问项目与合同" subTitle="当前账号没有合同管理能力，或该项目不在你的数据范围内。页面不会显示项目名称、合同编号或附件信息。" extra={<Button type="primary" onClick={() => navigate("/")}>返回统一平台</Button>} /></div>;

  if (adoptOpen) return <AdoptProjectPage candidates={candidates.data ?? []} loading={candidates.isLoading} onCancel={() => navigate("/contracts")} onSaved={async (id) => { await refresh(); navigate(`/contracts/projects/${id}`); }} />;
  if (detailOpen) return <>
    {detail.isError ? <ContractRequestError error={detail.error} onRetry={() => void detail.refetch()} onBack={() => navigate("/contracts")} /> : <ProjectDetailPage access={access} project={detail.data} loading={detail.isLoading} organizations={organizations.data ?? []} activeTab={activeTab} onBack={() => navigate("/contracts")} onEdit={() => navigate(`/contracts/projects/${selectedId}/edit${location.search}`)} onTabChange={(tab) => navigate(`/contracts/projects/${selectedId}?tab=${tab}`, { replace: true })} onChanged={refresh} />}
    <ProjectFormDrawer open={editOpen} project={detail.data} organizations={organizations.data ?? []} onClose={() => navigate(`/contracts/projects/${selectedId}${location.search}`)} onSaved={async (id) => { await refresh(); navigate(`/contracts/projects/${id}`); }} onConflict={() => { setConflictOpen(true); }} />
    <ConflictModal open={conflictOpen} onReload={() => { setConflictOpen(false); void detail.refetch(); }} onCancel={() => { setConflictOpen(false); navigate(`/contracts/projects/${selectedId}`); }} />
  </>;

  return <div className="contract-ledger-page">
    <header className="contract-page-header"><div><h1>项目与合同台账</h1><p>从项目主档开始，按投标、签约与实施阶段维护合同资料。</p></div><Space wrap>
      {access.canExport && <Button icon={<DownloadOutlined />} onClick={() => window.location.assign("/api/contracts/projects-export.csv")}>导出台账</Button>}
      {access.canCreateProject && <Button onClick={() => navigate("/contracts/projects/adopt")}>纳入现有项目</Button>}
      {access.canCreateProject && <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/contracts/projects/new")}>新建项目</Button>}
    </Space></header>
    <Alert className="contract-scope-alert" showIcon type="info" message="金额口径" description="本页仅呈现合同基础信息；回款、开票与应收余额以财务应收账款系统为准。" />
    <Card className="contract-filter-panel">
      <div className="contract-filter-grid">
        <label><span>项目 / 主合同</span><Input value={draftFilters.q} allowClear prefix={<SearchOutlined />} placeholder="项目名称、编号或主合同编号" onChange={(event) => setDraftFilters((value) => ({ ...value, q: event.target.value }))} onPressEnter={applyFilters} /></label>
        <label><span>投标结果</span><Select value={draftFilters.bidStatus || undefined} allowClear placeholder="全部" options={Object.entries(bidLabels).map(([value, label]) => ({ value, label }))} onChange={(bidStatus = "") => setDraftFilters((value) => ({ ...value, bidStatus }))} /></label>
        <label><span>责任经营实体</span><Select value={draftFilters.organizationId || undefined} allowClear showSearch optionFilterProp="label" placeholder="全部" options={(organizations.data ?? []).map((item) => ({ value: item.id, label: item.name }))} onChange={(organizationId = "") => setDraftFilters((value) => ({ ...value, organizationId }))} /></label>
        <Button type="primary" onClick={applyFilters}>查询</Button>
      </div>
      <p>服务端按人员、合同能力与数据范围筛选；页面条件不会扩大权限。</p>
    </Card>
    <Card className="contract-ledger-card">
      {projects.isError ? <ContractRequestError compact error={projects.error} onRetry={() => void projects.refetch()} /> : <Table rowKey="id" loading={projects.isLoading} dataSource={projects.data?.items ?? []} scroll={{ x: 980 }} pagination={{ current: page, pageSize: 20, total: projects.data?.total ?? 0, showSizeChanger: false, showTotal: (total) => `共 ${total} 个项目`, onChange: setPage }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filters.q || filters.bidStatus || filters.organizationId ? "没有符合当前筛选条件的项目" : "暂无项目"}>{access.canCreateProject && !filters.q && !filters.bidStatus && !filters.organizationId && <Button type="link" onClick={() => navigate("/contracts/projects/new")}>＋ 创建第一个项目</Button>}</Empty> }} columns={[
        { title: "项目名称 / 编号", width: 300, fixed: "left", render: (_, row) => <button className="contract-project-link" type="button" onClick={() => navigate(`/contracts/projects/${row.id}`)}><strong>{row.name}</strong><span>{row.code}</span></button> },
        { title: "责任经营实体", width: 210, render: (_, row) => row.responsibleOrganization.name, ellipsis: true },
        { title: "投标结果", width: 130, render: (_, row) => <Tag color={row.contractBidStatus === "won" ? "green" : row.contractBidStatus === "lost" ? "red" : "default"}>{bidLabels[row.contractBidStatus] ?? row.contractBidStatus}</Tag> },
        { title: "主合同", width: 190, render: (_, row) => row.mainContract ? <><span>{row.mainContract.contractNo}</span> {!row.mainContract.signedAt && <Tag color="orange">未签署</Tag>}</> : <span className="contract-muted">尚未登记</span>, ellipsis: true },
        { title: "分包合同", width: 100, align: "right", render: (_, row) => row._count?.contractSubcontracts ?? 0 },
        { title: "操作", width: 110, fixed: "right", render: (_, row) => <Button type="link" onClick={() => navigate(`/contracts/projects/${row.id}`)}>查看详情</Button> },
      ]} />}
    </Card>
    <ProjectFormDrawer open={createOpen} project={undefined} organizations={organizations.data ?? []} onClose={() => navigate("/contracts")} onSaved={async (id) => { await refresh(); navigate(`/contracts/projects/${id}`); }} onConflict={() => setConflictOpen(true)} />
  </div>;
}

function AdoptProjectPage({ candidates, loading, onCancel, onSaved }: { candidates: ProjectCandidate[]; loading: boolean; onCancel(): void; onSaved(id: string): Promise<void> }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [bidStatus, setBidStatus] = useState("bidding");
  const selected = candidates.find((item) => item.id === selectedId);
  const visible = candidates.filter((item) => `${item.name} ${item.code}`.toLowerCase().includes(search.toLowerCase()));
  const activate = useMutation({ mutationFn: () => api(`/api/contracts/project-candidates/${selectedId}/activate`, json("POST", { bidStatus })), onSuccess: async () => { message.success("现有项目已纳入项目与合同管理"); await onSaved(selectedId!); }, onError: (error: Error) => message.error(error.message) });
  return <div className="contract-adopt-page">
    <header className="contract-page-header"><div><Button type="text" onClick={onCancel}>← 返回台账</Button><h1>纳入现有项目</h1><p>只从有权访问的现有 Project 中选择；人工确认后建立合同模块关联。</p></div></header>
    <Alert type="warning" showIcon message="禁止自动匹配" description="编号或名称相似只用于人工判断，系统不会直接按编号建立关联。" />
    <div className="contract-adopt-grid">
      <Card title="1 · 选择现有项目"><Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目名称或编号" />
        <div className="contract-candidate-list">{loading ? <Skeleton active /> : visible.length ? visible.map((item) => <button type="button" key={item.id} className={item.id === selectedId ? "is-selected" : ""} onClick={() => { setSelectedId(item.id); setConfirmed(false); }}><span className="contract-radio" aria-hidden="true" /><span><strong>{item.name} · {item.code}</strong><small>{item.responsibleOrganization.name} · {projectStatusLabels[item.status] ?? item.status}</small></span><em>{item.id === selectedId ? "已选中" : "尚未纳入"}</em></button>) : <Empty description="没有可纳入的项目" />}</div>
      </Card>
      <Card className="contract-confirm-card" title="2 · 确认关联"><p>不会复制人员、组织或项目；安全培训/月报行为保持不变。</p>{selected ? <>
        <dl><dt>项目名称</dt><dd>{selected.name}</dd><dt>项目编号</dt><dd>{selected.code}</dd><dt>责任经营实体</dt><dd>{selected.responsibleOrganization.name}</dd><dt>现有项目状态</dt><dd>{projectStatusLabels[selected.status] ?? selected.status}</dd><dt>合同模块投标结果</dt><dd><Select value={bidStatus} onChange={setBidStatus} options={Object.entries(bidLabels).map(([value, label]) => ({ value, label }))} /></dd><dt>主合同</dt><dd>尚未登记</dd></dl>
        <div className="contract-manual-confirm"><Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}>已人工核对并确认关联</Checkbox></div><Button type="primary" block disabled={!confirmed} loading={activate.isPending} onClick={() => activate.mutate()}>确认纳入</Button>
      </> : <Empty description="请先选择一个现有项目" />}</Card>
    </div>
  </div>;
}

function ContractLoading({ label }: { label: string }) { return <div className="contract-state-page"><Card><Skeleton active /><p>{label}</p></Card></div>; }
function ContractRequestError({ error, onRetry, onBack, compact = false }: { error: unknown; onRetry(): void; onBack?: () => void; compact?: boolean }) {
  const session = error instanceof ApiError && error.status === 401;
  return <div className={compact ? "contract-inline-state" : "contract-state-page"}><Result status={session ? "warning" : "error"} title={session ? "登录状态已失效" : "暂时无法加载"} subTitle={session ? "为保护业务数据，请重新登录后返回原目标页。" : error instanceof Error ? error.message : "网络或服务异常，尚未对任何数据执行保存。"} extra={<Space><Button type="primary" icon={<ReloadOutlined />} onClick={onRetry}>{session ? "重新登录" : "重新加载"}</Button>{onBack && <Button onClick={onBack}>返回台账</Button>}</Space>} /></div>;
}
function ConflictModal({ open, onReload, onCancel }: { open: boolean; onReload(): void; onCancel(): void }) { return <Modal className="contract-conflict-modal" open={open} footer={null} closable={false}><Result status="warning" title="项目已被他人更新" subTitle="你打开表单后，项目数据已经发生变化。为避免覆盖，请重新载入最新内容再决定是否修改。" extra={<Space><Button type="primary" onClick={onReload}>载入最新版本</Button><Button onClick={onCancel}>放弃本次修改</Button></Space>} /></Modal>; }
