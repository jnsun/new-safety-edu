import { DownloadOutlined, InboxOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Modal, Select, Space, Steps, Table, Typography, Upload, message } from "antd";
import type { UploadFile } from "antd";
import { useEffect, useMemo, useState } from "react";
import { api, apiResponse, json } from "../api";
import { ImportPreviewTable, type ImportIssue, type ImportPreviewItem } from "./ImportPreviewTable";

type ScopeOption = { value: string; label: string };
type Preview = { previewId: string; sourceHash: string; templateVersion: number; expiresAt: string; items: ImportPreviewItem[]; issues: ImportIssue[] };
type ConfirmResult = { result: { success: number; failed: number; items: Array<{ courseCode: string; status: string; version: number }> }; repeated: boolean };

async function download(path: string, filename: string) {
  const response = await apiResponse(path);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally { URL.revokeObjectURL(url); }
}

const templateDownloads = [
  { label: "空白 XLSX", format: "xlsx-blank", filename: "structured-courseware-blank.xlsx" },
  { label: "示例 XLSX", format: "xlsx-example", filename: "structured-courseware-example.xlsx" },
  { label: "JSON 示例", format: "json", filename: "structured-courseware-example.json" },
  { label: "JSON Schema", format: "schema", filename: "structured-courseware.schema.json" }
];

export function ImportCoursewareModal({ open, scopeOptions, onClose, onComplete }: { open: boolean; scopeOptions: ScopeOption[]; onClose: () => void; onComplete: () => void }) {
  const [scopeKey, setScopeKey] = useState<string>();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [preview, setPreview] = useState<Preview>();
  const [result, setResult] = useState<ConfirmResult>();
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string>();
  useEffect(() => {
    if (open) return;
    setScopeKey(undefined); setFiles([]); setPreview(undefined); setResult(undefined); setLoading(false);
  }, [open]);

  const counts = useMemo(() => ({
    create: preview?.items.filter((item) => item.classification === "create").length ?? 0,
    new_version: preview?.items.filter((item) => item.classification === "new_version").length ?? 0,
    conflict: preview?.items.filter((item) => item.classification === "conflict").length ?? 0,
    invalid: preview?.items.filter((item) => item.classification === "invalid").length ?? 0
  }), [preview]);
  const actionable = counts.create + counts.new_version;
  const globalErrors = preview?.issues.some((issue) => !issue.courseCode) ?? false;

  const runPreview = async () => {
    const file = files[0]?.originFileObj;
    if (!scopeKey || !file) { message.warning("请先选择适用范围和导入文件"); return; }
    const [scopeType = "", rawScopeId] = scopeKey.split(":", 2);
    const params = new URLSearchParams({ scopeType, ...(scopeType === "company" ? {} : { scopeId: rawScopeId ?? "" }) });
    const body = new FormData(); body.append("file", file);
    setLoading(true); setResult(undefined);
    try { setPreview(await api<Preview>(`/api/courseware-authoring/imports/preview?${params}`, { method: "POST", body })); }
    catch (error) { message.error(error instanceof Error ? error.message : "课件预检失败"); }
    finally { setLoading(false); }
  };

  const confirm = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      const confirmed = await api<ConfirmResult>("/api/courseware-authoring/imports/confirm", json("POST", { previewId: preview.previewId, sourceHash: preview.sourceHash }));
      setResult(confirmed); onComplete(); message.success(confirmed.repeated ? "该批次已经导入，已返回原结果" : "课件导入完成");
    } catch (error) { message.error(error instanceof Error ? error.message : "课件导入失败"); }
    finally { setLoading(false); }
  };

  const close = () => {
    if (loading) { message.info("请等待当前操作完成"); return; }
    onClose();
  };

  return <Modal title="批量导入结构化课件" open={open} width="min(1040px, calc(100vw - 32px))" footer={null} onCancel={close} maskClosable={!loading}>
    <Steps size="small" current={result ? 2 : preview ? 1 : 0} items={[{ title: "上传" }, { title: "预检确认" }, { title: "导入结果" }]} />
    <section className="courseware-import-section">
      <Typography.Title level={5}>系统模板</Typography.Title>
      <Space wrap>{templateDownloads.map((item) => <Button key={item.format} icon={<DownloadOutlined />} loading={downloading === item.format} onClick={async () => {
        setDownloading(item.format);
        try { await download(`/api/courseware-authoring/templates/${item.format}`, item.filename); }
        catch (error) { message.error(error instanceof Error ? error.message : "模板下载失败"); }
        finally { setDownloading(undefined); }
      }}>{item.label}</Button>)}</Space>
    </section>

    {!result && <section className="courseware-import-section">
      <Select showSearch optionFilterProp="label" placeholder="选择导入课件的适用范围" value={scopeKey} onChange={(value) => { setScopeKey(value); setPreview(undefined); }} options={scopeOptions} style={{ width: "100%", marginBottom: 12 }} disabled={loading} />
      <Upload.Dragger accept=".xlsx,.xlsm,.json,.zip" maxCount={1} fileList={files} beforeUpload={() => false} onChange={({ fileList }) => { setFiles(fileList.slice(-1)); setPreview(undefined); }} disabled={loading}>
        <p className="ant-upload-drag-icon"><InboxOutlined /></p><p>点击或拖入 XLSX、JSON、ZIP 文件</p><p className="ant-upload-hint">先预检，不会在此步骤创建或修改课件。</p>
      </Upload.Dragger>
      <Button type="primary" loading={loading} disabled={!scopeKey || !files.length} onClick={() => void runPreview()} style={{ marginTop: 12 }}>开始预检</Button>
    </section>}

    {preview && !result && <section className="courseware-import-section">
      <Alert type={globalErrors || !actionable ? "error" : counts.conflict || counts.invalid ? "warning" : "success"} showIcon message={`可导入 ${actionable} 项：新增 ${counts.create}，新版本 ${counts.new_version}`} description={`冲突 ${counts.conflict} 项，无效 ${counts.invalid} 项。冲突和无效项不会写入。预览有效期至 ${new Date(preview.expiresAt).toLocaleString("zh-CN")}。`} />
      <ImportPreviewTable items={preview.items} issues={preview.issues} />
      <Space><Button onClick={() => { setPreview(undefined); setFiles([]); }}>重新选择文件</Button><Button type="primary" loading={loading} disabled={globalErrors || actionable === 0} onClick={() => void confirm()}>确认导入可写入项</Button></Space>
    </section>}

    {preview && result && <section className="courseware-import-section">
      <Alert type="success" showIcon message={result.repeated ? "该预览已确认过，未重复写入" : "课件导入完成"} />
      <Descriptions bordered size="small" column={4} items={[
        { key: "success", label: "成功", children: result.result.success },
        { key: "failed", label: "失败", children: result.result.failed },
        { key: "conflict", label: "冲突", children: counts.conflict },
        { key: "skipped", label: "跳过", children: counts.invalid }
      ]} />
      <Table size="small" rowKey="courseCode" pagination={false} dataSource={result.result.items} columns={[{ title: "课程编码", dataIndex: "courseCode" }, { title: "结果", dataIndex: "status", render: (value: string) => value === "created" ? "已新增" : "已创建新版本" }, { title: "版本", dataIndex: "version", render: (value: number) => `v${value}` }]} />
      {(counts.conflict > 0 || counts.invalid > 0) && <ImportPreviewTable items={preview.items.filter((item) => ["conflict", "invalid"].includes(item.classification))} issues={preview.issues} />}
      <Button type="primary" onClick={close}>完成</Button>
    </section>}
  </Modal>;
}

export async function exportCoursewareVersion(versionId: string, format: "xlsx" | "json" | "zip") {
  await download(`/api/courseware-versions/${versionId}/export?format=${format}`, `courseware.${format}`);
}
