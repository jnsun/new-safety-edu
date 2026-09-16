import { useMemo, useState } from "react";
import { Alert, Button, Card, Col, Form, Result, Row, Select, Space, Spin, Table, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "./api";
import { ReceivablesLedger } from "./ReceivablesLedger";
import {
  formatReceivablesMoney,
  receivablesQueryKey,
  receivablesScopedQueryKey,
  receivablesScopeFingerprint,
  resolveReceivablesRoute,
  usableReceivablesAccess,
  usableReceivablesData,
  type ReceivablesAccess,
  type ReceivablesDashboardResponse,
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

function ReceivablesDashboard({ accountId, scopeFingerprint }: { accountId: string; scopeFingerprint: string }) {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<{
    status: NonNullable<ReceivablesFilters["status"]>;
    settlement: NonNullable<ReceivablesFilters["settlement"]>;
    anomaly: ReceivablesFilters["anomaly"] | undefined;
  }>({ status: "active", settlement: "unsettled", anomaly: undefined });
  const requestPath = useMemo(() => {
    const search = queryString(filters);
    return `/api/receivables/dashboard${search ? `?${search}` : ""}`;
  }, [filters]);
  const dashboard = useQuery({
    queryKey: receivablesScopedQueryKey(accountId, scopeFingerprint, "dashboard", filters),
    queryFn: () => api<ReceivablesDashboardResponse>(requestPath),
    retry: false,
  });
  const currentDashboard = usableReceivablesData(dashboard);
  const amountCards = currentDashboard ? [
    ["台账数量", String(currentDashboard.amounts.activeLedgerCount)],
    ["决算金额", formatReceivablesMoney(currentDashboard.amounts.finalAmount)],
    ["开票金额", formatReceivablesMoney(currentDashboard.amounts.invoicedAmount)],
    ["到账金额", formatReceivablesMoney(currentDashboard.amounts.receivedAmount)],
    ["账内应收", formatReceivablesMoney(currentDashboard.amounts.internalReceivable)],
    ["账外应收", formatReceivablesMoney(currentDashboard.amounts.externalReceivable)],
    ["应收余额", formatReceivablesMoney(currentDashboard.amounts.balance)],
    ["核销金额", formatReceivablesMoney(currentDashboard.amounts.writeoffAmount)],
  ] as const : [];

  return (
    <div className="receivables-page">
      <div className="page-title receivables-page-title">
        <div>
          <Typography.Title level={3}>应收账款看板</Typography.Title>
          <Typography.Text type="secondary">以下数字均来自当前权限范围内的服务端聚合。</Typography.Text>
        </div>
        <Button type="primary" onClick={() => navigate("/receivables/ledger")}>查看台账</Button>
      </div>
      <Card className="filters" aria-label="看板筛选">
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
          <Row gutter={[16, 16]}>
            {amountCards.map(([label, value]) => (
              <Col xs={24} sm={12} xl={6} key={label}>
                <Card className="receivables-metric">
                  <Typography.Text type="secondary">{label}</Typography.Text>
                  <div className="receivables-metric-value">{value}</div>
                </Card>
              </Col>
            ))}
          </Row>
          <Row gutter={[16, 16]} className="receivables-groupings">
            <Col xs={24} lg={12}>
              <Card title="记录状态分布">
                <Table
                  rowKey={(row) => row.value ?? "未设置"}
                  size="small"
                  pagination={false}
                  locale={{ emptyText: "当前筛选下没有状态分组" }}
                  dataSource={currentDashboard.statuses}
                  columns={[{ title: "状态", dataIndex: "value", render: (value: string | null) => value === "active" ? "有效" : value === "voided" ? "已作废" : "未设置" }, { title: "数量", dataIndex: "count", align: "right" }]}
                />
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="待核对事项">
                <Table
                  rowKey={(row) => row.value ?? "none"}
                  size="small"
                  pagination={false}
                  locale={{ emptyText: "当前筛选下没有待核对事项" }}
                  dataSource={currentDashboard.anomalies}
                  columns={[{ title: "事项", dataIndex: "value", render: (value: keyof typeof anomalyLabels | null) => value ? anomalyLabels[value] : "无异常" }, { title: "数量", dataIndex: "count", align: "right" }]}
                />
              </Card>
            </Col>
          </Row>
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

export function ReceivablesPage({ accountId }: { accountId: string }) {
  const location = useLocation();
  const route = resolveReceivablesRoute(location.pathname);
  const access = useReceivablesAccess(accountId, route !== "redirect");
  const currentAccess = usableReceivablesAccess(access);
  if (route === "redirect") return <Navigate to="/receivables" replace />;
  if (access.isFetching) return <div className="receivables-state"><Spin tip="正在核验应收账款权限…" /></div>;
  if (access.isError || !currentAccess) return <Result status="error" title="权限核验失败" subTitle="未显示任何财务数据。请重新登录或稍后重试。" extra={<Button onClick={() => void access.refetch()}>重新核验</Button>} />;
  if (!currentAccess.canEnter || !currentAccess.canReadLedger) return <AccessState access={currentAccess} />;
  const scopeFingerprint = receivablesScopeFingerprint(currentAccess);
  return route === "ledger" ? <ReceivablesLedger accountId={accountId} scopeFingerprint={scopeFingerprint} /> : <ReceivablesDashboard accountId={accountId} scopeFingerprint={scopeFingerprint} />;
}
