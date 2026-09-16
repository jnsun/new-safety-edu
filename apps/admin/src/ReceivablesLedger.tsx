import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Checkbox, Descriptions, Drawer, Form, Input, message, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { DownOutlined, SettingOutlined, UpOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TableColumnType, TableColumnsType, TableProps } from "antd";
import { api, json } from "./api";
import {
  defaultReceivablesColumnPreference,
  formatReceivablesDate,
  formatReceivablesMoney,
  normalizeReceivablesColumnPreference,
  receivablesQueryKey,
  receivablesScopedQueryKey,
  usableReceivablesData,
  type ReceivablesColumnId,
  type ReceivablesColumnPreference,
  type ReceivablesLedgerDetail,
  type ReceivablesLedgerListResponse,
  type ReceivablesLedgerRow,
  type ReceivablesSort,
} from "./receivables-types";

const columnLabels: Record<ReceivablesColumnId, string> = {
  financeDepartmentName: "财务归属部门", contractNo: "合同编号", projectName: "项目名称", customerName: "客户名称",
  creditorUnit: "单位", debtStatus: "债权状态", finalAmount: "决算金额", invoicedAmount: "开票金额",
  receivedAmount: "到账金额", internalReceivable: "账内应收", externalReceivable: "账外应收", balance: "应收余额",
  writeoffAmount: "核销金额", collectionOwner: "清收责任人", openingChargeDate: "最新挂账时间", anomaly: "待核对事项", updatedAt: "更新时间",
};
const anomalyLabels = { final_amount_missing: "决算未定", over_received: "超收", writeoff_adjustment_required: "核销待调减" } as const;
const sortable = new Set<ReceivablesSort>(["updatedAt", "contractNo", "projectName", "customerName", "debtStatus", "finalAmount", "invoicedAmount", "receivedAmount", "balance", "openingChargeDate"]);

const plain = (value: string | null) => value || "—";

type ListState = {
  page: number;
  pageSize: number;
  status: "active" | "voided" | "all";
  settlement: "unsettled" | "settled" | "all";
  financeDepartmentId: string | undefined;
  debtStatus: string | undefined;
  creditorUnit: string | undefined;
  anomaly: "over_received" | "writeoff_adjustment_required" | "final_amount_missing" | undefined;
  search: string | undefined;
  sort: ReceivablesSort;
  order: "asc" | "desc";
};

function listPath(state: ListState) {
  const query = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize), status: state.status, settlement: state.settlement, sort: state.sort, order: state.order });
  for (const key of ["financeDepartmentId", "debtStatus", "creditorUnit", "anomaly", "search"] as const) if (state[key]) query.set(key, state[key]!);
  return `/api/receivables/ledgers?${query}`;
}

function ColumnSettings({ value, onChange, onSave, saving }: { value: ReceivablesColumnPreference; onChange: (value: ReceivablesColumnPreference) => void; onSave: () => void; saving: boolean }) {
  const move = (id: ReceivablesColumnId, direction: -1 | 1) => {
    const index = value.order.indexOf(id);
    const target = index + direction;
    if (target < 0 || target >= value.order.length) return;
    const order = [...value.order];
    [order[index], order[target]] = [order[target]!, order[index]!];
    onChange({ ...value, order });
  };
  const setVisible = (id: ReceivablesColumnId, checked: boolean) => onChange({
    ...value,
    visible: checked ? [...value.visible, id] : value.visible.filter((item) => item !== id),
    frozen: checked ? value.frozen : value.frozen.filter((item) => item !== id),
  });
  const setFrozen = (id: ReceivablesColumnId, checked: boolean) => onChange({
    ...value,
    frozen: checked ? [...value.frozen, id] : value.frozen.filter((item) => item !== id),
  });
  return (
    <>
      <Typography.Paragraph type="secondary">调整列顺序、显示状态和左侧冻结列。读取台账不依赖偏好保存成功。</Typography.Paragraph>
      <div className="receivables-column-list">
        {value.order.map((id, index) => (
          <div className="receivables-column-item" key={id}>
            <Checkbox checked={value.visible.includes(id)} onChange={(event) => setVisible(id, event.target.checked)}>{columnLabels[id]}</Checkbox>
            <Checkbox disabled={!value.visible.includes(id)} checked={value.frozen.includes(id)} onChange={(event) => setFrozen(id, event.target.checked)}>冻结</Checkbox>
            <Space size={4}>
              <Button aria-label={`上移${columnLabels[id]}`} icon={<UpOutlined />} size="small" disabled={index === 0} onClick={() => move(id, -1)} />
              <Button aria-label={`下移${columnLabels[id]}`} icon={<DownOutlined />} size="small" disabled={index === value.order.length - 1} onClick={() => move(id, 1)} />
            </Space>
          </div>
        ))}
      </div>
      <div className="receivables-column-actions"><Button type="primary" disabled={value.visible.length === 0} loading={saving} onClick={onSave}>保存列设置</Button></div>
    </>
  );
}

export function ReceivablesLedger({ accountId, scopeFingerprint }: { accountId: string; scopeFingerprint: string }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ListState>({ page: 1, pageSize: 50, status: "active", settlement: "unsettled", financeDepartmentId: undefined, debtStatus: undefined, creditorUnit: undefined, anomaly: undefined, search: undefined, sort: "updatedAt", order: "desc" });
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [columnModalOpen, setColumnModalOpen] = useState(false);
  const [preference, setPreference] = useState<ReceivablesColumnPreference>(defaultReceivablesColumnPreference);
  const [draftPreference, setDraftPreference] = useState<ReceivablesColumnPreference>(defaultReceivablesColumnPreference);
  const requestPath = useMemo(() => listPath(state), [state]);
  const ledgers = useQuery({ queryKey: receivablesScopedQueryKey(accountId, scopeFingerprint, "ledgers", state), queryFn: () => api<ReceivablesLedgerListResponse>(requestPath), retry: false });
  const currentLedgers = usableReceivablesData(ledgers);
  const preferenceQuery = useQuery({ queryKey: receivablesQueryKey(accountId, "preferences", "columns"), queryFn: async () => normalizeReceivablesColumnPreference(await api<unknown>("/api/receivables/preferences/columns")), retry: false });
  useEffect(() => {
    if (!preferenceQuery.data) return;
    setPreference(preferenceQuery.data);
    setDraftPreference(preferenceQuery.data);
  }, [preferenceQuery.data]);
  const savePreference = useMutation({
    mutationFn: async () => normalizeReceivablesColumnPreference(await api<unknown>("/api/receivables/preferences/columns", json("PUT", draftPreference))),
    onSuccess: (saved) => {
      setPreference(saved);
      queryClient.setQueryData(receivablesQueryKey(accountId, "preferences", "columns"), saved);
      setColumnModalOpen(false);
      message.success("列设置已保存");
    },
    onError: (error) => message.error(`列设置保存失败：${(error as Error).message}`),
  });
  const detail = useQuery({
    queryKey: receivablesScopedQueryKey(accountId, scopeFingerprint, "ledger", selectedId),
    queryFn: () => api<ReceivablesLedgerDetail>(`/api/receivables/ledgers/${selectedId}`),
    enabled: !!selectedId,
    retry: false,
  });
  const currentDetail = usableReceivablesData(detail);

  const sortProperty = (id: ReceivablesColumnId) => state.sort === id ? { sortOrder: state.order === "asc" ? "ascend" as const : "descend" as const } : {};
  const moneyColumn = (id: ReceivablesColumnId): TableColumnType<ReceivablesLedgerRow> => ({
    title: columnLabels[id], key: id, dataIndex: id, width: 142, align: "right", sorter: sortable.has(id as ReceivablesSort), ...sortProperty(id), render: (value: string | null) => formatReceivablesMoney(value),
  });
  const definitions: Record<ReceivablesColumnId, TableColumnType<ReceivablesLedgerRow>> = {
    financeDepartmentName: { title: columnLabels.financeDepartmentName, key: "financeDepartmentName", dataIndex: "financeDepartmentName", width: 180 },
    contractNo: { title: columnLabels.contractNo, key: "contractNo", dataIndex: "contractNo", width: 170, sorter: true, ...sortProperty("contractNo") },
    projectName: { title: columnLabels.projectName, key: "projectName", dataIndex: "projectName", width: 220, sorter: true, ...sortProperty("projectName"), render: plain },
    customerName: { title: columnLabels.customerName, key: "customerName", dataIndex: "customerName", width: 200, sorter: true, ...sortProperty("customerName"), render: plain },
    creditorUnit: { title: columnLabels.creditorUnit, key: "creditorUnit", dataIndex: "creditorUnit", width: 150, render: plain },
    debtStatus: { title: columnLabels.debtStatus, key: "debtStatus", dataIndex: "debtStatus", width: 132, sorter: true, ...sortProperty("debtStatus"), render: plain },
    finalAmount: moneyColumn("finalAmount"), invoicedAmount: moneyColumn("invoicedAmount"), receivedAmount: moneyColumn("receivedAmount"),
    internalReceivable: moneyColumn("internalReceivable"), externalReceivable: moneyColumn("externalReceivable"), balance: moneyColumn("balance"), writeoffAmount: moneyColumn("writeoffAmount"),
    collectionOwner: { title: columnLabels.collectionOwner, key: "collectionOwner", dataIndex: "collectionOwner", width: 142, render: plain },
    openingChargeDate: { title: columnLabels.openingChargeDate, key: "openingChargeDate", dataIndex: "openingChargeDate", width: 150, sorter: true, ...sortProperty("openingChargeDate"), render: formatReceivablesDate },
    anomaly: { title: columnLabels.anomaly, key: "anomaly", dataIndex: "anomaly", width: 150, render: (value: ReceivablesLedgerRow["anomaly"]) => value ? <Tag color="warning">{anomalyLabels[value]}</Tag> : "—" },
    updatedAt: { title: columnLabels.updatedAt, key: "updatedAt", dataIndex: "updatedAt", width: 136, sorter: true, ...sortProperty("updatedAt"), render: formatReceivablesDate },
  };
  const columns = useMemo(() => {
    const ordered = [...preference.order.filter((id) => preference.frozen.includes(id)), ...preference.order.filter((id) => !preference.frozen.includes(id))];
    const visible: TableColumnsType<ReceivablesLedgerRow> = ordered.filter((id) => preference.visible.includes(id)).map((id) => preference.frozen.includes(id) ? { ...definitions[id], fixed: "left" as const } : definitions[id]);
    return [...visible, { title: "详情", key: "detail", fixed: "right" as const, width: 84, render: (_: unknown, row: ReceivablesLedgerRow) => <Button type="link" onClick={() => setSelectedId(row.id)}>查看</Button> }];
  }, [preference, state.sort, state.order]);
  const onTableChange: TableProps<ReceivablesLedgerRow>["onChange"] = (pagination, _filters, sorter) => {
    const selected = Array.isArray(sorter) ? sorter[0] : sorter;
    const key = selected?.columnKey;
    setState((current) => ({
      ...current,
      page: pagination.current ?? 1,
      pageSize: pagination.pageSize ?? current.pageSize,
      ...(selected?.order && typeof key === "string" && sortable.has(key as ReceivablesSort) ? { sort: key as ReceivablesSort, order: selected.order === "ascend" ? "asc" : "desc" } : {}),
    }));
  };

  return (
    <div className="receivables-page">
      <div className="page-title receivables-page-title">
        <div><Typography.Title level={3}>应收账款台账</Typography.Title><Typography.Text type="secondary">默认显示未结合同；筛选、排序和分页均由服务端执行。</Typography.Text></div>
        <Button icon={<SettingOutlined />} onClick={() => { setDraftPreference(preference); setColumnModalOpen(true); }}>列设置</Button>
      </div>
      {preferenceQuery.isError && <Alert className="receivables-inline-alert" type="warning" showIcon message="列偏好读取失败，本次使用默认列设置；台账读取不受影响。" />}
      <Card className="filters" aria-label="台账筛选">
        <Form layout="inline">
          <Form.Item label="搜索">
            <Input.Search aria-label="搜索合同、项目或客户" allowClear value={search} placeholder="合同、项目或客户" onChange={(event) => setSearch(event.target.value)} onSearch={(value) => setState((current) => ({ ...current, page: 1, search: value.trim() || undefined }))} />
          </Form.Item>
          <Form.Item label="结清状态"><Select aria-label="结清状态" value={state.settlement} style={{ width: 124 }} options={[{ value: "unsettled", label: "未结" }, { value: "settled", label: "已结清" }, { value: "all", label: "全部" }]} onChange={(settlement) => setState((current) => ({ ...current, page: 1, settlement }))} /></Form.Item>
          <Form.Item label="记录状态"><Select aria-label="记录状态" value={state.status} style={{ width: 124 }} options={[{ value: "active", label: "有效" }, { value: "voided", label: "已作废" }, { value: "all", label: "全部" }]} onChange={(status) => setState((current) => ({ ...current, page: 1, status }))} /></Form.Item>
          <Form.Item label="归属部门"><Select allowClear aria-label="财务归属部门" value={state.financeDepartmentId ?? null} style={{ width: 180 }} placeholder="全部部门" options={(currentLedgers?.facets.departments ?? []).map((item) => ({ value: item.value!, label: item.name }))} onChange={(financeDepartmentId) => setState((current) => ({ ...current, page: 1, financeDepartmentId }))} /></Form.Item>
          <Form.Item label="债权状态"><Select allowClear aria-label="债权状态" value={state.debtStatus ?? null} style={{ width: 150 }} placeholder="全部状态" options={(currentLedgers?.facets.debtStatuses ?? []).filter((item) => item.value).map((item) => ({ value: item.value!, label: item.value! }))} onChange={(debtStatus) => setState((current) => ({ ...current, page: 1, debtStatus }))} /></Form.Item>
          <Form.Item label="待核对"><Select allowClear aria-label="待核对事项" value={state.anomaly ?? null} style={{ width: 160 }} placeholder="全部事项" options={Object.entries(anomalyLabels).map(([value, label]) => ({ value, label }))} onChange={(anomaly) => setState((current) => ({ ...current, page: 1, anomaly }))} /></Form.Item>
        </Form>
      </Card>
      {ledgers.isError && <Alert className="receivables-inline-alert" type="error" showIcon message="台账加载失败" description="未显示任何台账数据，请检查网络或权限后重试。" action={<Button onClick={() => void ledgers.refetch()}>重试</Button>} />}
      <div className="receivables-table-region" role="region" aria-label="应收账款宽表" tabIndex={0}>
        <Table<ReceivablesLedgerRow>
          rowKey="id"
          loading={ledgers.isFetching}
          dataSource={currentLedgers?.rows ?? []}
          columns={columns}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: ledgers.isFetching ? "正在加载台账…" : "当前筛选下没有台账记录" }}
          pagination={{ current: currentLedgers?.page ?? state.page, pageSize: currentLedgers?.pageSize ?? state.pageSize, total: currentLedgers?.total ?? 0, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 200], showTotal: (total) => `共 ${total} 条` }}
          onChange={onTableChange}
        />
      </div>
      <Modal title="列设置" open={columnModalOpen} footer={null} width={620} onCancel={() => setColumnModalOpen(false)} destroyOnClose>
        <ColumnSettings value={draftPreference} onChange={setDraftPreference} onSave={() => savePreference.mutate()} saving={savePreference.isPending} />
      </Modal>
      <Drawer title="台账详情" width={720} open={!!selectedId} onClose={() => setSelectedId(null)} destroyOnClose>
        {detail.isFetching && <Typography.Text type="secondary">正在加载详情…</Typography.Text>}
        {detail.isError && <Alert type="error" showIcon message="详情加载失败" description="记录可能已不存在或当前账号已失去读取权限。" />}
        {currentDetail && (
          <Space direction="vertical" size="large" className="receivables-detail">
            <Descriptions bordered size="small" column={2} items={[
              { key: "contract", label: "合同编号", children: currentDetail.ledger.contractNo },
              { key: "department", label: "财务归属部门", children: currentDetail.ledger.financeDepartmentName },
              { key: "project", label: "项目名称", children: plain(currentDetail.ledger.projectName) },
              { key: "customer", label: "客户名称", children: plain(currentDetail.ledger.customerName) },
              { key: "final", label: "决算金额", children: formatReceivablesMoney(currentDetail.ledger.finalAmount) },
              { key: "invoice", label: "开票金额", children: formatReceivablesMoney(currentDetail.ledger.invoicedAmount) },
              { key: "receipt", label: "到账金额", children: formatReceivablesMoney(currentDetail.ledger.receivedAmount) },
              { key: "balance", label: "应收余额", children: formatReceivablesMoney(currentDetail.ledger.balance) },
              { key: "owner", label: "清收责任人", children: plain(currentDetail.ledger.collectionOwner) },
              { key: "notes", label: "催收备注", children: plain(currentDetail.ledger.collectionNotes), span: 2 },
            ]} />
            <Card size="small" title="开票明细"><Table rowKey="id" size="small" pagination={false} locale={{ emptyText: "暂无开票明细" }} dataSource={currentDetail.invoices} columns={[{ title: "日期", dataIndex: "invoiceDate", render: formatReceivablesDate }, { title: "发票号", dataIndex: "invoiceNo", render: plain }, { title: "金额", dataIndex: "amount", align: "right", render: formatReceivablesMoney }, { title: "状态", dataIndex: "status", render: (value) => value === "active" ? "有效" : "已作废" }]} /></Card>
            <Card size="small" title="回款明细"><Table rowKey="id" size="small" pagination={false} locale={{ emptyText: "暂无回款明细" }} dataSource={currentDetail.receipts} columns={[{ title: "日期", dataIndex: "receiptDate", render: formatReceivablesDate }, { title: "凭证号", dataIndex: "referenceNo", render: plain }, { title: "金额", dataIndex: "amount", align: "right", render: formatReceivablesMoney }, { title: "状态", dataIndex: "status", render: (value) => value === "active" ? "有效" : "已作废" }]} /></Card>
            <Card size="small" title="附件"><Table rowKey="id" size="small" pagination={false} locale={{ emptyText: "暂无附件" }} dataSource={currentDetail.attachments} columns={[{ title: "文件名", dataIndex: ["file", "originalName"] }, { title: "分类", dataIndex: "category" }, { title: "状态", dataIndex: "status", render: (value) => value === "active" ? "有效" : "已作废" }]} /></Card>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
