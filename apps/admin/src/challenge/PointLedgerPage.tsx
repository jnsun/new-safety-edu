import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Modal, Select, Space, Table, Tag, message } from "antd";
import { useState } from "react";
import { api, json } from "../api";

type Organization = { id: string; name: string; type: string };
type Person = { id: string; name: string };
type Ledger = { id: string; sourceType: string; points: number; occurredAt: string; voidedAt: string | null; voidReason: string | null; person: { id: string; name: string }; organizationSnapshot: { id: string; name: string } | null };
type Response = { month: string; canVoid: boolean; rows: Ledger[] };

const currentMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

export function PointLedgerPage() {
  const [month, setMonth] = useState(currentMonth());
  const [organizationId, setOrganizationId] = useState<string>();
  const [personId, setPersonId] = useState<string>();
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: () => api<Organization[]>("/api/organizations") });
  const people = useQuery({ queryKey: ["persons"], queryFn: () => api<Person[]>("/api/persons") });
  const params = new URLSearchParams({ month, ...(organizationId ? { organizationId } : {}), ...(personId ? { personId } : {}) });
  const ledgers = useQuery({ queryKey: ["challenge-point-ledgers", month, organizationId, personId], queryFn: () => api<Response>(`/api/challenge/admin/points?${params}`) });
  const voidLedger = (row: Ledger) => {
    let reason = "";
    Modal.confirm({ title: "作废异常积分", content: <Input.TextArea placeholder="请输入至少 2 个字的作废原因" onChange={(event) => { reason = event.target.value; }} />, okText: "确认作废", okButtonProps: { danger: true }, onOk: async () => {
      if (reason.trim().length < 2) throw new Error("请输入至少 2 个字的原因");
      await api(`/api/challenge/admin/points/${row.id}/void`, json("POST", { reason: reason.trim() }));
      message.success("积分流水已作废，原记录仍保留"); void ledgers.refetch();
    } });
  };
  return <>
    <Alert type="warning" showIcon message="积分流水不可直接修改或删除" description="异常积分只能作废并保留原记录、操作人、时间和原因；正式培训和考试不会产生挑战积分。" style={{ marginBottom: 16 }} />
    <Space wrap style={{ marginBottom: 16 }}>
      <Form.Item label="月份" style={{ marginBottom: 0 }}><Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Form.Item>
      <Select allowClear showSearch optionFilterProp="label" placeholder="全部授权组织" value={organizationId} onChange={setOrganizationId} style={{ width: 220 }} options={(organizations.data ?? []).filter(({ type }) => ["department", "business_entity"].includes(type)).map(({ id, name }) => ({ value: id, label: name }))} />
      <Select allowClear showSearch optionFilterProp="label" placeholder="全部人员" value={personId} onChange={setPersonId} style={{ width: 180 }} options={(people.data ?? []).map(({ id, name }) => ({ value: id, label: name }))} />
      <Button onClick={() => void ledgers.refetch()}>刷新</Button>
    </Space>
    {ledgers.isError && <Alert type="error" showIcon message="积分流水加载失败" description={ledgers.error.message} />}
    <Table rowKey="id" loading={ledgers.isLoading} dataSource={ledgers.data?.rows ?? []} columns={[
      { title: "时间", dataIndex: "occurredAt", render: (value: string) => new Date(value).toLocaleString("zh-CN"), width: 180 },
      { title: "人员", render: (_: unknown, row: Ledger) => row.person.name, width: 130 },
      { title: "组织快照", render: (_: unknown, row: Ledger) => row.organizationSnapshot?.name ?? "未归属", width: 180 },
      { title: "来源", dataIndex: "sourceType", render: () => "每日挑战首次答对" },
      { title: "积分", dataIndex: "points", width: 80 },
      { title: "状态", render: (_: unknown, row: Ledger) => row.voidedAt ? <Tag color="red">已作废：{row.voidReason}</Tag> : <Tag color="green">有效</Tag>, width: 220 },
      { title: "操作", render: (_: unknown, row: Ledger) => ledgers.data?.canVoid && !row.voidedAt ? <Button danger size="small" onClick={() => voidLedger(row)}>作废异常积分</Button> : "—", width: 130 }
    ]} />
  </>;
}
