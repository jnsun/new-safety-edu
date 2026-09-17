import { useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Alert, Button, Card, Checkbox, Form, Input, message, Modal, Result, Select, Space, Spin, Tabs, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, json } from "./api";
import { ReceivablesLedger } from "./ReceivablesLedger";
import { ReceivablesAdmin } from "./ReceivablesAdmin";
import { ReceivablesTransfers } from "./ReceivablesTransfers";
import {
  formatReceivablesMoney,
  defaultReceivablesDashboardPreference,
  normalizeReceivablesDashboardPreference,
  receivablesDashboardCardIds,
  receivablesDashboardMode,
  receivablesQueryKey,
  receivablesErrorKind,
  receivablesScopeQueryPrefix,
  receivablesScopedQueryKey,
  receivablesScopeFingerprint,
  resolveReceivablesRoute,
  usableReceivablesAccess,
  usableReceivablesData,
  type ReceivablesAccess,
  type ReceivablesDashboardResponse,
  type ReceivablesDashboardCardId,
  type ReceivablesDashboardCardPreference,
  type ReceivablesFilters,
} from "./receivables-types";

const anomalyLabels = {
  final_amount_missing: "决算未定",
  over_received: "超收",
  writeoff_adjustment_required: "核销待调减",
} as const;

export function useReceivablesAccess(accountId: string, enabled = true) {
  return useQuery({
    queryKey: receivablesQueryKey(accountId, "access"),
    queryFn: () => api<ReceivablesAccess>("/api/receivables/access"),
    enabled,
    retry: false,
    refetchOnMount: "always",
  });
}

function queryString(filters: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return query.toString();
}

function ReceivablesDashboard({ accountId, scopeFingerprint, access }: { accountId: string; scopeFingerprint: string; access: ReceivablesAccess }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<{
    status: NonNullable<ReceivablesFilters["status"]>;
    settlement: NonNullable<ReceivablesFilters["settlement"]>;
    anomaly: ReceivablesFilters["anomaly"] | undefined;
  }>({ status: "active", settlement: "unsettled", anomaly: undefined });
  const [editingDashboard, setEditingDashboard] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [savedLayout, setSavedLayout] = useState<ReceivablesDashboardCardPreference[]>(defaultReceivablesDashboardPreference.map((item) => ({ ...item })));
  const [draftLayout, setDraftLayout] = useState<ReceivablesDashboardCardPreference[]>(defaultReceivablesDashboardPreference.map((item) => ({ ...item })));
  const requestPath = useMemo(() => {
    const search = queryString(filters);
    return `/api/receivables/dashboard${search ? `?${search}` : ""}`;
  }, [filters]);
  const dashboard = useQuery({
    queryKey: receivablesScopedQueryKey(accountId, scopeFingerprint, "dashboard", filters),
    queryFn: () => api<ReceivablesDashboardResponse>(requestPath),
    retry: false,
  });
  const dashboardPreference = useQuery({
    queryKey: receivablesQueryKey(accountId, "dashboard-preference"),
    queryFn: () => api<ReceivablesDashboardCardPreference[]>("/api/receivables/preferences/dashboard"),
    retry: false,
  });
  useEffect(() => {
    if (!dashboardPreference.data) return;
    const normalized = normalizeReceivablesDashboardPreference(dashboardPreference.data);
    setSavedLayout(normalized);
    if (!editingDashboard) setDraftLayout(normalized);
  }, [dashboardPreference.data, editingDashboard]);
  const saveDashboardPreference = useMutation({
    mutationFn: (value: ReceivablesDashboardCardPreference[]) => api<ReceivablesDashboardCardPreference[]>("/api/receivables/preferences/dashboard", json("PUT", value)),
    onSuccess: (value) => {
      const normalized = normalizeReceivablesDashboardPreference(value);
      setSavedLayout(normalized); setDraftLayout(normalized); setEditingDashboard(false);
      void queryClient.invalidateQueries({ queryKey: receivablesQueryKey(accountId, "dashboard-preference") });
      message.success("个人看板已保存");
    },
    onError: (error: Error) => message.error(error.message),
  });
  const currentDashboard = usableReceivablesData(dashboard);
  useEffect(() => { if (dashboard.error && receivablesErrorKind(dashboard.error) === "revoked") { queryClient.removeQueries({ queryKey: receivablesScopeQueryPrefix(accountId, scopeFingerprint) }); void queryClient.invalidateQueries({ queryKey: receivablesQueryKey(accountId, "access") }); } }, [dashboard.error, accountId, scopeFingerprint, queryClient]);
  const mode = receivablesDashboardMode(access);
  const ledgerPath = (extra: Record<string, string | undefined> = {}) => {
    const search = queryString({ status: filters.status, settlement: filters.settlement, anomaly: filters.anomaly, ...extra });
    return `/receivables/ledger${search ? `?${search}` : ""}`;
  };
  const anomalyItems = currentDashboard ? [
    { key: "final_amount_missing", label: "决算金额待补充", detail: mode.kind === "overview" ? "查看金额口径尚未完整的记录" : "金额口径尚未完整，应收余额暂不能计算", count: currentDashboard.amounts.finalAmountMissingCount, target: ledgerPath({ anomaly: "final_amount_missing" }) },
    { key: "over_received", label: "到账金额超过应收", detail: mode.kind === "overview" ? "查看到账金额超过应收的记录" : "请核对回款、决算金额或历史录入", count: currentDashboard.amounts.overReceivedCount, target: ledgerPath({ anomaly: "over_received" }) },
    { key: "writeoff_adjustment_required", label: "核销金额待调减", detail: mode.kind === "overview" ? "查看需要调整核销金额的记录" : "后续回款已改变原核销条件", count: currentDashboard.amounts.writeoffAdjustmentRequiredCount, target: ledgerPath({ anomaly: "writeoff_adjustment_required" }) },
  ] : [];
  const collectionItems = [
    { key: "progress", label: "更新催收进展", detail: "填写最新催收时间、对方反馈和下一步计划", target: ledgerPath(), count: undefined },
    { key: "unsettled", label: "查看未结账款", detail: "按债权状态和单位定位需要跟进的项目", target: ledgerPath({ settlement: "unsettled" }), count: undefined },
    { key: "attachment", label: "补充催收附件", detail: "进入台账详情上传沟通和催收材料", target: ledgerPath(), count: undefined },
  ];
  const summaryItems = currentDashboard ? [
    ["到账金额", formatReceivablesMoney(currentDashboard.amounts.receivedAmount)],
    ["开票金额", formatReceivablesMoney(currentDashboard.amounts.invoicedAmount)],
    ["有效台账", `${currentDashboard.amounts.activeLedgerCount} 条`],
  ] as const : [];
  const cardLabels: Record<ReceivablesDashboardCardId, string> = {
    balance: "应收余额", amounts: "金额概览", ledgerCount: "台账数量", anomalies: "异常提醒",
    collection: "催收工作", debtStatuses: "债权状态", creditorUnits: "单位分布",
    monthlyCashflow: "月度开票／回款趋势", departmentBalances: "财务归属部门应收余额 TOP8",
    customerBalances: "客户应收余额 TOP10", customerTypes: "客户属性构成", collectionFollowups: "催收跟踪 TOP10",
  };
  const visibleLayout = editingDashboard ? draftLayout : savedLayout;
  const updateCard = (id: ReceivablesDashboardCardId, patch: Partial<ReceivablesDashboardCardPreference>) => setDraftLayout((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const reorderCard = (sourceId: ReceivablesDashboardCardId, targetId: ReceivablesDashboardCardId) => setDraftLayout((items) => {
    const sourceIndex = items.findIndex((item) => item.id === sourceId);
    const targetIndex = items.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items;
    const next = [...items]; const [source] = next.splice(sourceIndex, 1); if (!source) return items; next.splice(targetIndex, 0, source); return next;
  });
  const startResize = (event: ReactPointerEvent<HTMLButtonElement>, card: ReceivablesDashboardCardPreference) => {
    event.preventDefault(); event.stopPropagation();
    const grid = event.currentTarget.closest(".receivables-dashboard-grid") as HTMLElement | null;
    if (!grid) return;
    const startX = event.clientX; const startY = event.clientY; const startWidth = card.w; const startHeight = card.h;
    const columnWidth = Math.max(1, (grid.clientWidth - 11 * 12) / 12);
    const move = (moveEvent: PointerEvent) => updateCard(card.id, {
      w: Math.max(3, Math.min(12, startWidth + Math.round((moveEvent.clientX - startX) / columnWidth))),
      h: Math.max(2, Math.min(8, startHeight + Math.round((moveEvent.clientY - startY) / 64))),
    });
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop, { once: true });
  };
  const amountBars = (values: ReceivablesDashboardResponse["departmentBalances"], filterName?: "debtStatus" | "creditorUnit") => {
    const maximum = Math.max(1, ...values.map((item) => Math.max(0, Number(item.amount))));
    return <div className="receivables-dashboard-bars">{values.length === 0 && <Typography.Text type="secondary">当前范围暂无数据</Typography.Text>}{values.map((item) => {
      const content = <><span title={item.value ?? "未设置"}>{item.value ?? "未设置"}</span><i><em style={{ width: `${Math.max(2, Math.max(0, Number(item.amount)) / maximum * 100)}%` }} /></i><b>{formatReceivablesMoney(item.amount)}<small>{item.count} 笔</small></b></>;
      return filterName && item.value ? <button type="button" key={item.value} onClick={() => navigate(ledgerPath({ [filterName]: item.value! }))}>{content}</button> : <div key={item.value ?? "未设置"}>{content}</div>;
    })}</div>;
  };
  const renderCardContent = (id: ReceivablesDashboardCardId) => {
    if (!currentDashboard) return null;
    if (id === "balance") return <><div className="receivables-balance-value">{formatReceivablesMoney(currentDashboard.amounts.balance)}</div><Typography.Text type="secondary">当前筛选范围</Typography.Text><Button className="receivables-balance-action" onClick={() => navigate(ledgerPath())}>查看当前范围台账</Button></>;
    if (id === "amounts") return <div className="receivables-summary-grid">{summaryItems.slice(0, 2).map(([label, value]) => <div key={label}><Typography.Text type="secondary">{label}</Typography.Text><strong>{value}</strong></div>)}</div>;
    if (id === "ledgerCount") return <div className="receivables-dashboard-metric"><strong>{currentDashboard.amounts.activeLedgerCount}</strong><span>条有效台账</span></div>;
    if (id === "anomalies") return <div className="receivables-action-list">{anomalyItems.map((item) => <button type="button" className="receivables-action-row" key={item.key} onClick={() => navigate(item.target)}><span><strong>{item.label}</strong><small>{item.detail}</small></span><b className={item.count ? "is-active" : ""}>{item.count}</b></button>)}</div>;
    if (id === "collection") return <div className="receivables-action-list">{collectionItems.map((item) => <button type="button" className="receivables-action-row" key={item.key} onClick={() => navigate(item.target)}><span><strong>{item.label}</strong><small>{item.detail}</small></span><b className="receivables-action-enter">进入</b></button>)}</div>;
    if (id === "debtStatuses") return amountBars(currentDashboard.debtStatuses, "debtStatus");
    if (id === "creditorUnits") return amountBars(currentDashboard.creditorUnits, "creditorUnit");
    if (id === "departmentBalances") return amountBars(currentDashboard.departmentBalances);
    if (id === "customerBalances") return amountBars(currentDashboard.customerBalances);
    if (id === "customerTypes") return amountBars(currentDashboard.customerTypes);
    if (id === "monthlyCashflow") {
      const maximum = Math.max(1, ...currentDashboard.monthlyCashflow.flatMap((item) => [Number(item.invoicedAmount), Number(item.receivedAmount)]));
      return <div className="receivables-cashflow-chart" aria-label="最近十二个月开票与回款趋势"><div className="receivables-chart-legend"><span className="is-invoice">开票</span><span className="is-receipt">回款</span></div><div className="receivables-cashflow-columns">{currentDashboard.monthlyCashflow.map((item) => <div key={item.month} title={`${item.month} 开票 ${formatReceivablesMoney(item.invoicedAmount)}，回款 ${formatReceivablesMoney(item.receivedAmount)}`}><i><em className="is-invoice" style={{ height: `${Number(item.invoicedAmount) / maximum * 100}%` }} /><em className="is-receipt" style={{ height: `${Number(item.receivedAmount) / maximum * 100}%` }} /></i><span>{item.month.slice(5)}</span></div>)}</div></div>;
    }
    return <div className="receivables-followup-list">{currentDashboard.collectionFollowups.length === 0 && <Typography.Text type="secondary">当前范围暂无待跟进账款</Typography.Text>}{currentDashboard.collectionFollowups.map((item) => <button type="button" key={item.id} onClick={() => navigate(`/receivables/ledger?ledgerId=${encodeURIComponent(item.id)}`)}><span><strong>{item.contractNo}</strong><small title={item.projectName ?? ""}>{item.projectName || "未填写项目名称"}</small></span><span>{item.financeDepartmentName}</span><b>{formatReceivablesMoney(item.balance)}</b><Tag color={item.debtStatus === "逾期" ? "red" : "default"}>{item.debtStatus || "未设置"}</Tag><time>{item.dunningDate || "未催收"}</time><span>{item.collectionOwner || "—"}</span></button>)}</div>;
  };

  return (
    <div className="receivables-page">
      <div className="page-title receivables-page-title">
        <div>
          <Typography.Title level={3}>{mode.title}</Typography.Title>
          <Typography.Text type="secondary">{mode.description}</Typography.Text>
        </div>
        <Button type="primary" onClick={() => navigate(mode.actionPath)}>{mode.actionLabel}</Button>
      </div>
      <Card className="filters receivables-filter-bar" aria-label="看板筛选">
        <Form layout="inline">
          <Form.Item label="记录状态">
            <Select
              aria-label="记录状态"
              value={filters.status}
              style={{ width: 132 }}
              options={[{ value: "active", label: "有效" }, { value: "voided", label: "已作废" }, { value: "all", label: "全部" }]}
              onChange={(status) => setFilters((current) => ({ ...current, status }))}
            />
          </Form.Item>
          <Form.Item label="结清状态">
            <Select
              aria-label="结清状态"
              value={filters.settlement}
              style={{ width: 132 }}
              options={[{ value: "unsettled", label: "未结" }, { value: "settled", label: "已结清" }, { value: "all", label: "全部" }]}
              onChange={(settlement) => setFilters((current) => ({ ...current, settlement }))}
            />
          </Form.Item>
          <Form.Item label="待核对事项">
            <Select
              allowClear
              aria-label="待核对事项"
              value={filters.anomaly ?? null}
              style={{ width: 172 }}
              placeholder="全部事项"
              options={Object.entries(anomalyLabels).map(([value, label]) => ({ value, label }))}
              onChange={(anomaly) => setFilters((current) => ({ ...current, anomaly }))}
            />
          </Form.Item>
        </Form>
      </Card>
      {dashboard.isFetching && <div className="receivables-state"><Spin tip="正在加载应收账款看板…" /></div>}
      {dashboard.isError && <Alert type="error" showIcon message="看板加载失败" description="未显示任何财务数据，请检查网络或权限后重试。" action={<Button onClick={() => void dashboard.refetch()}>重试</Button>} />}
      {currentDashboard && (
        <>
          <div className="receivables-dashboard-toolbar">
            <Typography.Text type="secondary">看板布局仅对当前账号生效</Typography.Text>
            {editingDashboard ? <Space size={6} wrap>
              <Button onClick={() => setCatalogOpen(true)}>添加卡片</Button>
              <Button onClick={() => setDraftLayout(defaultReceivablesDashboardPreference.map((item) => ({ ...item })))}>恢复默认</Button>
              <Button onClick={() => { setDraftLayout(savedLayout.map((item) => ({ ...item }))); setEditingDashboard(false); }}>取消</Button>
              <Button type="primary" loading={saveDashboardPreference.isPending} onClick={() => saveDashboardPreference.mutate(normalizeReceivablesDashboardPreference(draftLayout))}>保存布局</Button>
            </Space> : <Button onClick={() => { setDraftLayout(savedLayout.map((item) => ({ ...item }))); setEditingDashboard(true); }}>编辑看板</Button>}
          </div>
          {visibleLayout.length === 0 ? <div className="receivables-dashboard-empty"><Typography.Text type="secondary">当前看板没有卡片</Typography.Text>{editingDashboard && <Button type="primary" onClick={() => setCatalogOpen(true)}>添加卡片</Button>}</div> : <section className={`receivables-dashboard-grid${editingDashboard ? " is-editing" : ""}`} aria-label="个人应收账款看板">
            {visibleLayout.map((card) => <Card
              key={card.id}
              className={`receivables-dashboard-card card-${card.id}`}
              style={{ gridColumn: `span ${card.w}`, minHeight: card.h * 64 }}
              draggable={editingDashboard}
              onDragStart={(event) => event.dataTransfer.setData("text/plain", card.id)}
              onDragOver={(event) => { if (editingDashboard) event.preventDefault(); }}
              onDrop={(event) => { event.preventDefault(); reorderCard(event.dataTransfer.getData("text/plain") as ReceivablesDashboardCardId, card.id); }}
              title={editingDashboard ? <Input size="small" maxLength={40} aria-label={`${cardLabels[card.id]}卡片标题`} value={card.title ?? cardLabels[card.id]} onChange={(event) => updateCard(card.id, { title: event.target.value })} onPointerDown={(event) => event.stopPropagation()} /> : card.title ?? cardLabels[card.id]}
              extra={editingDashboard ? <Button size="small" type="text" danger onClick={() => setDraftLayout((items) => items.filter((item) => item.id !== card.id))}>移除</Button> : undefined}
            >
              <div className="receivables-dashboard-card-content">{renderCardContent(card.id)}</div>
              {editingDashboard && <button type="button" className="receivables-dashboard-resize" aria-label={`调整${cardLabels[card.id]}卡片大小`} onPointerDown={(event) => startResize(event, card)} />}
            </Card>)}
          </section>}
          <Modal title="添加看板卡片" open={catalogOpen} footer={null} onCancel={() => setCatalogOpen(false)} width={460}>
            <div className="receivables-dashboard-catalog">{receivablesDashboardCardIds.filter((id) => !draftLayout.some((item) => item.id === id)).map((id) => <Button key={id} onClick={() => { const fallback = defaultReceivablesDashboardPreference.find((item) => item.id === id) ?? { id, w: id === "monthlyCashflow" || id === "collectionFollowups" ? 12 : 6, h: id === "collectionFollowups" ? 6 : 4 }; setDraftLayout((items) => [...items, { ...fallback }]); }}>{cardLabels[id]}</Button>)}{receivablesDashboardCardIds.every((id) => draftLayout.some((item) => item.id === id)) && <Typography.Text type="secondary">全部卡片均已添加</Typography.Text>}</div>
          </Modal>
        </>
      )}
    </div>
  );
}

function AccessState({ access }: { access: ReceivablesAccess }) {
  if (access.state !== "ready") {
    const descriptions = {
      unconfigured: "尚未绑定财务资产部，请由公司管理员在组织管理中完成绑定。",
      pending_owner: "财务资产部当前缺少有效负责人，请在组织管理中完成任命。",
      pending_confirmation: "初始财务归属部门和业务字典尚未由负责人确认。",
    } as const;
    return <Result status="warning" title="应收账款管理待配置" subTitle={descriptions[access.state]} />;
  }
  return <Result status="403" title="无法进入应收账款管理" subTitle="财务权限未授予或已被撤销，请联系应收账款负责人。" />;
}

function ReceivablesSetup({ access }: { access: ReceivablesAccess }) {
  const navigate = useNavigate();
  if (access.state === "pending_owner") {
    return <Result status="warning" title="请先任命财务资产部负责人" subTitle="负责人激活账号后，才能核对配置并正式启用应收账款模块。" extra={<Button type="primary" onClick={() => navigate("/organization")}>前往组织与职责</Button>} />;
  }
  if (access.state === "pending_confirmation") {
    return <Result status="info" title="等待财务资产部负责人确认" subTitle="负责人确认财务归属部门和业务字典后，财务资产部成员将自动获得只读入口。" />;
  }
  return <Result status="warning" title="未找到唯一的财务资产部" subTitle="请在组织与职责中确认存在一个名称为“财务资产部”的部门。" extra={<Button type="primary" onClick={() => navigate("/organization")}>前往组织与职责</Button>} />;
}

export function ReceivablesPage({ accountId }: { accountId: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const route = resolveReceivablesRoute(location.pathname);
  const access = useReceivablesAccess(accountId, route !== "redirect");
  const [setupReviewed, setSetupReviewed] = useState(false);
  const currentAccess = usableReceivablesAccess(access);
  const currentScopeFingerprint = currentAccess ? receivablesScopeFingerprint(currentAccess) : undefined;
  const confirmSetup = useMutation({ mutationFn: () => api<ReceivablesAccess>("/api/receivables/setup/confirm", { method: "POST", body: "{}" }), onSuccess: async () => { message.success("初始配置已确认"); await access.refetch(); }, onError: async (error) => { message.error(error.message); if (receivablesErrorKind(error) === "revoked") { setSetupReviewed(false); if (currentScopeFingerprint) queryClient.removeQueries({ queryKey: receivablesScopeQueryPrefix(accountId, currentScopeFingerprint) }); await access.refetch(); } } });
  if (location.pathname.startsWith("/receivables/imports")) return <Navigate to="/receivables/data?tab=import" replace />;
  if (location.pathname.startsWith("/receivables/exports")) return <Navigate to="/receivables/data?tab=export" replace />;
  if (route === "redirect") return <Navigate to="/receivables" replace />;
  if (access.isFetching) return <div className="receivables-state"><Spin tip="正在核验应收账款权限…" /></div>;
  if (access.isError || !currentAccess) return <Result status="error" title="权限核验失败" subTitle="未显示任何财务数据。请重新登录或稍后重试。" extra={<Button onClick={() => void access.refetch()}>重新核验</Button>} />;
  const scopeFingerprint = currentScopeFingerprint!;
  if (!currentAccess.canEnter) {
    if (currentAccess.state === "pending_confirmation" && currentAccess.canManageConfiguration && currentAccess.canConfirmSetup) {
      if (route !== "departments" && route !== "dictionaries") return <Navigate to="/receivables/departments" replace />;
      return <div className="receivables-page"><Alert type="warning" showIcon message="待负责人确认初始配置" description={<Space direction="vertical"><Typography.Text>请分别核对财务归属部门与全部 12 类业务字典。确认前不会读取或开放任何财务台账。</Typography.Text><Space><Button type={route === "departments" ? "primary" : "default"} onClick={() => navigate("/receivables/departments")}>核对部门</Button><Button type={route === "dictionaries" ? "primary" : "default"} onClick={() => navigate("/receivables/dictionaries")}>核对字典</Button></Space><Checkbox checked={setupReviewed} onChange={(event) => setSetupReviewed(event.target.checked)}>我已核对部门和业务字典，确认启用后才能进入台账</Checkbox><Button type="primary" disabled={!setupReviewed} loading={confirmSetup.isPending} onClick={() => confirmSetup.mutate()}>确认初始配置</Button></Space>} /><ReceivablesAdmin accountId={accountId} scopeFingerprint={scopeFingerprint} access={currentAccess} section={route} /></div>;
    }
    if (currentAccess.canRecover) return <ReceivablesSetup access={currentAccess} />;
    return <AccessState access={currentAccess} />;
  }
  const allowed = route === "dashboard" || route === "ledger" ? currentAccess.canReadLedger
    : route === "data" ? currentAccess.canCreateLedger || currentAccess.canImport || currentAccess.canExport
        : route === "grants" ? currentAccess.canManageAccess
          : currentAccess.canManageConfiguration;
  if (!allowed) return <Result status="403" title="没有此项能力" subTitle="菜单与路由均按服务端返回的最新 capability 开放。" />;
  if (route === "ledger") return <ReceivablesLedger accountId={accountId} scopeFingerprint={scopeFingerprint} access={currentAccess} />;
  if (route === "data") {
    const requested = new URLSearchParams(location.search).get("tab") ?? (currentAccess.canCreateLedger ? "create" : currentAccess.canImport ? "import" : "export");
    const permitted = { create: currentAccess.canCreateLedger, import: currentAccess.canImport, export: currentAccess.canExport } as const;
    if (!(requested in permitted) || !permitted[requested as keyof typeof permitted]) return <Result status="403" title="没有此项能力" subTitle="该数据处理标签未向当前账号授权。" />;
    const items = [
      ...(currentAccess.canCreateLedger ? [{ key: "create", label: "新增记录", children: <ReceivablesTransfers accountId={accountId} scopeFingerprint={scopeFingerprint} access={currentAccess} section="create" /> }] : []),
      ...(currentAccess.canImport ? [{ key: "import", label: "Excel 导入", children: <ReceivablesTransfers accountId={accountId} scopeFingerprint={scopeFingerprint} access={currentAccess} section="imports" /> }] : []),
      ...(currentAccess.canExport ? [{ key: "export", label: "Excel 导出", children: <ReceivablesTransfers accountId={accountId} scopeFingerprint={scopeFingerprint} access={currentAccess} section="exports" /> }] : []),
    ];
    return <div className="receivables-page"><Tabs activeKey={requested} items={items} onChange={(tab) => navigate(`/receivables/data?tab=${tab}`)} /></div>;
  }
  if (route === "grants" || route === "departments" || route === "dictionaries") return <ReceivablesAdmin accountId={accountId} scopeFingerprint={scopeFingerprint} access={currentAccess} section={route} />;
  return <ReceivablesDashboard accountId={accountId} scopeFingerprint={scopeFingerprint} access={currentAccess} />;
}
