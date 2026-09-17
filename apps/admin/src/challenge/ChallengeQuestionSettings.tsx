import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { useState } from "react";
import { api, json } from "../api";

type Principal = { roles: Array<{ role: string }> };
type Question = { id: string; prompt: string; type: string; active: boolean; challengeEnabled: boolean; challengeCategory: string | null; challengeDifficulty: "easy" | "medium" | "hard" | null; bank: { name: string; scopeType: string } };

const difficultyLabels = { easy: "简单", medium: "适中", hard: "较难" };

export function ChallengeQuestionSettings() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Principal>("/api/auth/me") });
  const companyAdmin = me.data?.roles.some(({ role }) => role === "company_admin") ?? false;
  const questions = useQuery({ queryKey: ["challenge-admin-questions"], queryFn: () => api<Question[]>("/api/challenge/admin/questions"), enabled: companyAdmin });
  const [editing, setEditing] = useState<Question>();
  const mutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Record<string, unknown> }) => api(`/api/challenge/admin/questions/${id}`, json("PATCH", values)),
    onSuccess: () => { message.success("日常挑战题配置已更新"); setEditing(undefined); void qc.invalidateQueries({ queryKey: ["challenge-admin-questions"] }); },
    onError: (error) => message.error(error.message)
  });

  if (!companyAdmin) return <Alert type="info" showIcon message="只有公司管理员可以配置日常挑战题" description="组织管理员可在“积分流水”中查看自己组织范围内的挑战积分，但不能启用题目或修改挑战规则。" />;
  return <>
    <Alert type="info" showIcon message="复用现有题库" description="启用后，系统从人员可访问范围内的在用题目中生成每日挑战；不会创建第二套题库，也不会影响正式考试。" style={{ marginBottom: 16 }} />
    <Table rowKey="id" loading={questions.isLoading} dataSource={questions.data ?? []} columns={[
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
