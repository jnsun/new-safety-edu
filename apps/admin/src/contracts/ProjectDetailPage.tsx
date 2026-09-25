import { useMemo, useState } from "react";
import { Alert, Button, Descriptions, Drawer, Empty, Form, Input, InputNumber, Select, Skeleton, Space, Table, Tabs, Tag, Timeline, Upload, message } from "antd";
import { ArrowLeftOutlined, FileAddOutlined, UploadOutlined } from "@ant-design/icons";
import { api, json } from "../api";
import { bidLabels, dateOnly, formatFileSize, formatMoney, nextStages, projectStatusLabels, stageLabels, type ContractAccess, type Organization, type ProjectDetail } from "./model";

type DrawerKind = "main" | "supplement" | "subcontract" | null;

export function ProjectDetailPage({ access, project, loading, organizations, activeTab, onBack, onEdit, onTabChange, onChanged }: {
  access: ContractAccess;
  project: ProjectDetail | undefined;
  loading: boolean;
  organizations: Organization[];
  activeTab: string;
  onBack(): void;
  onEdit(): void;
  onTabChange(tab: string): void;
  onChanged(): Promise<void>;
}) {
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [mainForm] = Form.useForm();
  const [supplementForm] = Form.useForm();
  const [subcontractForm] = Form.useForm();
  const [stageForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const mutate = async (path: string, method: string, values: unknown, success: string) => {
    setSaving(true);
    try { await api(path, json(method, values)); message.success(success); setDrawer(null); await onChanged(); }
    catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  };
  if (loading || !project) return <div className="contract-detail-loading"><Skeleton active paragraph={{ rows: 10 }} /></div>;
  const main = project.mainContract;
  const dateRange = [dateOnly(project.plannedStartAt), dateOnly(project.plannedEndAt)].filter(Boolean).join(" 至 ") || "—";
  const tabItems = [
    { key: "main", label: "主合同", children: <section className="contract-detail-panel">
      <Alert type="info" showIcon message="一项目一主合同" description="投标阶段可以没有主合同；主合同登记后只能归属当前项目。" />
      {!main ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><strong>尚未登记主合同</strong><span>中标签订后登记合同编号、相对方、签订日期与合同金额。</span></>}><Button type="link" disabled={!access.canManageContracts} onClick={() => setDrawer("main")}>＋ 登记主合同</Button></Empty>
        : <>{!main.signedAt && <Alert type="warning" showIcon message="主合同尚未签署" description="当前只保存合同登记资料；新项目尚不能进入安全管理和野外项目月报流程。" />}<div className="contract-panel-heading"><h3>主合同</h3>{access.canManageContracts && <Button onClick={() => setDrawer("main")}>编辑主合同</Button>}</div><Descriptions column={2} items={[
          { key: "no", label: "合同编号", children: main.contractNo }, { key: "party", label: "合同相对方", children: main.partyA },
          { key: "signed", label: "签订日期", children: dateOnly(main.signedAt) ?? "—" }, { key: "amount", label: "合同金额", children: <span className="contract-money">{formatMoney(main.amountYuan)}</span> },
          { key: "handler", label: "经办人", children: main.handlerName ?? "—" }, { key: "note", label: "来源说明", children: main.sourceNote ?? "—" },
        ]} /></>}
    </section> },
    { key: "supplement", label: `补充合同 ${main?.supplements?.length ?? 0}`, children: <section className="contract-detail-panel">
      <div className="contract-panel-heading"><h3>补充合同 {main?.supplements?.length ?? 0} 份</h3>{access.canManageContracts && main && <Button type="primary" onClick={() => setDrawer("supplement")}>＋ 新增补充合同</Button>}</div>
      <Table rowKey="id" pagination={false} locale={{ emptyText: "尚无补充合同" }} dataSource={main?.supplements ?? []} columns={[
        { title: "补充合同编号", dataIndex: "contractNo", ellipsis: true }, { title: "签订日期", dataIndex: "signedAt", width: 140, render: dateOnly },
        { title: "约定增减额", dataIndex: "amountDeltaYuan", width: 160, align: "right", render: formatMoney }, { title: "变更原因与范围", dataIndex: "reason", ellipsis: true },
      ]} />
    </section> },
    { key: "subcontract", label: `分包合同 ${project.contractSubcontracts.length}`, children: <section className="contract-detail-panel">
      <div className="contract-panel-heading"><h3>分包合同 {project.contractSubcontracts.length} 份</h3>{access.canManageContracts && <Button type="primary" onClick={() => setDrawer("subcontract")}>＋ 新增分包合同</Button>}</div>
      <Table rowKey="id" pagination={false} locale={{ emptyText: "尚无分包合同" }} dataSource={project.contractSubcontracts} columns={[
        { title: "分包合同编号", dataIndex: "contractNo", ellipsis: true }, { title: "分包单位", dataIndex: "subcontractorName", ellipsis: true },
        { title: "归属经营实体", render: (_, row) => row.owningOrganization.name, ellipsis: true }, { title: "合同约定额", dataIndex: "amountYuan", width: 160, align: "right", render: formatMoney },
      ]} />
      <p className="contract-boundary-note">这里只记录分包合同基础信息；实际付款由后续财务成本/付款权威模块负责。</p>
    </section> },
    { key: "history", label: "状态历史", children: <section className="contract-detail-panel">
      <div className="contract-panel-heading"><h3>项目与合同状态历史</h3></div>
      <Timeline items={project.contractStatusHistory.map((row) => ({ children: <div className="contract-history-item"><time>{new Date(row.createdAt).toLocaleString("zh-CN", { hour12: false })}</time><strong>{row.fromStage ? `${stageLabels[row.fromStage] ?? row.fromStage} → ` : ""}{stageLabels[row.toStage] ?? row.toStage}</strong><span>{row.reason ?? "状态更新"}</span></div> }))} />
      {access.canChangeStage && (nextStages[project.contractStage] ?? []).length > 0 && <Form className="contract-stage-form" form={stageForm} layout="inline" onFinish={(values) => void mutate(`/api/contracts/projects/${project.id}/stage-transitions`, "POST", values, "项目执行阶段已更新")}>
        <Form.Item name="toStage" rules={[{ required: true }]}><Select placeholder="选择下一阶段" options={(nextStages[project.contractStage] ?? []).map((value) => ({ value, label: stageLabels[value] }))} /></Form.Item>
        <Form.Item name="reason"><Input placeholder="变更原因（退回时必填）" /></Form.Item><Button type="primary" htmlType="submit" loading={saving}>变更阶段</Button>
      </Form>}
    </section> },
    { key: "files", label: `附件 ${project.contractAttachments.length}`, children: <AttachmentPanel access={access} project={project} onChanged={onChanged} /> },
  ];
  return <div className="contract-detail-page">
    <Button className="contract-back" type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>返回台账</Button>
    <div className="contract-detail-heading"><div><h1>{project.name}</h1><p>{project.code} · {project.responsibleOrganization.name}{project.contractBusinessSector ? ` · ${project.contractBusinessSector}` : ""}</p></div>{access.canEditProject && <Button onClick={onEdit}>编辑项目</Button>}</div>
    <div className="contract-project-summary">
      <Summary label="投标结果" value={bidLabels[project.contractBidStatus] ?? project.contractBidStatus} tag />
      <Summary label="项目状态" value={projectStatusLabels[project.status ?? ""] ?? project.status ?? "—"} />
      <Summary label="负责人" value={project.managerName ?? "—"} />
      <Summary label="计划周期" value={dateRange} />
      <Summary label="合同阶段" value={stageLabels[project.contractStage] ?? project.contractStage} />
    </div>
    <Tabs className="contract-detail-tabs" activeKey={activeTab} onChange={onTabChange} items={tabItems} />
    <ContractFormDrawers project={project} main={main} organizations={organizations} drawer={drawer} setDrawer={setDrawer} mainForm={mainForm} supplementForm={supplementForm} subcontractForm={subcontractForm} saving={saving} mutate={mutate} />
  </div>;
}

function Summary({ label, value, tag }: { label: string; value: string; tag?: boolean }) {
  return <div><span>{label}</span>{tag ? <Tag color="green">{value}</Tag> : <strong>{value}</strong>}</div>;
}

function AttachmentPanel({ access, project, onChanged }: { access: ContractAccess; project: ProjectDetail; onChanged(): Promise<void> }) {
  const ownerOptions = useMemo(() => [
    { value: `project:${project.id}`, label: "项目资料" }, { value: `bid:${project.id}`, label: "投标资料" },
    ...(project.mainContract ? [{ value: `main_contract:${project.mainContract.id}`, label: "主合同" }] : []),
    ...(project.mainContract?.supplements ?? []).map((item) => ({ value: `supplement:${item.id}`, label: `补充合同 ${item.contractNo}` })),
    ...project.contractSubcontracts.map((item) => ({ value: `subcontract:${item.id}`, label: `分包合同 ${item.contractNo}` })),
  ], [project]);
  const [owner, setOwner] = useState(ownerOptions[0]?.value);
  return <section className="contract-detail-panel">
    <div className="contract-panel-heading"><h3>项目与合同附件</h3>{access.canUploadAttachments && <Space.Compact><Select value={owner} onChange={setOwner} options={ownerOptions} /><Upload showUploadList={false} customRequest={async ({ file, onSuccess, onError }) => { try { const form = new FormData(); form.append("file", file as Blob); const uploaded = await api<{ id: string }>("/api/files?kind=attachment", { method: "POST", body: form }); const [ownerType, ownerId] = (owner ?? `project:${project.id}`).split(":"); await api(`/api/contracts/projects/${project.id}/attachments`, json("POST", { fileId: uploaded.id, ownerType, ownerId, category: ownerType })); message.success("附件已上传"); await onChanged(); onSuccess?.({}); } catch (error) { message.error(error instanceof Error ? error.message : "上传失败"); onError?.(error as Error); } }}><Button type="primary" icon={<UploadOutlined />}>上传附件</Button></Upload></Space.Compact>}</div>
    <Alert type="info" showIcon message="私有文件" description="附件下载时会再次按当前人员、合同能力和项目数据范围执行服务端校验。" />
    <div className="contract-file-list">{project.contractAttachments.length ? project.contractAttachments.map((row) => <div className="contract-file-row" key={row.id}><FileAddOutlined /><div><strong>{row.file.originalName}</strong><span>{row.category ?? row.ownerType} · {formatFileSize(row.file.size)} · {dateOnly(row.createdAt)}</span></div><a href={`/api/files/${row.file.id}`} target="_blank" rel="noreferrer">预览 / 下载</a></div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无附件" />}</div>
  </section>;
}

function ContractFormDrawers({ project, main, organizations, drawer, setDrawer, mainForm, supplementForm, subcontractForm, saving, mutate }: any) {
  const close = () => setDrawer(null);
  return <>
    <Drawer className="contract-form-drawer" width={830} open={drawer === "main"} onClose={close} title={main ? "编辑主合同" : "登记主合同"} footer={<div className="contract-drawer-footer"><Button onClick={close}>取消</Button><Button type="primary" loading={saving} onClick={() => mainForm.submit()}>保存主合同</Button></div>}>
      <Alert type="info" showIcon message="一项目一主合同" description="当前主合同只能归属本项目；回款、开票与应收余额仍由财务系统负责。" />
      <Form className="contract-grid-form" form={mainForm} layout="vertical" initialValues={main ? { ...main, signedAt: dateOnly(main.signedAt) } : {}} onFinish={(values) => void mutate(`/api/contracts/projects/${project.id}/main-contract`, "PUT", values, "主合同已保存")}>
        <Form.Item name="contractNo" label="合同编号" rules={[{ required: true }]}><Input placeholder="请输入合同编号" /></Form.Item><Form.Item name="partyA" label="合同相对方" rules={[{ required: true }]}><Input placeholder="请输入或选择相对方" /></Form.Item>
        <Form.Item name="signedAt" label="签订日期"><Input type="date" /></Form.Item><Form.Item name="amountYuan" label="合同金额（元）"><InputNumber stringMode min={0} precision={2} placeholder="请输入合同约定金额" /></Form.Item>
        <Form.Item name="annualAmountYuan" label="年度金额（元）"><InputNumber stringMode min={0} precision={2} /></Form.Item><Form.Item name="handlerName" label="经办人"><Input /></Form.Item>
        <Form.Item className="contract-form-wide" name="sourceNote" label="来源说明"><Input.TextArea rows={4} /></Form.Item>
      </Form>
    </Drawer>
    <Drawer className="contract-form-drawer" width={830} open={drawer === "supplement"} onClose={close} title="新增补充合同" footer={<div className="contract-drawer-footer"><Button onClick={close}>取消</Button><Button type="primary" loading={saving} onClick={() => supplementForm.submit()}>保存补充合同</Button></div>}>
      <Alert type="info" showIcon message="金额口径" description="仅记录补充合同约定的增减额；不记录实际回款。减少请填写负数。" />
      <Form className="contract-grid-form" form={supplementForm} layout="vertical" onFinish={(values) => void mutate(`/api/contracts/projects/${project.id}/supplements`, "POST", values, "补充合同已登记")}>
        <Form.Item name="contractNo" label="补充合同编号" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="signedAt" label="签订日期"><Input type="date" /></Form.Item>
        <Form.Item name="amountDeltaYuan" label="增减金额（元）"><InputNumber stringMode precision={2} /></Form.Item><Form.Item className="contract-form-wide" name="reason" label="变更原因与范围"><Input.TextArea rows={5} /></Form.Item>
      </Form>
    </Drawer>
    <Drawer className="contract-form-drawer" width={830} open={drawer === "subcontract"} onClose={close} title="新增分包合同" footer={<div className="contract-drawer-footer"><Button onClick={close}>取消</Button><Button type="primary" loading={saving} onClick={() => subcontractForm.submit()}>保存分包合同</Button></div>}>
      <Alert type="info" showIcon message="财务边界" description="这里只登记分包合同基础信息和约定额，不把约定额当作实际付款。" />
      <Form className="contract-grid-form" form={subcontractForm} layout="vertical" initialValues={{ owningOrganizationId: project.responsibleOrganization.id }} onFinish={(values) => void mutate(`/api/contracts/projects/${project.id}/subcontracts`, "POST", values, "分包合同已登记")}>
        <Form.Item name="contractNo" label="分包合同编号" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="subcontractorName" label="分包单位" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="owningOrganizationId" label="归属经营实体" rules={[{ required: true }]}><Select options={organizations.map((item: Organization) => ({ value: item.id, label: item.name }))} /></Form.Item><Form.Item name="amountYuan" label="合同约定额（元）"><InputNumber stringMode min={0} precision={2} /></Form.Item>
        <Form.Item name="signedAt" label="签订日期"><Input type="date" /></Form.Item><Form.Item name="handlerName" label="经办人"><Input /></Form.Item><Form.Item className="contract-form-wide" name="scope" label="分包范围"><Input.TextArea rows={5} /></Form.Item>
      </Form>
    </Drawer>
  </>;
}
