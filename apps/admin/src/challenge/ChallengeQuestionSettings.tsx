import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { useState } from "react";
import { api, json } from "../api";

type Principal = { roles: Array<{ role: string }> };
type Question = { id: string; prompt: string; type: string; active: boolean; challengeEnabled: boolean; challengeCategory: string | null; challengeDifficulty: "easy" | "medium" | "hard" | null; bank: { name: string; scopeType: string } };
type QuestionPage = { items: Question[]; total: number; enabledCount: number; availableCount: number; page: number; pageSize: number };

const difficultyLabels = { easy: "简单", medium: "适中", hard: "较难" };

export function ChallengeQuestionSettings() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Principal>("/api/auth/me") });
  const companyAdmin = me.data?.roles.some(({ role }) => role === "company_admin") ?? false;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [enabled, setEnabled] = useState<"all" | "enabled" | "disabled">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), enabled }); if (keyword.trim()) params.set("keyword", keyword.trim());
  const questions = useQuery({ queryKey: ["challenge-admin-questions", page, pageSize, keyword, enabled], queryFn: () => api<QuestionPage>(`/api/challenge/admin/questions?${params}`), enabled: companyAdmin });
  const [editing, setEditing] = useState<Question>();
  const mutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Record<string, unknown> }) => api(`/api/challenge/admin/questions/${id}`, json("PATCH", values)),
    onSuccess: () => { message.success("日常挑战题配置已更新"); setEditing(undefined); void qc.invalidateQueries({ queryKey: ["challenge-admin-questions"] }); },
    onError: (error) => message.error(error.message)
  });
  const bulk = useMutation({ mutationFn: (challengeEnabled: boolean) => api<{ updated: number }>("/api/challenge/admin/questions/bulk", json("POST", { ids: selectedIds, challengeEnabled })), onSuccess: (result) => { message.success(`已更新 ${result.updated} 道题`); setSelectedIds([]); void qc.invalidateQueries({ queryKey: ["challenge-admin-questions"] }); }, onError: (error) => message.error(error.message) });
  const enableAll = useMutation({ mutationFn: () => api<{ updated: number }>("/api/challenge/admin/questions/enable-all", json("POST", {})), onSuccess: (result) => { message.success(result.updated ? `日常挑战已开启，共新增启用 ${result.updated} 道题` : "所有有效题目均已启用"); void qc.invalidateQueries({ queryKey: ["challenge-admin-questions"] }); }, onError: (error) => message.error(error.message) });
  const confirmEnableAll = () => Modal.confirm({ title: "启用日常挑战？", content: `将把当前全部 ${questions.data?.availableCount ?? 0} 道有效题目用于每日随机挑战。正式考试和试卷不会受到影响。`, okText: "确认启用", onOk: () => enableAll.mutateAsync() });

  if (!companyAdmin) return <Alert type="info" showIcon message="只有公司管理员可以配置日常挑战题" description="组织管理员可在“积分流水”中查看自己组织范围内的挑战积分，但不能启用题目或修改挑战规则。" />;
  return <>
    <Alert type={questions.data?.enabledCount ? "info" : "warning"} showIcon message={questions.data?.enabledCount ? `日常挑战已开启，共启用 ${questions.data.enabledCount} 道题` : "日常挑战尚未开启"} description="可点击“一键启用全部有效题目”，也可勾选部分题目后批量启用。挑战复用现有题库，不影响正式考试。" style={{ marginBottom: 16 }} />
    <Space wrap style={{ marginBottom: 12 }}><Input.Search allowClear placeholder="搜索题干" value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} style={{ width: 280 }} /><Select value={enabled} onChange={(value) => { setEnabled(value); setPage(1); }} style={{ width: 140 }} options={[{ value: "all", label: "全部状态" }, { value: "enabled", label: "已启用" }, { value: "disabled", label: "未启用" }]} /><Button type="primary" disabled={!selectedIds.length} loading={bulk.isPending} onClick={() => bulk.mutate(true)}>批量启用</Button><Button disabled={!selectedIds.length} loading={bulk.isPending} onClick={() => bulk.mutate(false)}>批量停用</Button><Button disabled={!questions.data?.availableCount || questions.data.enabledCount === questions.data.availableCount} loading={enableAll.isPending} onClick={confirmEnableAll}>一键启用全部有效题目</Button></Space>
    <Table rowKey="id" loading={questions.isLoading} dataSource={questions.data?.items ?? []} rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys.map(String)) }} pagination={{ current: page, pageSize, total: questions.data?.total ?? 0, showSizeChanger: true, showTotal: (total) => `共 ${total} 道`, onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); setSelectedIds([]); } }} columns={[
      { title: "题库", render: (_: unknown, row: Question) => row.bank.name, width: 180 },
      { title: "题目", dataIndex: "prompt" },
      { title: "状态", render: (_: unknown, row: Question) => <Space>{row.challengeEnabled ? <Tag color="green">已用于挑战</Tag> : <Tag>未启用</Tag>}{!row.active && <Tag color="red">题目已停用</Tag>}</Space>, width: 190 },
      { title: "分类", dataIndex: "challengeCategory", render: (value: string | null) => value ?? "—", width: 140 },
      { title: "难度", dataIndex: "challengeDifficulty", render: (value: keyof typeof difficultyLabels | null) => value ? difficultyLabels[value] : "—", width: 90 },
      { title: "操作", render: (_: unknown, row: Question) => <Button size="small" onClick={() => setEditing(row)}>配置</Button>, width: 90 }
    ]} />
    <Modal title="配置日常挑战题" open={!!editing} footer={null} onCancel={() => setEditing(undefined)} destroyOnHidden>
      {editing && <Form key={editing.id} layout="vertical" initialValues={editing} onFinish={(values) => mutation.mutate({ id: editing.id, values: { challengeEnabled: values.challengeEnabled, challengeCategory: values.challengeCategory?.trim() || null, challengeDifficulty: values.challengeDifficulty ?? null } })}>
        <Typography.Paragraph>{editing.prompt}</Typography.Paragraph>
        <Form.Item name="challengeEnabled" label="用于日常挑战" valuePropName="checked"><Switch disabled={!editing.active} /></Form.Item>
        <Form.Item name="challengeCategory" label="安全分类"><Input maxLength={80} placeholder="例如：消防安全、交通安全" /></Form.Item>
        <Form.Item name="challengeDifficulty" label="难度"><Select allowClear options={Object.entries(difficultyLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={mutation.isPending}>保存配置</Button>
      </Form>}
    </Modal>
  </>;
}
