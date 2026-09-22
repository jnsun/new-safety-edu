import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Avatar, Button, Card, Descriptions, Form, Input, Modal, Select, Space, Table, Tag, Typography, Upload, message } from "antd";
import type { UploadProps } from "antd";
import { api, json } from "./api";

type Profile = { name: string; type: string; status: string; phone: string | null; nationalIdMasked: string | null; photoFileId: string | null; organizations: Array<{ id: string; name: string; primary: boolean }> };
type Assignment = { id: string; status: string; createdAt: string; completedAt: string | null; batch: { name: string; type: string }; progress: { completed: number; total: number }; latestAttempt: { score: number | null; passed: boolean | null } | null; signedAt: string | null };
type Certificate = { id: string; name: string; certificateNo: string | null; issuedAt: string | null; expiresAt: string | null; type?: { name: string; requiresAnnualTraining: boolean }; annualTrainingStatuses?: Array<{ year: number; status: string }> };
type ChangeRequest = { id: string; type: string; status: string; createdAt: string; reviewNote: string | null };
type Organization = { id: string; name: string; type: string };
type EditKind = "name" | "department" | "phone";

const date = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—";
const statusText: Record<string, string> = { pending: "待审核", approved: "已通过", rejected: "已驳回", withdrawn: "已撤回", completed: "已完成", cancelled: "已取消", learning: "学习中", pending_learning: "待学习", pending_exam: "待考试", pending_signature: "待签字", confirmation_pending: "待现场确认", remediation_required: "待补学", locked: "已锁定" };
const typeText: Record<string, string> = { profile_change: "个人资料变更", department_transfer: "部门变更", three_level: "三级教育", project_induction: "项目入场教育", routine: "日常培训", change_update: "变化内容培训" };

export function SelfProfilePage({ displayName }: { displayName: string }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<EditKind | null>(null);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [recordId, setRecordId] = useState<string | null>(null);
  const profile = useQuery({ queryKey: ["self", "profile"], queryFn: () => api<Profile>("/api/me/profile") });
  const assignments = useQuery({ queryKey: ["self", "assignments"], queryFn: () => api<Assignment[]>("/api/me/assignments?scope=all") });
  const certificates = useQuery({ queryKey: ["self", "certificates"], queryFn: () => api<Certificate[]>("/api/me/certificates") });
  const requests = useQuery({ queryKey: ["self", "requests"], queryFn: () => api<ChangeRequest[]>("/api/me/change-requests") });
  const organizations = useQuery({ queryKey: ["self", "organizations"], queryFn: () => api<Organization[]>("/api/me/organization-options"), enabled: edit === "department" });
  const record = useQuery({ queryKey: ["self", "record", recordId], queryFn: () => api<Assignment>(`/api/me/records/${recordId}`), enabled: !!recordId });

  const uploadPhoto: UploadProps["customRequest"] = async ({ file, onSuccess, onError }) => {
    try {
      const body = new FormData(); body.append("file", file as Blob);
      const uploaded = await api<{ id: string }>("/api/files?kind=photo", { method: "POST", body });
      await api("/api/me/profile/photo", json("PATCH", { photoFileId: uploaded.id }));
      await qc.invalidateQueries({ queryKey: ["self", "profile"] });
      message.success("照片已更新"); onSuccess?.({});
    } catch (error) { message.error((error as Error).message); onError?.(error as Error); }
  };

  const sendCode = async () => {
    const phone = form.getFieldValue("phone") as string;
    if (!/^1\d{10}$/.test(phone ?? "")) { message.warning("请先填写正确的新手机号"); return; }
    setCodeBusy(true);
    try { await api("/api/me/phone/code", json("POST", { phone })); message.success("验证码已发送，有效期 5 分钟"); }
    catch (error) { message.error((error as Error).message); }
    finally { setCodeBusy(false); }
  };

  const submit = async (values: { name?: string; organizationId?: string; phone?: string; code?: string; reason: string }) => {
    if (!edit) return;
    setBusy(true);
    try {
      if (edit === "name") await api("/api/me/change-requests", json("POST", { type: "profile_change", name: values.name, reason: values.reason }));
      if (edit === "department") await api("/api/me/department-transfer-requests", json("POST", { organizationId: values.organizationId, reason: values.reason }));
      if (edit === "phone") await api("/api/me/phone/change-request", json("POST", { phone: values.phone, code: values.code, reason: values.reason }));
      message.success("申请已提交，审核通过后生效"); setEdit(null); form.resetFields();
      void qc.invalidateQueries({ queryKey: ["self", "requests"] });
    } catch (error) { message.error((error as Error).message); }
    finally { setBusy(false); }
  };

  if (profile.isLoading) return <div className="self-profile-loading">正在加载本人档案…</div>;
  if (profile.isError || !profile.data) return <div className="self-profile-loading"><Alert type="error" showIcon message="档案读取失败" description={(profile.error as Error)?.message} action={<Button onClick={() => void profile.refetch()}>重试</Button>} /></div>;

  const person = profile.data;
  return <div className="self-profile-page">
    <header className="self-profile-header"><div><strong>安全生产统一管理平台</strong><span>本人档案</span></div><Space><span>{displayName}</span><Button href="/logout">退出登录</Button></Space></header>
    <main className="self-profile-content">
      <Typography.Title level={2}>我的档案</Typography.Title>
      <Typography.Paragraph type="secondary">这里只展示本人资料。培训、考试与签字完成状态以系统记录为准；重要资料变更需审核。</Typography.Paragraph>
      <Card title="基本资料" className="self-profile-card" extra={<Tag color={person.status === "active" ? "green" : "orange"}>{person.status === "active" ? "在职" : person.status}</Tag>}>
        <div className="self-profile-identity">
          <Upload accept="image/png,image/jpeg" showUploadList={false} customRequest={uploadPhoto} beforeUpload={(file) => { if (file.size > 10 * 1024 * 1024) { message.error("照片不得超过 10 MB"); return Upload.LIST_IGNORE; } return true; }}><button type="button" className="self-profile-avatar" aria-label="点击头像修改照片"><Avatar size={72} src={person.photoFileId ? `/api/files/${person.photoFileId}` : undefined}>{person.name.slice(0, 1)}</Avatar><span>点击修改照片</span></button></Upload>
          <div><strong>{person.name}</strong><span>{person.organizations.find((item) => item.primary)?.name ?? "未设置主部门"}</span></div>
        </div>
        <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
          <Descriptions.Item label="姓名">{person.name} <Button type="link" size="small" onClick={() => { form.resetFields(); form.setFieldValue("name", person.name); setEdit("name"); }}>申请修改</Button></Descriptions.Item>
          <Descriptions.Item label="部门">{person.organizations.find((item) => item.primary)?.name ?? "—"} <Button type="link" size="small" onClick={() => { form.resetFields(); setEdit("department"); }}>申请调换</Button></Descriptions.Item>
          <Descriptions.Item label="手机号">{person.phone ?? "—"} <Button type="link" size="small" onClick={() => { form.resetFields(); setEdit("phone"); }}>申请修改</Button></Descriptions.Item>
          <Descriptions.Item label="身份证">{person.nationalIdMasked ?? "未录入"}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="培训与学习记录" className="self-profile-card">
        {assignments.isError ? <Alert type="error" showIcon message="培训记录读取失败" action={<Button onClick={() => void assignments.refetch()}>重试</Button>} /> : <Table loading={assignments.isLoading} rowKey="id" dataSource={assignments.data ?? []} pagination={{ pageSize: 10 }} scroll={{ x: 700 }} locale={{ emptyText: "暂无培训记录" }} columns={[
          { title: "培训", dataIndex: ["batch", "name"], width: 240 }, { title: "类型", width: 130, render: (_, row: Assignment) => typeText[row.batch.type] ?? row.batch.type },
          { title: "状态", dataIndex: "status", width: 130, render: (value: string) => statusText[value] ?? value }, { title: "学习进度", width: 110, render: (_, row: Assignment) => `${row.progress.completed}/${row.progress.total}` },
          { title: "考试", width: 110, render: (_, row: Assignment) => row.latestAttempt ? `${row.latestAttempt.score ?? "—"} 分${row.latestAttempt.passed ? " · 通过" : ""}` : "—" }, { title: "签字", width: 120, render: (_, row: Assignment) => date(row.signedAt) },
          { title: "完成时间", width: 120, render: (_, row: Assignment) => date(row.completedAt) }, { title: "", width: 80, render: (_, row: Assignment) => row.status === "completed" || row.status === "confirmation_pending" ? <Button type="link" onClick={() => setRecordId(row.id)}>详情</Button> : null }
        ]} />}
      </Card>
      <Card title="个人证照" className="self-profile-card">
        {certificates.isError ? <Alert type="error" showIcon message="个人证照读取失败" action={<Button onClick={() => void certificates.refetch()}>重试</Button>} /> : <Table loading={certificates.isLoading} rowKey="id" dataSource={certificates.data ?? []} pagination={{ pageSize: 10 }} scroll={{ x: 600 }} locale={{ emptyText: "暂无个人证照" }} columns={[
          { title: "证照名称", dataIndex: "name" }, { title: "证书编号", dataIndex: "certificateNo" }, { title: "发证日期", render: (_, row: Certificate) => date(row.issuedAt) }, { title: "有效期", render: (_, row: Certificate) => date(row.expiresAt) }, { title: "年度培训", render: (_, row: Certificate) => row.type?.requiresAnnualTraining ? row.annualTrainingStatuses?.[0] ? `${row.annualTrainingStatuses[0].year} · ${row.annualTrainingStatuses[0].status}` : "待核对" : "不适用" }
        ]} />}
      </Card>
      <Card title="我的变更申请" className="self-profile-card">
        {requests.isError ? <Alert type="error" showIcon message="申请记录读取失败" action={<Button onClick={() => void requests.refetch()}>重试</Button>} /> : <Table loading={requests.isLoading} rowKey="id" dataSource={requests.data ?? []} pagination={{ pageSize: 5 }} locale={{ emptyText: "暂无变更申请" }} columns={[
          { title: "事项", dataIndex: "type", render: (value: string) => typeText[value] ?? value }, { title: "提交日期", dataIndex: "createdAt", render: date }, { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "approved" ? "green" : value === "rejected" ? "red" : "blue"}>{statusText[value] ?? value}</Tag> }, { title: "审核意见", dataIndex: "reviewNote", render: (value: string | null) => value || "—" }
        ]} />}
      </Card>
    </main>
    <Modal title={edit === "name" ? "申请修改姓名" : edit === "department" ? "申请调换部门" : "申请修改手机号"} open={!!edit} onCancel={() => { if (!busy) { setEdit(null); form.resetFields(); } }} onOk={() => void form.submit()} okText="提交审核" okButtonProps={{ loading: busy }} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
        {edit === "name" && <Form.Item name="name" label="新姓名" rules={[{ required: true, min: 2, max: 80 }]}><Input maxLength={80} /></Form.Item>}
        {edit === "department" && <Form.Item name="organizationId" label="目标部门" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" loading={organizations.isLoading} options={(organizations.data ?? []).filter((item) => ["department", "business_entity"].includes(item.type)).map((item) => ({ label: item.name, value: item.id }))} /></Form.Item>}
        {edit === "phone" && <><Form.Item name="phone" label="新手机号" rules={[{ required: true, pattern: /^1\d{10}$/ }]}><Input maxLength={11} /></Form.Item><Form.Item label="短信验证码" required><Space.Compact style={{ width: "100%" }}><Form.Item name="code" noStyle rules={[{ required: true, pattern: /^\d{6}$/ }]}><Input maxLength={6} /></Form.Item><Button loading={codeBusy} onClick={() => void sendCode()}>获取验证码</Button></Space.Compact></Form.Item></>}
        <Form.Item name="reason" label="变更原因" rules={[{ required: true, min: 2, max: 500 }]}><Input.TextArea maxLength={500} showCount rows={3} /></Form.Item>
      </Form>
      {edit === "phone" && <Alert type="info" showIcon message="验证码仅验证新号码归属；审核通过后新号码才会生效，届时需要重新登录。" />}
    </Modal>
    <Modal title="培训记录详情" open={!!recordId} footer={null} onCancel={() => setRecordId(null)}>{record.isLoading ? "正在加载…" : record.isError ? <Alert type="error" message="记录读取失败" action={<Button onClick={() => void record.refetch()}>重试</Button>} /> : record.data ? <Descriptions column={1} bordered size="small" items={[{ key: "name", label: "培训名称", children: record.data.batch.name }, { key: "status", label: "状态", children: statusText[record.data.status] ?? record.data.status }, { key: "progress", label: "学习进度", children: `${record.data.progress.completed}/${record.data.progress.total}` }, { key: "exam", label: "考试成绩", children: record.data.latestAttempt?.score ?? "—" }, { key: "sign", label: "签字时间", children: date(record.data.signedAt) }, { key: "done", label: "完成时间", children: date(record.data.completedAt) }]} /> : null}</Modal>
  </div>;
}
