import { useEffect, useState } from "react";
import { Alert, Button, Drawer, Form, Input, Select, Upload, message } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { ApiError, api, json } from "../api";
import { bidLabels, dateOnly, type Organization, type ProjectDetail } from "./model";

type ProjectValues = {
  name: string;
  code?: string;
  responsibleOrganizationId: string;
  projectType?: string;
  location?: string;
  managerName?: string;
  managerPhone?: string;
  businessSector?: string;
  bidStatus: string;
  plannedStartAt?: string;
  plannedEndAt?: string;
  expectedUpdatedAt?: string;
};

export function ProjectFormDrawer({ open, project, organizations, onClose, onSaved, onConflict }: {
  open: boolean;
  project: ProjectDetail | undefined;
  organizations: Organization[];
  onClose(): void;
  onSaved(projectId: string): Promise<void>;
  onConflict(): void;
}) {
  const [form] = Form.useForm<ProjectValues>();
  const [saving, setSaving] = useState(false);
  const [bidFile, setBidFile] = useState<File>();
  useEffect(() => {
    if (!open) return;
    const plannedStartAt = project ? dateOnly(project.plannedStartAt) : undefined;
    const plannedEndAt = project ? dateOnly(project.plannedEndAt) : undefined;
    const values = project ? {
      name: project.name,
      code: project.code,
      responsibleOrganizationId: project.responsibleOrganization.id,
      ...(project.projectType ? { projectType: project.projectType } : {}),
      ...(project.location ? { location: project.location } : {}),
      ...(project.managerName ? { managerName: project.managerName } : {}),
      ...(project.managerPhone ? { managerPhone: project.managerPhone } : {}),
      ...(project.contractBusinessSector ? { businessSector: project.contractBusinessSector } : {}),
      bidStatus: project.contractBidStatus,
      ...(plannedStartAt ? { plannedStartAt } : {}),
      ...(plannedEndAt ? { plannedEndAt } : {}),
      expectedUpdatedAt: project.updatedAt,
    } : { bidStatus: "bidding" };
    form.setFieldsValue(values);
    setBidFile(undefined);
  }, [form, open, project]);

  const submit = async (values: ProjectValues) => {
    setSaving(true);
    let savedId: string | undefined;
    try {
      const payload = project ? { ...values, code: undefined, responsibleOrganizationId: undefined } : values;
      const saved = await api<{ id: string }>(project ? `/api/contracts/projects/${project.id}` : "/api/contracts/projects", json(project ? "PATCH" : "POST", payload));
      savedId = saved.id;
      if (bidFile) {
        const upload = new FormData(); upload.append("file", bidFile);
        const file = await api<{ id: string }>("/api/files?kind=attachment", { method: "POST", body: upload });
        await api(`/api/contracts/projects/${saved.id}/attachments`, json("POST", { fileId: file.id, ownerType: "bid", ownerId: saved.id, category: "bid" }));
      }
      message.success(project ? "项目及投标资料已更新" : "项目已创建");
      await onSaved(saved.id);
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONTRACT_PROJECT_REVISION_CONFLICT") onConflict();
      else if (savedId) {
        message.warning(`项目主档已保存，但附件未完成：${error instanceof Error ? error.message : "请在项目详情重新上传"}`);
        await onSaved(savedId);
      } else message.error(error instanceof Error ? error.message : "保存失败");
    } finally { setSaving(false); }
  };

  return <Drawer
    className="contract-form-drawer"
    width={830}
    open={open}
    onClose={onClose}
    title={project ? "编辑项目及投标资料" : "创建项目及投标资料"}
    footer={<div className="contract-drawer-footer"><Button onClick={onClose}>取消</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{project ? "保存修改" : "创建项目"}</Button></div>}
  >
    <Alert type="info" showIcon message="业务建模说明" description="投标阶段允许尚无主合同；投标结果与安全项目状态分别维护。" />
    <Form className="contract-grid-form" form={form} layout="vertical" onFinish={(values) => void submit(values)} requiredMark="optional">
      <Form.Item label="项目名称" name="name" rules={[{ required: true, message: "请输入项目名称" }]}><Input placeholder="请输入项目名称" /></Form.Item>
      <Form.Item label="项目编号" name="code"><Input disabled={!!project} placeholder="可留空，由系统生成" /></Form.Item>
      <Form.Item label="责任经营实体" name="responsibleOrganizationId" rules={[{ required: true, message: "请选择责任经营实体" }]}><Select disabled={!!project} placeholder="请选择 Organization" options={organizations.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
      <Form.Item label="业务板块" name="businessSector"><Input placeholder="请输入业务板块" /></Form.Item>
      <Form.Item label="项目类型" name="projectType"><Input placeholder="请输入项目类型" /></Form.Item>
      <Form.Item label="项目地点" name="location"><Input placeholder="请输入项目地点" /></Form.Item>
      <Form.Item label="项目负责人" name="managerName"><Input placeholder="请输入统一人员姓名" /></Form.Item>
      <Form.Item label="负责人电话" name="managerPhone"><Input placeholder="请输入联系电话" /></Form.Item>
      <Form.Item label="投标结果" name="bidStatus"><Select options={Object.entries(bidLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
      <Form.Item label="计划开始" name="plannedStartAt"><Input type="date" /></Form.Item>
      <Form.Item label="计划结束" name="plannedEndAt"><Input type="date" /></Form.Item>
      <Form.Item name="expectedUpdatedAt" hidden><Input /></Form.Item>
      <Form.Item className="contract-upload-field" label="投标资料附件">
        <Upload.Dragger beforeUpload={(file) => { setBidFile(file); return false; }} maxCount={1} fileList={bidFile ? [{ uid: "pending", name: bidFile.name, status: "done" }] : []} onRemove={() => { setBidFile(undefined); return true; }}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p><p>上传后存入私有文件；下载时再次校验项目访问权限</p>
        </Upload.Dragger>
      </Form.Item>
    </Form>
  </Drawer>;
}
