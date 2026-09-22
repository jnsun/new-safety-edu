import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Key } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Drawer,
  Dropdown,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Row,
  Select,
  Space,
  Steps,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import type { UploadFile } from "antd";
import { api, json } from "./api";
import "./monthly-reports.css";

type Organization = { id: string; name: string; type: string };
type Project = {
  id: string;
  name: string;
  code: string;
  responsibleOrganizationId: string;
  status: string;
  projectType?: string | null;
  location?: string | null;
  contractAmount?: string | number | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  managerName?: string | null;
  managerPhone?: string | null;
  responsibleOrganization: { id: string; name: string };
  previousDefaults?: {
    overallProgress?: string;
    onsiteCount?: number;
    onsiteVehicles?: number;
    equipmentModels?: string;
  };
};
type PersonOption = { id: string; name: string; phone: string };
type CertificateType = {
  id: string;
  name: string;
  category: "company" | "personal";
  subtype1Label?: string;
  subtype1Options: string[];
  subtype2Label?: string;
  subtype2Options: string[];
  requiresAnnualTraining: boolean;
  sortOrder: number;
  active: boolean;
};
type Certificate = {
  id: string;
  category: "company" | "personal";
  ownerId: string;
  ownerName: string;
  organizationId?: string;
  organizationName: string;
  holderName?: string;
  holderPosition?: string;
  typeId?: string;
  type?: CertificateType;
  name: string;
  certificateNo?: string;
  subtype1Value?: string;
  subtype2Value?: string;
  issuingAuthority?: string;
  issuedAt?: string;
  validFrom?: string;
  expiresAt?: string;
  isLongTerm: boolean;
  status: "active" | "replaced" | "revoked" | "voided";
  expiryState: "valid" | "expiring" | "expired" | "long_term";
  trainingStatus?: "trained" | "not_required" | "pending";
  scope?: string;
  remark?: string;
  attachments: Array<{
    id: string;
    file: { id: string; originalName: string; mimeType: string; size: number };
  }>;
  trainingRecords?: Array<{
    id: string;
    year: number;
    trainingDate: string;
    content: string;
    trainingOrganization?: string;
    hours?: string;
    result?: string;
    status?: "active" | "voided";
  }>;
};
type MonthlyReport = {
  id: string;
  projectId: string;
  reportingOrganizationId: string;
  reportMonth: string;
  status: "draft" | "submitted" | "withdrawn" | "voided";
  revision: number;
  progressSummary: string;
  projectTypeId?: string;
  projectType?: { id: string; name: string };
  constructionLocation?: string;
  contractAmount: string;
  durationMonths?: number;
  departmentEntity?: string;
  projectManager?: string;
  contactInfo?: string;
  overallProgress?: string;
  monthlyConstructionStatus?: string;
  equipmentModels?: string;
  onsiteCount: number;
  onsiteVehicles: number;
  safetyInspection: boolean;
  safetyHazards: boolean;
  safetyHazardDetail?: string;
  safetyHazardCount: number;
  rectifiedHazardCount: number;
  safetyInvestment: string;
  incidentCount: number;
  projectStatus: "active" | "completed";
  customData: Record<string, unknown>;
  notes?: string;
  submittedAt?: string;
  voidedAt?: string;
  fieldSnapshot?: Array<{ key: string; label: string; value: unknown }>;
  revisions?: Array<{ revision: number; beforeSnapshot: Record<string, unknown>; createdAt: string }>;
  project: Project;
  reportingOrganization: Organization;
  attachments?: Array<{
    id: string;
    file: { id: string; originalName: string; mimeType: string; size: number };
  }>;
};
type ReportConfig = {
  types: Array<{
    id: string;
    name: string;
    sortOrder: number;
    active: boolean;
  }>;
  fields: Array<{
    id: string;
    fieldKey: string;
    label: string;
    fieldType: "text" | "number" | "textarea" | "select" | "date";
    options: string[];
    required: boolean;
    sortOrder: number;
    active: boolean;
    builtin: boolean;
  }>;
  organizations: Array<{ id: string; name: string; reportingEnabled: boolean }>;
  settings: { deadlineDay: number };
};

const dateText = (value?: string) =>
  value ? value.slice(0, 10) : "长期/未填写";
const expiryTag = (value?: string) => {
  if (!value) return <Tag>长期</Tag>;
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
  return (
    <Tag color={days < 0 ? "red" : days <= 90 ? "orange" : "green"}>
      {days < 0 ? "已到期" : days <= 90 ? `${days} 天后到期` : "有效"}
    </Tag>
  );
};

export function QualificationsPage({
  canWrite = false,
}: {
  canWrite?: boolean;
}) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [typeForm] = Form.useForm();
  const [trainingForm] = Form.useForm();
  const [category, setCategory] = useState<"all" | "company" | "personal">(
    "all",
  );
  const [filters, setFilters] = useState({
    organizationId: "",
    typeId: "",
    status: "",
    keyword: "",
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Certificate>();
  const [renewing, setRenewing] = useState<Certificate>();
  const [detail, setDetail] = useState<Certificate>();
  const [typeOpen, setTypeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [previewRows, setPreviewRows] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [selectedIds, setSelectedIds] = useState<Key[]>([]);
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: () => api<Organization[]>("/api/organizations"),
  });
  const people = useQuery({
    queryKey: ["persons"],
    queryFn: () => api<PersonOption[]>("/api/persons"),
  });
  const types = useQuery({
    queryKey: ["certificate-types"],
    queryFn: () => api<CertificateType[]>("/api/certificate-types"),
  });
  const settings = useQuery({
    queryKey: ["certificate-settings"],
    queryFn: () => api<{ warnDays: number }>("/api/certificate-settings"),
  });
  const params = new URLSearchParams(
    Object.entries({
      ...(category === "all" ? {} : { category }),
      ...filters,
    }).filter(([, value]) => value),
  );
  const ledger = useQuery({
    queryKey: ["certificates", category, filters],
    queryFn: () =>
      api<{
        rows: Certificate[];
        summary: { total: number; expiring: number; expired: number };
        warnDays: number;
      }>(`/api/certificates?${params}`),
  });
  const selectedCategory = (Form.useWatch("category", form) ?? "company") as
    | "company"
    | "personal";
  const selectedTypeId = Form.useWatch("typeId", form) as string | undefined;
  const selectedType = types.data?.find((row) => row.id === selectedTypeId);
  const categoryTypes = useMemo(
    () =>
      (types.data ?? []).filter(
        (row) => row.active && row.category === selectedCategory,
      ),
    [types.data, selectedCategory],
  );
  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ["certificates"] });
  const openForm = (row?: Certificate, renew = false) => {
    setEditing(renew ? undefined : row);
    setRenewing(renew ? row : undefined);
    setFiles([]);
    form.resetFields();
    form.setFieldsValue(
      row
        ? {
            ...row,
            ownerId: row.ownerId,
            typeId: row.typeId,
            expiresAt: row.expiresAt ?? "",
            issuedAt: row.issuedAt ?? "",
            validFrom: row.validFrom ?? "",
          }
        : { category: "company", isLongTerm: false },
    );
    setOpen(true);
  };
  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const fileIds: string[] = [];
      for (const file of files) {
        if (!file.originFileObj) continue;
        const body = new FormData();
        body.append("file", file.originFileObj);
        const uploaded = await api<{ id: string }>(
          "/api/files?kind=attachment",
          { method: "POST", body },
        );
        fileIds.push(uploaded.id);
      }
      const target = renewing
        ? `/api/certificates/${renewing.category}/${renewing.id}/renew`
        : editing
          ? `/api/certificates/${editing.category}/${editing.id}`
          : "/api/certificates";
      return api(
        target,
        json(editing ? "PATCH" : "POST", { ...values, fileIds }),
      );
    },
    onSuccess: () => {
      message.success(renewing ? "换证记录已建立，旧证已保留" : "证照已保存");
      setOpen(false);
      setEditing(undefined);
      setRenewing(undefined);
      form.resetFields();
      refresh();
    },
    onError: (error) => message.error(error.message),
  });
  const addType = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      api(
        "/api/certificate-types",
        json("POST", {
          ...values,
          subtype1Options: String(values.subtype1Options ?? "")
            .split(/[，,]/)
            .map((v) => v.trim())
            .filter(Boolean),
          subtype2Options: String(values.subtype2Options ?? "")
            .split(/[，,]/)
            .map((v) => v.trim())
            .filter(Boolean),
          active: true,
        }),
      ),
    onSuccess: () => {
      message.success("证照类型已新增");
      typeForm.resetFields();
      void qc.invalidateQueries({ queryKey: ["certificate-types"] });
    },
    onError: (error) => message.error(error.message),
  });
  const importPreview = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    try {
      const data = await api<{
        rows: Array<Record<string, unknown>>;
        summary: { ready: number; conflict: number; invalid: number };
        errors: string[];
      }>("/api/certificates/import/preview", { method: "POST", body });
      setPreviewRows(data.rows);
      if (data.errors.length) message.error(data.errors.join("；"));
      else
        message.success(
          `预检查完成：${data.summary.ready} 条可导入，${data.summary.conflict ?? 0} 条冲突，${data.summary.invalid} 条无效`,
        );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "预检查失败");
    }
    return false;
  };
  const confirmImport = async () => {
    try {
      const data = await api<{
        summary: { success: number; failed: number; skipped: number };
      }>(
        "/api/certificates/import/confirm",
        json("POST", { rows: previewRows }),
      );
      message.success(
        `导入完成：成功 ${data.summary.success}，失败 ${data.summary.failed}，跳过 ${data.summary.skipped}`,
      );
      setImportOpen(false);
      setPreviewRows([]);
      refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导入失败");
    }
  };
  const initializeTraining = () =>
    Modal.confirm({
      title: "按规则初始化培训状态？",
      content: "不会覆盖已培训状态。",
      onOk: async () => {
        const result = await api<{ updated: number }>(
          "/api/person-certificates/training-status/initialize",
          { method: "POST" },
        );
        message.success(`已更新 ${result.updated} 条个人证照`);
        refresh();
      },
    });
  const cleanupDuplicates = async () => {
    const preview = await api<{
      groups: Array<{
        category: "company" | "personal";
        keepId: string;
        duplicateIds: string[];
        name: string;
      }>;
      duplicateCount: number;
    }>("/api/certificates/duplicates");
    if (!preview.duplicateCount) {
      message.success("未发现完全重复记录");
      return;
    }
    let correctionReason = "";
    Modal.confirm({
      title: `发现 ${preview.duplicateCount} 条完全重复记录`,
      content: <Space direction="vertical" style={{ width: "100%" }}><div>将保留最早记录，其余作废并保留历史，不物理删除。</div><Input placeholder="请输入更正原因（必填）" onChange={(event) => { correctionReason = event.target.value; }} /></Space>,
      onOk: async () => {
        if (correctionReason.trim().length < 2) throw new Error("请输入至少 2 个字的更正原因");
        await api(
          "/api/certificates/duplicates/cleanup",
          json("POST", { groups: preview.groups, reason: correctionReason.trim() }),
        );
        message.success("重复记录已处理");
        refresh();
      },
    });
  };
  const bulkTraining = () => {
    let status = "pending";
    let reason = "";
    Modal.confirm({
      title: `调整 ${selectedIds.length} 条个人证照的本年度培训状态`,
      content: (
        <Space direction="vertical" style={{ width: "100%", marginTop: 12 }}>
          <Select
            defaultValue="pending"
            style={{ width: "100%" }}
            options={[
              { value: "pending", label: "待培训" },
              { value: "trained", label: "已培训" },
              { value: "not_required", label: "无需培训" },
            ]}
            onChange={(value) => {
              status = value;
            }}
          />
          <Input
            placeholder="设置无需培训时必须填写原因"
            onChange={(event) => {
              reason = event.target.value;
            }}
          />
        </Space>
      ),
      onOk: async () => {
        await api(
          "/api/person-certificates/training-status",
          json("POST", {
            ids: selectedIds,
            status,
            reason: reason || undefined,
          }),
        );
        setSelectedIds([]);
        message.success("本年度培训状态已更新");
        refresh();
      },
    });
  };
  const expiry = (state: Certificate["expiryState"]) => (
    <Tag
      color={
        state === "expired"
          ? "red"
          : state === "expiring"
            ? "orange"
            : state === "valid"
              ? "green"
              : "default"
      }
    >
      {
        {
          expired: "已到期",
          expiring: "即将到期",
          valid: "有效",
          long_term: "长期",
        }[state]
      }
    </Tag>
  );
  const training = (value?: Certificate["trainingStatus"]) =>
    value ? (
      <Tag
        color={
          value === "trained"
            ? "green"
            : value === "pending"
              ? "orange"
              : "default"
        }
      >
        {
          { trained: "已培训", pending: "待培训", not_required: "无需培训" }[
            value
          ]
        }
      </Tag>
    ) : (
      "—"
    );
  const columns = [
    { title: "所属组织", dataIndex: "organizationName" },
    ...(category !== "company"
      ? [
          {
            title: "持证人",
            dataIndex: "holderName",
            render: (v: string) => v || "—",
          },
        ]
      : []),
    {
      title: "证照类型",
      render: (_: unknown, row: Certificate) => (
        <Tag color="blue">{row.type?.name ?? row.category}</Tag>
      ),
    },
    { title: "证照名称", dataIndex: "name" },
    {
      title: "子分类",
      render: (_: unknown, row: Certificate) =>
        [row.subtype1Value, row.subtype2Value].filter(Boolean).join(" / ") ||
        "—",
    },
    { title: "有效期至", dataIndex: "expiresAt", render: dateText },
    {
      title: "到期状态",
      render: (_: unknown, row: Certificate) => expiry(row.expiryState),
    },
    ...(category !== "company"
      ? [{ title: "当年培训", dataIndex: "trainingStatus", render: training }]
      : []),
    {
      title: "操作",
      fixed: "right" as const,
      render: (_: unknown, row: Certificate) => (
        <Space>
          <Button size="small" onClick={() => setDetail(row)}>
            详情
          </Button>
          {canWrite && row.status === "active" ? (
            <>
              <Button size="small" onClick={() => openForm(row)}>
                编辑
              </Button>
              <Button size="small" onClick={() => openForm(row, true)}>
                换证
              </Button>
              <Button
                danger
                size="small"
                onClick={() =>
                  Modal.confirm({
                    title: `注销“${row.name}”？`,
                    content: "历史记录会保留，不会物理删除。",
                    onOk: async () => {
                      await api(
                        `/api/certificates/${row.category}/${row.id}/revoke`,
                        { method: "PATCH" },
                      );
                      refresh();
                    },
                  })
                }
              >
                注销
              </Button>
              <Button
                danger
                size="small"
                onClick={() => {
                  let reason = "";
                  Modal.confirm({
                    title: `作废“${row.name}”？`,
                    content: (
                      <Input.TextArea
                        autoFocus
                        rows={3}
                        placeholder="请输入作废原因"
                        onChange={(event) => {
                          reason = event.target.value;
                        }}
                      />
                    ),
                    onOk: async () => {
                      await api(
                        `/api/certificates/${row.category}/${row.id}/void`,
                        json("POST", { reason }),
                      );
                      message.success("证照已作废并保留历史");
                      refresh();
                    },
                  });
                }}
              >
                作废
              </Button>
            </>
          ) : null}
        </Space>
      ),
    },
  ];
  return (
    <div className="admin-workspace qualification-ledger-page">
      <Space className="page-title" wrap>
        <Typography.Title level={3}>资质证照台账</Typography.Title>
        {canWrite && (
          <>
            <Dropdown
              menu={{
                items: [
                  {
                    key: "import",
                    label: "批量导入",
                    onClick: () => setImportOpen(true),
                  },
                  {
                    key: "duplicates",
                    label: "去重清理",
                    onClick: () => void cleanupDuplicates(),
                  },
                  {
                    key: "bulk",
                    label: `批量调整培训状态${selectedIds.length ? `（${selectedIds.length}）` : ""}`,
                    disabled: !selectedIds.length,
                    onClick: bulkTraining,
                  },
                  {
                    key: "initialize",
                    label: "按规则初始化培训状态",
                    onClick: initializeTraining,
                  },
                  { type: "divider" },
                  {
                    key: "types",
                    label: "类型字典",
                    onClick: () => setTypeOpen(true),
                  },
                  {
                    key: "settings",
                    label: "到期预警设置",
                    onClick: () => setSettingsOpen(true),
                  },
                ],
              }}
            >
              <Button>工具 ▾</Button>
            </Dropdown>
            <Button href="/api/certificates.csv">导出 CSV</Button>
            <Button type="primary" onClick={() => openForm()}>
              新增证照
            </Button>
          </>
        )}
      </Space>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="证照总数"
              value={ledger.data?.summary.total ?? 0}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title={`未来 ${ledger.data?.warnDays ?? 90} 天到期`}
              value={ledger.data?.summary.expiring ?? 0}
              valueStyle={{ color: "#d97706" }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="已到期"
              value={ledger.data?.summary.expired ?? 0}
              valueStyle={{ color: "#dc2626" }}
            />
          </Card>
        </Col>
      </Row>
      <Card>
        <Tabs
          activeKey={category}
          onChange={(key) => {
            setCategory(key as typeof category);
            setSelectedIds([]);
          }}
          items={[
            { key: "all", label: "全部" },
            { key: "company", label: "公司证照" },
            { key: "personal", label: "个人证照" },
          ]}
        />
        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            allowClear
            placeholder="所属组织"
            style={{ width: 200 }}
            options={(organizations.data ?? []).map((row) => ({
              value: row.id,
              label: row.name,
            }))}
            onChange={(value) =>
              setFilters({ ...filters, organizationId: value ?? "" })
            }
          />
          <Select
            allowClear
            placeholder="证照类型"
            style={{ width: 220 }}
            options={(types.data ?? [])
              .filter((row) => category === "all" || row.category === category)
              .map((row) => ({ value: row.id, label: row.name }))}
            onChange={(value) =>
              setFilters({ ...filters, typeId: value ?? "" })
            }
          />
          <Select
            allowClear
            placeholder="记录状态"
            style={{ width: 140 }}
            options={[
              { value: "active", label: "有效记录" },
              { value: "replaced", label: "已换证" },
              { value: "revoked", label: "已注销" },
            ]}
            onChange={(value) =>
              setFilters({ ...filters, status: value ?? "" })
            }
          />
          <Input.Search
            allowClear
            placeholder="名称、编号、持证人或子分类"
            style={{ width: 280 }}
            onSearch={(value) => setFilters({ ...filters, keyword: value })}
          />
        </Space>
        <Table
          rowKey={(row) => row.id}
          {...(canWrite
            ? {
                rowSelection: {
                  selectedRowKeys: selectedIds,
                  onChange: setSelectedIds,
                  getCheckboxProps: (row: Certificate) => ({
                    disabled: row.category !== "personal",
                  }),
                },
              }
            : {})}
          loading={ledger.isLoading}
          dataSource={ledger.data?.rows ?? []}
          pagination={false}
          scroll={{ x: 1100 }}
          columns={columns}
        />
      </Card>
      <Modal
        title={renewing ? "办理换证" : editing ? "编辑证照" : "新增证照"}
        open={open}
        footer={null}
        width={760}
        onCancel={() => setOpen(false)}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => save.mutate(values)}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="category"
                label="大类"
                rules={[{ required: true }]}
              >
                <Select
                  disabled={!!editing || !!renewing}
                  options={[
                    { value: "company", label: "公司证照" },
                    { value: "personal", label: "个人证照" },
                  ]}
                  onChange={() => {
                    form.setFieldValue("ownerId", undefined);
                    form.setFieldValue("typeId", undefined);
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="ownerId"
                label={selectedCategory === "company" ? "所属组织" : "持证人"}
                rules={[{ required: true }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  disabled={!!renewing}
                  options={(selectedCategory === "company"
                    ? (organizations.data ?? [])
                    : (people.data ?? [])
                  ).map((row) => ({ value: row.id, label: row.name }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="typeId"
                label="证照类型"
                rules={[{ required: true }]}
              >
                <Select
                  options={categoryTypes.map((row) => ({
                    value: row.id,
                    label: row.name,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="name"
                label="证照名称"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
            </Col>
            {selectedType?.subtype1Label && (
              <Col span={12}>
                <Form.Item
                  name="subtype1Value"
                  label={selectedType.subtype1Label}
                  rules={[{ required: true }]}
                >
                  <Select
                    options={selectedType.subtype1Options.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Form.Item>
              </Col>
            )}
            {selectedType?.subtype2Label && (
              <Col span={12}>
                <Form.Item
                  name="subtype2Value"
                  label={selectedType.subtype2Label}
                  rules={[{ required: true }]}
                >
                  <Select
                    options={selectedType.subtype2Options.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </Form.Item>
              </Col>
            )}
            <Col span={12}>
              <Form.Item name="certificateNo" label="证照编号">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="issuingAuthority" label="发证机关">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="issuedAt" label="发证日期">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="validFrom" label="有效期开始">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="expiresAt" label="有效期至">
                <Input
                  type="date"
                  disabled={Form.useWatch("isLongTerm", form)}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="isLongTerm" valuePropName="checked">
                <Checkbox>长期有效</Checkbox>
              </Form.Item>
            </Col>
            {selectedCategory === "personal" && (
              <>
                <Col span={12}>
                  <Form.Item name="holderPosition" label="持证岗位">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="trainingStatus" label="当年培训状态">
                    <Select
                      allowClear
                      options={[
                        { value: "pending", label: "待培训" },
                        { value: "trained", label: "已培训" },
                        { value: "not_required", label: "无需培训" },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </>
            )}
            {selectedCategory === "company" && (
              <Col span={24}>
                <Form.Item name="scope" label="许可范围">
                  <Input.TextArea rows={2} />
                </Form.Item>
              </Col>
            )}
            <Col span={24}>
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="附件（PDF/PNG/JPG/WebP，单个不超过 10MB）">
            <Upload
              multiple
              beforeUpload={(file) => {
                setFiles((current) => [...current, file]);
                return false;
              }}
              onRemove={(file) => {
                setFiles((current) =>
                  current.filter((item) => item.uid !== file.uid),
                );
              }}
              fileList={files}
            >
              {files.length < 20 && <Button>选择附件</Button>}
            </Upload>
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            {renewing ? "确认换证" : "保存"}
          </Button>
        </Form>
      </Modal>
      <Modal
        title="证照详情"
        open={!!detail}
        onCancel={() => setDetail(undefined)}
        footer={null}
        width={760}
      >
        {detail && (
          <>
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                {
                  key: "category",
                  label: "大类",
                  children:
                    detail.category === "company" ? "公司证照" : "个人证照",
                },
                {
                  key: "owner",
                  label: detail.category === "company" ? "所属组织" : "持证人",
                  children: detail.ownerName,
                },
                {
                  key: "type",
                  label: "证照类型",
                  children: detail.type?.name ?? "—",
                },
                { key: "name", label: "证照名称", children: detail.name },
                {
                  key: "no",
                  label: "证照编号",
                  children: detail.certificateNo || "—",
                },
                {
                  key: "issuer",
                  label: "发证机关",
                  children: detail.issuingAuthority || "—",
                },
                {
                  key: "valid",
                  label: "有效期",
                  children: detail.isLongTerm
                    ? "长期"
                    : `${detail.validFrom ?? "—"} 至 ${detail.expiresAt ?? "—"}`,
                },
                {
                  key: "status",
                  label: "到期状态",
                  children: expiry(detail.expiryState),
                },
                ...(detail.category === "personal"
                  ? [
                      {
                        key: "training",
                        label: "当年培训",
                        children: training(detail.trainingStatus),
                      },
                    ]
                  : []),
                {
                  key: "remark",
                  label: "备注",
                  children: detail.remark || "—",
                  span: 2,
                },
              ]}
            />
            <Typography.Title level={5} style={{ marginTop: 20 }}>
              附件
            </Typography.Title>
            <Space wrap>
              {detail.attachments.length
                ? detail.attachments.map((item) => (
                    <Button
                      key={item.id}
                      href={`/api/files/${item.file.id}`}
                      target="_blank"
                    >
                      {item.file.originalName}
                    </Button>
                  ))
                : "暂无附件"}
            </Space>
            {detail.category === "personal" && (
              <>
                <Typography.Title level={5} style={{ marginTop: 20 }}>
                  历年培训记录
                </Typography.Title>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={detail.trainingRecords ?? []}
                  columns={[
                    { title: "年度", dataIndex: "year" },
                    {
                      title: "日期",
                      dataIndex: "trainingDate",
                      render: dateText,
                    },
                    { title: "内容", dataIndex: "content" },
                    { title: "机构", dataIndex: "trainingOrganization" },
                    { title: "学时", dataIndex: "hours" },
                    { title: "结果", dataIndex: "result" },
                    {
                      title: "状态",
                      dataIndex: "status",
                      render: (value: string) =>
                        value === "voided" ? "已作废" : "有效",
                    },
                    ...(canWrite
                      ? [
                          {
                            title: "操作",
                            render: (
                              _: unknown,
                              record: NonNullable<
                                Certificate["trainingRecords"]
                              >[number],
                            ) =>
                              record.status === "voided" ? null : (
                                <Space>
                                  <Button
                                    size="small"
                                    onClick={() => {
                                      let reason = "";
                                      Modal.confirm({
                                        title: "更正年度培训记录",
                                        content: (
                                          <Input
                                            placeholder="请输入更正原因"
                                            onChange={(event) => {
                                              reason = event.target.value;
                                            }}
                                          />
                                        ),
                                        onOk: async () => {
                                          await api(
                                            `/api/certificate-training-records/${record.id}`,
                                            json("PATCH", {
                                              year: record.year,
                                              trainingDate:
                                                record.trainingDate.slice(
                                                  0,
                                                  10,
                                                ),
                                              content: record.content,
                                              trainingOrganization:
                                                record.trainingOrganization,
                                              hours: record.hours,
                                              result: record.result,
                                              correctionReason: reason,
                                            }),
                                          );
                                          message.success(
                                            "已建立更正记录，原记录保留为作废",
                                          );
                                          setDetail(undefined);
                                          refresh();
                                        },
                                      });
                                    }}
                                  >
                                    更正
                                  </Button>
                                  <Button
                                    danger
                                    size="small"
                                    onClick={() => {
                                      let reason = "";
                                      Modal.confirm({
                                        title: "作废年度培训记录",
                                        content: (
                                          <Input
                                            placeholder="请输入作废原因"
                                            onChange={(event) => {
                                              reason = event.target.value;
                                            }}
                                          />
                                        ),
                                        onOk: async () => {
                                          await api(
                                            `/api/certificate-training-records/${record.id}/void`,
                                            json("POST", { reason }),
                                          );
                                          message.success(
                                            "记录已作废，历史仍保留",
                                          );
                                          setDetail(undefined);
                                          refresh();
                                        },
                                      });
                                    }}
                                  >
                                    作废
                                  </Button>
                                </Space>
                              ),
                          },
                        ]
                      : []),
                  ]}
                />
                {canWrite && (
                  <Form
                    form={trainingForm}
                    layout="inline"
                    style={{ marginTop: 12 }}
                    onFinish={async (values) => {
                      await api(
                        `/api/person-certificates/${detail.id}/training-records`,
                        json("POST", values),
                      );
                      message.success("培训记录已保存");
                      trainingForm.resetFields();
                      setDetail(undefined);
                      refresh();
                    }}
                  >
                    <Form.Item name="year" rules={[{ required: true }]}>
                      <InputNumber placeholder="年度" min={2000} max={9999} />
                    </Form.Item>
                    <Form.Item name="trainingDate" rules={[{ required: true }]}>
                      <Input type="date" />
                    </Form.Item>
                    <Form.Item name="content" rules={[{ required: true }]}>
                      <Input placeholder="培训内容" />
                    </Form.Item>
                    <Button htmlType="submit">新增记录</Button>
                  </Form>
                )}
              </>
            )}
          </>
        )}
      </Modal>
      <Modal
        title="证照类型字典"
        open={typeOpen}
        onCancel={() => setTypeOpen(false)}
        footer={null}
        width={960}
      >
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={types.data ?? []}
          columns={[
            {
              title: "大类",
              dataIndex: "category",
              render: (v: string) => (v === "company" ? "公司" : "个人"),
            },
            { title: "类型", dataIndex: "name" },
            {
              title: "子分类1",
              render: (_: unknown, row: CertificateType) =>
                row.subtype1Label
                  ? `${row.subtype1Label}：${row.subtype1Options.join("/")}`
                  : "—",
            },
            {
              title: "子分类2",
              render: (_: unknown, row: CertificateType) =>
                row.subtype2Label
                  ? `${row.subtype2Label}：${row.subtype2Options.join("/")}`
                  : "—",
            },
            {
              title: "年度培训",
              dataIndex: "requiresAnnualTraining",
              render: (v: boolean) => (v ? "需要" : "无需"),
            },
            {
              title: "状态",
              dataIndex: "active",
              render: (v: boolean) => (v ? "启用" : "停用"),
            },
            {
              title: "操作",
              render: (_: unknown, row: CertificateType) => (
                <Button
                  size="small"
                  onClick={async () => {
                    await api(
                      `/api/certificate-types/${row.id}`,
                      json("PATCH", { active: !row.active }),
                    );
                    void qc.invalidateQueries({
                      queryKey: ["certificate-types"],
                    });
                  }}
                >
                  {row.active ? "停用" : "启用"}
                </Button>
              ),
            },
          ]}
        />
        <Form
          form={typeForm}
          layout="inline"
          style={{ marginTop: 16 }}
          onFinish={(values) => addType.mutate(values)}
        >
          <Form.Item name="category" rules={[{ required: true }]}>
            <Select
              placeholder="大类"
              style={{ width: 110 }}
              options={[
                { value: "company", label: "公司" },
                { value: "personal", label: "个人" },
              ]}
            />
          </Form.Item>
          <Form.Item name="name" rules={[{ required: true }]}>
            <Input placeholder="类型名称" />
          </Form.Item>
          <Form.Item name="subtype1Label">
            <Input placeholder="子分类1名称" />
          </Form.Item>
          <Form.Item name="subtype1Options">
            <Input placeholder="选项，逗号分隔" />
          </Form.Item>
          <Form.Item
            name="requiresAnnualTraining"
            valuePropName="checked"
            initialValue={false}
          >
            <Checkbox>需要年度培训</Checkbox>
          </Form.Item>
          <Button htmlType="submit">新增</Button>
        </Form>
      </Modal>
      <Modal
        title="到期预警设置"
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        footer={null}
      >
        <Form
          initialValues={{ warnDays: settings.data?.warnDays ?? 90 }}
          onFinish={async (values) => {
            await api("/api/certificate-settings", json("PATCH", values));
            message.success("预警设置已保存");
            setSettingsOpen(false);
            void qc.invalidateQueries({ queryKey: ["certificate-settings"] });
            refresh();
          }}
        >
          <Form.Item
            name="warnDays"
            label="提前预警天数"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={365} />
          </Form.Item>
          <Button htmlType="submit" type="primary">
            保存
          </Button>
        </Form>
      </Modal>
      <Modal
        title="批量导入证照"
        open={importOpen}
        onCancel={() => {
          setImportOpen(false);
          setPreviewRows([]);
        }}
        width={900}
        onOk={() => void confirmImport()}
        okText="确认导入可用记录"
        okButtonProps={{
          disabled: !previewRows.some((row) => row.status === "ready" || (row.status === "conflict" && row.conflictAction)) || previewRows.some((row) => row.status === "conflict" && !row.conflictAction),
        }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="先下载模板，填写后上传 XLSX。系统先预检查，不会直接写入。"
          />
          <Button href="/api/certificates/import-template.xlsx">
            下载 XLSX 模板
          </Button>
          <Upload
            accept=".xlsx"
            maxCount={1}
            beforeUpload={(file) => {
              void importPreview(file);
              return false;
            }}
            showUploadList={false}
          >
            <Button>选择 XLSX 并预检查</Button>
          </Upload>
          {previewRows.length > 0 && (
            <Table
              size="small"
              rowKey="rowNumber"
              pagination={{ pageSize: 10 }}
              dataSource={previewRows}
              columns={[
                { title: "Excel 行", dataIndex: "rowNumber" },
                {
                  title: "大类",
                  dataIndex: "category",
                  render: (v: string) =>
                    v === "company" ? "公司" : v === "personal" ? "个人" : "—",
                },
                { title: "归属", dataIndex: "ownerName" },
                { title: "类型", dataIndex: "typeName" },
                { title: "名称", dataIndex: "name" },
                {
                  title: "状态",
                  dataIndex: "status",
                  render: (v: string) => (
                    <Tag color={v === "ready" ? "green" : v === "conflict" ? "orange" : "red"}>
                      {v === "ready" ? "可导入" : v === "conflict" ? "冲突待选择" : "无效"}
                    </Tag>
                  ),
                },
                {
                  title: "冲突处理",
                  dataIndex: "conflictAction",
                  render: (value: string, row: Record<string, unknown>) => row.status !== "conflict" ? "—" : <Select style={{ width: 150 }} value={value} placeholder="必须选择" options={[{ value: "skip", label: "跳过" }, { value: "renew", label: "换证" }, { value: "void_and_create", label: "作废后新建" }]} onChange={(next) => setPreviewRows((current) => current.map((item) => item.rowNumber === row.rowNumber ? { ...item, conflictAction: next } : item))} />,
                },
                {
                  title: "原因",
                  dataIndex: "reasons",
                  render: (v: string[]) => v?.join("；") || "—",
                },
              ]}
            />
          )}
        </Space>
      </Modal>
    </div>
  );
}

export function MonthlyReportsPage() {
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const selectedDraftProjectId = Form.useWatch("projectId", form);
  const [typeForm] = Form.useForm();
  const [typeEditForm] = Form.useForm();
  const [fieldForm] = Form.useForm();
  const [fieldEditForm] = Form.useForm();
  const today = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(today);
  const [allMonths, setAllMonths] = useState(false);
  const view = location.pathname.split("/")[2] || "mine";
  const setView = (next: string) => navigate(`/monthly-reports/${next}`);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MonthlyReport>();
  const [detail, setDetail] = useState<MonthlyReport>();
  const [history, setHistory] = useState<MonthlyReport[]>([]);
  const [historyReportId, setHistoryReportId] = useState<string>();
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [manageTab, setManageTab] = useState<"batches" | "no_projects">("batches");
  const [manageOrg, setManageOrg] = useState<string>();
  const [manageType, setManageType] = useState<string>();
  const [completedOrg, setCompletedOrg] = useState<string>();
  const [completedType, setCompletedType] = useState<string>();
  const [projectFilter, setProjectFilter] = useState<"all" | "todo" | "draft" | "submitted" | "voided">("all");
  const [noFieldOrg, setNoFieldOrg] = useState<string>();
  const [noProjectDialog, setNoProjectDialog] = useState<"select" | "blocked" | "confirm" | null>(null);
  const [editingField, setEditingField] = useState<ReportConfig["fields"][number]>();
  const [editingType, setEditingType] = useState<ReportConfig["types"][number]>();
  const [savingField, setSavingField] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchResult, setBatchResult] = useState<{ id: string; status: string; reportType: string }>();
  const [reviewOrganizationId, setReviewOrganizationId] = useState<string>();
  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [remindingOrganizationId, setRemindingOrganizationId] = useState<string>();
  const [draftDirty, setDraftDirty] = useState(false);
  const [reportFiles, setReportFiles] = useState<UploadFile[]>([]);
  const capabilities = useQuery({
    queryKey: ["monthly-report-capabilities"],
    queryFn: () =>
      api<{
        canConfigure: boolean;
        canReview: boolean;
        canSubmit: boolean;
        organizationIds: string[];
      }>("/api/monthly-reports/capabilities"),
  });
  useEffect(() => {
    if (location.pathname === "/monthly-reports" && capabilities.data) {
      navigate(capabilities.data.canSubmit ? "/monthly-reports/mine" : capabilities.data.canReview ? "/monthly-reports/manage" : "/monthly-reports/completed", { replace: true });
    }
  }, [capabilities.data, location.pathname, navigate]);
  const config = useQuery({
    queryKey: ["report-config"],
    queryFn: () => api<ReportConfig>("/api/report-config"),
  });
  const projects = useQuery({
    queryKey: ["monthly-report-projects", month],
    queryFn: () =>
      api<Array<Project & { responsibleOrganization: Organization }>>(
        `/api/monthly-reports/projects?month=${month}`,
      ),
  });
  const [year, number] = month.split("-");
  const reports = useQuery({
    queryKey: ["monthly-reports", month, allMonths, keyword],
    queryFn: () =>
      api<MonthlyReport[]>(
        `/api/monthly-reports?year=${year}${allMonths ? "" : `&month=${Number(number)}`}${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ""}`,
      ),
  });
  const workbenchReports = useQuery({
    queryKey: ["monthly-reports-workbench", month],
    queryFn: () => api<MonthlyReport[]>(`/api/monthly-reports?year=${year}&month=${Number(number)}`),
  });
  const voidedReports = useQuery({
    queryKey: ["monthly-reports-voided", month],
    queryFn: () => api<MonthlyReport[]>(`/api/monthly-reports?year=${year}&month=${Number(number)}&status=voided`),
  });
  const completed = useQuery({
    queryKey: ["monthly-reports-completed", year],
    queryFn: () =>
      api<MonthlyReport[]>(
        `/api/monthly-reports?year=${year}&projectStatus=completed`,
      ),
  });
  const summary = useQuery({
    queryKey: ["monthly-report-summary", month],
    queryFn: () =>
      api<{
        stats: {
          departmentTotal: number;
          submittedDepartments: number;
          noFieldDepartments: number;
          missingDepartments: number;
          projectCount: number;
          onsitePeople: number;
          onsiteVehicles: number;
          hazardProjects: number;
          inspectionRate: number;
        };
        departments: Array<{
          id: string;
          name: string;
          status: "draft" | "submitted" | "rejected" | "confirmed" | "locked" | "missing";
          reportType: "projects" | "no_projects";
          returnReason?: string | null;
          submissionId?: string | null;
          reportCount: number;
          latestSubmittedAt?: string;
        }>;
        reports: MonthlyReport[];
        period?: { status: "closed" | "open" | "review" | "locked"; deadlineAt?: string | null } | null;
      }>(`/api/monthly-reports/summary?month=${month}`),
  });
  const selectedOrganizationId = noFieldOrg;
  const preflight = useQuery({
    queryKey: ["monthly-report-preflight", month, selectedOrganizationId],
    enabled: !!selectedOrganizationId && !!capabilities.data?.canSubmit,
    queryFn: () => api<{
      organizationId: string;
      month: string;
      periodStatus: string;
      submission: { id: string; status: string; reportType: string; returnReason?: string | null } | null;
      reportType: "projects" | "no_projects";
      expectedCount: number;
      completedCount: number;
      ready: boolean;
      reasons: string[];
      items: Array<{ id: string; name: string; code: string; status: string; report: { id: string; status: string; revision: number; updatedAt: string } | null }>;
    }>(`/api/monthly-reports/submissions/preflight?organizationId=${selectedOrganizationId}&month=${month}`),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["monthly-reports"] });
    void qc.invalidateQueries({ queryKey: ["monthly-report-summary"] });
    void qc.invalidateQueries({ queryKey: ["monthly-report-projects"] });
    void qc.invalidateQueries({ queryKey: ["monthly-report-preflight"] });
    void qc.invalidateQueries({ queryKey: ["monthly-reports-voided"] });
  };
  const openForm = (row?: MonthlyReport, project?: Project) => {
    setEditing(row);
    setDraftDirty(false);
    setReportFiles([]);
    form.resetFields();
    form.setFieldsValue(
      row
        ? {
            ...row,
            reportMonth: row.reportMonth.slice(0, 7),
            customData: row.customData,
          }
        : {
            projectId: project?.id,
            reportMonth: month,
            onsiteCount: 0,
            onsiteVehicles: 0,
            safetyInspection: false,
            safetyHazards: false,
            safetyInvestment: 0,
            incidentCount: 0,
            projectStatus: "active",
            customData: {},
            constructionLocation: project?.location ?? undefined,
            contractAmount: project?.contractAmount ?? 0,
            projectManager: project?.managerName ?? undefined,
            contactInfo: project?.managerPhone ?? undefined,
            ...(project?.previousDefaults ?? {}),
          },
    );
    setOpen(true);
  };
  const closeDraftForm = () => {
    if (!draftDirty) { setOpen(false); return; }
    Modal.confirm({ title: "放弃尚未保存的项目月报？", content: "本次填写的内容尚未保存为草稿。", okText: "放弃修改", okButtonProps: { danger: true }, cancelText: "继续填写", onOk: () => setOpen(false) });
  };
  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const fileIds: string[] = [];
      if (!editing) {
        for (const file of reportFiles) {
          if (!file.originFileObj) continue;
          const body = new FormData();
          body.append("file", file.originFileObj);
          const uploaded = await api<{ id: string }>(
            "/api/files?kind=attachment",
            { method: "POST", body },
          );
          fileIds.push(uploaded.id);
        }
      }
      return api(
        editing ? `/api/monthly-reports/${editing.id}` : "/api/monthly-reports",
        json(
          editing ? "PATCH" : "POST",
          editing
            ? { ...values, reason: "更新本月项目月报草稿" }
            : { ...values, fileIds },
        ),
      );
    },
    onSuccess: () => {
      message.success("项目月报草稿已保存；请完成本实体全部项目后统一提交");
      setOpen(false);
      setEditing(undefined);
      refresh();
    },
    onError: (error) => message.error(error.message),
  });
  const showHistory = async (projectId: string, reportId?: string) => {
    try {
      const records = await api<MonthlyReport[]>(`/api/monthly-reports/projects/${projectId}/history`);
      setHistory(records);
      setHistoryReportId(reportId ?? records.at(-1)?.id);
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  const reasonedAction = (row: MonthlyReport, action: "withdraw" | "void") => {
    let reason = "";
    Modal.confirm({
      title:
        action === "withdraw" ? "撤回月报后修改？" : "作废月报并永久保留历史？",
      content: (
        <Input.TextArea
          autoFocus
          rows={3}
          placeholder="请填写原因"
          onChange={(event) => {
            reason = event.target.value;
          }}
        />
      ),
      onOk: async () => {
        if (reason.trim().length < 2) { message.error("请填写至少两个字的原因"); throw new Error("缺少原因"); }
        try {
          await api(`/api/monthly-reports/${row.id}/${action}`, json("POST", { reason: reason.trim() }));
          message.success(action === "withdraw" ? "月报已撤回" : "月报已作废");
          refresh();
        } catch (error) { message.error((error as Error).message); throw error; }
      },
    });
  };
  const reportColumns = [
    {
      title: "月份",
      dataIndex: "reportMonth",
      render: (v: string) => v.slice(0, 7),
    },
    {
      title: "经营实体",
      render: (_: unknown, row: MonthlyReport) => (
        <Tag color="blue">{row.reportingOrganization.name}</Tag>
      ),
    },
    {
      title: "项目",
      render: (_: unknown, row: MonthlyReport) => (
        <Button type="link" onClick={() => setDetail(row)}>
          {row.project.name}
        </Button>
      ),
    },
    {
      title: "状态",
      render: (_: unknown, row: MonthlyReport) => (
        <Tag
          color={
            row.status === "submitted"
              ? "green"
              : row.status === "draft"
                ? "blue"
              : row.status === "withdrawn"
                ? "orange"
                : "default"
          }
        >
          {
            { draft: "草稿", submitted: "已提交", withdrawn: "已撤回", voided: "已作废" }[
              row.status
            ]
          }{" "}
          · v{row.revision}
        </Tag>
      ),
    },
    { title: "施工地点", dataIndex: "constructionLocation" },
    {
      title: "负责人/联系方式",
      render: (_: unknown, row: MonthlyReport) =>
        [row.projectManager, row.contactInfo].filter(Boolean).join(" / "),
    },
    {
      title: "现场人数/车辆",
      render: (_: unknown, row: MonthlyReport) =>
        `${row.onsiteCount} / ${row.onsiteVehicles}`,
    },
    {
      title: "安全自检",
      dataIndex: "safetyInspection",
      render: (v: boolean) => (
        <Tag color={v ? "green" : "red"}>{v ? "是" : "否"}</Tag>
      ),
    },
    {
      title: "安全隐患",
      dataIndex: "safetyHazards",
      render: (v: boolean) => (
        <Tag color={v ? "red" : "green"}>{v ? "有" : "无"}</Tag>
      ),
    },
    ...(capabilities.data?.canSubmit || capabilities.data?.canConfigure
      ? [
          {
            title: "操作",
            render: (_: unknown, row: MonthlyReport) => (
              <Space wrap>
                {capabilities.data?.canSubmit && ["draft", "withdrawn"].includes(row.status) && (
                  <>
                    <Button size="small" onClick={() => openForm(row)}>
                      编辑
                    </Button>
                  </>
                )}
                <Button
                  size="small"
                  onClick={() => void showHistory(row.project.id, row.id)}
                >
                  历史
                </Button>
                {capabilities.data?.canConfigure && row.status !== "voided" && (
                  <Button
                    danger
                    size="small"
                    onClick={() => reasonedAction(row, "void")}
                  >
                    作废
                  </Button>
                )}
              </Space>
            ),
          },
        ]
      : []),
  ];
  const completedRows = useMemo(() => {
    const latest = new Map<string, MonthlyReport>();
    for (const row of completed.data ?? [])
      if (row.status === "submitted" && row.reportMonth.slice(0, 7) === month && (!completedOrg || row.reportingOrganizationId === completedOrg) && (!completedType || row.projectTypeId === completedType))
      if (!latest.has(row.projectId)) latest.set(row.projectId, row);
    return [...latest.values()];
  }, [completed.data, month, completedOrg, completedType]);
  const stats = summary.data?.stats;
  const customFields = (config.data?.fields ?? []).filter(
    (field) => field.active && !field.builtin,
  );
  const noFieldOrganizationId = selectedOrganizationId;
  const ownDepartment = summary.data?.departments.find((row) => row.id === noFieldOrganizationId);
  const currentReports = (workbenchReports.data ?? []).filter((row) => row.reportingOrganizationId === noFieldOrganizationId && row.reportMonth.slice(0, 7) === month);
  const reportByProject = new Map(currentReports.map((row) => [row.projectId, row]));
  const voidedByProject = new Map((voidedReports.data ?? []).filter((row) => row.reportingOrganizationId === noFieldOrganizationId).map((row) => [row.projectId, row]));
  const selectedOrganizationName = (config.data?.organizations ?? []).find((row) => row.id === noFieldOrganizationId)?.name ?? "当前经营实体";
  const selectedDraftProject = projects.data?.find((row) => row.id === selectedDraftProjectId);
  const projectItems = preflight.data?.items ?? [];
  const visibleProjectItems = projectItems.filter((row) => projectFilter === "all" || (projectFilter === "todo" && !row.report && !voidedByProject.has(row.id)) || (projectFilter === "draft" && ["draft", "withdrawn"].includes(row.report?.status ?? "")) || (projectFilter === "submitted" && row.report?.status === "submitted") || (projectFilter === "voided" && !row.report && voidedByProject.has(row.id)));
  const availableOrganizations = (config.data?.organizations ?? []).filter((org) => capabilities.data?.organizationIds.includes(org.id));
  const chooseNoProject = () => {
    setNoProjectDialog(!noFieldOrganizationId ? "select" : preflight.isError || !preflight.data?.ready || preflight.data.expectedCount !== 0 ? "blocked" : "confirm");
  };
  const submitBatch = async () => {
    if (!noFieldOrganizationId || !preflight.data?.ready || submittingBatch) return false;
    setSubmittingBatch(true);
    try {
      const latest = await api<typeof preflight.data>(`/api/monthly-reports/submissions/preflight?organizationId=${noFieldOrganizationId}&month=${month}`);
      if (!latest.ready || latest.reportType !== preflight.data.reportType || latest.expectedCount !== preflight.data.expectedCount || latest.completedCount !== preflight.data.completedCount) {
        message.error("项目或草稿已变化，请重新核对后提交");
        await preflight.refetch();
        return false;
      }
      const result = await api<{ id: string; status: string; reportType: string }>("/api/monthly-reports/submissions", json("POST", { organizationId: noFieldOrganizationId, month, reportType: latest.reportType }));
      message.success("整批报送已提交，公司可查看；如有问题会退回修改");
      setBatchResult(result);
      setBatchOpen(false);
      refresh();
      return true;
    } catch (error) {
      message.error((error as Error).message);
      return false;
    } finally {
      setSubmittingBatch(false);
    }
  };
  const remindOrganization = (organizationId: string, name: string) => Modal.confirm({
    title: `提醒 ${name} 完成本月报送？`,
    content: "将向该实体当前在职负责人创建站内提醒；不代表短信或微信订阅消息已送达。十分钟内重复操作不会重复创建。",
    onOk: async () => {
      setRemindingOrganizationId(organizationId);
      try {
        const result = await api<{ requested: number; created: number; channel: "in_app" }>("/api/monthly-reports/submissions/remind", json("POST", { organizationId, month }));
        message.success(result.created ? `已创建 ${result.created} 条站内提醒` : "本时段已提醒过，无需重复发送");
      } catch (error) { message.error((error as Error).message); throw error; }
      finally { setRemindingOrganizationId(undefined); }
    },
  });
  const manage = (
    <>
      <div className="monthly-manage-actions"><Button onClick={() => setView("completed")}>完工项目</Button><Button onClick={() => setView("config")} disabled={!capabilities.data?.canConfigure}>报送配置</Button></div>
      {summary.isError && <Alert style={{ marginBottom: 16 }} type="error" showIcon message="报送汇总加载失败" description={<Button onClick={() => void summary.refetch()}>重新加载</Button>} />}
      {summary.isLoading && <Typography.Text type="secondary">正在加载本月报送汇总…</Typography.Text>}
      {summary.data && <Row gutter={[12, 12]} className="monthly-manage-stats">
        {([ ["应报主体", stats?.departmentTotal], ["已提交待查看", summary.data.departments.filter((item) => item.status === "submitted").length], ["待补齐主体", summary.data.departments.filter((item) => ["missing", "draft", "rejected"].includes(item.status)).length], ["历史确认主体", summary.data.departments.filter((item) => ["confirmed", "locked"].includes(item.status)).length] ] as const).map(([label, value]) => (
          <Col xs={12} md={6} key={label}>
            <Card size="small">
              <Statistic title={label} value={value ?? 0} />
            </Card>
          </Col>
        ))}
      </Row>}
      <div className="monthly-manage-tabs"><Button type={manageTab === "batches" ? "primary" : "text"} onClick={() => setManageTab("batches")}>经营实体批次</Button><Button type={manageTab === "no_projects" ? "primary" : "text"} onClick={() => setManageTab("no_projects")}>无项目确认</Button></div>
      <div className="monthly-manage-filter"><label>月份<Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><label>报送主体<Select allowClear placeholder="全部主体" value={manageOrg} onChange={setManageOrg} options={(summary.data?.departments ?? []).map((row) => ({ value: row.id, label: row.name }))} /></label><label>项目类型<Select allowClear placeholder="全部类型" value={manageType} onChange={setManageType} options={(config.data?.types ?? []).map((row) => ({ value: row.id, label: row.name }))} /></label><label>处理范围<Select value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "全部" }, { value: "missing", label: "待处理优先" }, { value: "submitted", label: "已提交" }, { value: "rejected", label: "已退回" }, { value: "locked", label: "已锁定" }]} /></label><Button type="primary" onClick={() => void summary.refetch()}>查询</Button></div>
      <Card size="small" className="monthly-manage-table">
        <Table style={{ marginTop: 16 }} rowKey="id" size="small" loading={summary.isLoading}
          dataSource={(summary.data?.departments ?? []).filter((row) => (manageTab === "batches" || row.reportType === "no_projects") && (!manageOrg || row.id === manageOrg) && (statusFilter === "all" || row.status === statusFilter || (statusFilter === "missing" && ["draft", "rejected"].includes(row.status))) && (!manageType || summary.data?.reports.some((report) => report.reportingOrganizationId === row.id && report.projectTypeId === manageType)))}
          pagination={{ pageSize: 10 }} columns={[
            { title: "经营实体 / 月份", render: (_: unknown, row: NonNullable<typeof summary.data>["departments"][number]) => <><strong>{row.name}</strong><br /><Typography.Text type="secondary">{month} · {row.reportCount} 个项目</Typography.Text></> },
            { title: "批次状态", render: (_: unknown, row: NonNullable<typeof summary.data>["departments"][number]) => <Tag color={row.status === "submitted" ? "blue" : row.status === "confirmed" || row.status === "locked" ? "green" : row.status === "rejected" ? "red" : "orange"}>{{ draft: "待补齐", submitted: "已提交", rejected: "已退回", confirmed: "已确认（历史）", locked: "已锁定", missing: "未报送" }[row.status]}</Tag> },
            { title: "截止时间", render: () => summary.data?.period?.deadlineAt?.slice(0, 16).replace("T", " ") ?? "未设置" },
            { title: "项目覆盖 / 最近处理", render: (_: unknown, row: NonNullable<typeof summary.data>["departments"][number]) => <>{row.reportType === "no_projects" ? "无项目报送" : `${row.reportCount} 个项目月报`}<br /><Typography.Text type="secondary">{row.latestSubmittedAt?.slice(0, 16).replace("T", " ") ?? row.returnReason ?? "尚未提交"}</Typography.Text></> },
            { title: "操作", render: (_: unknown, row: NonNullable<typeof summary.data>["departments"][number]) => <Space><Button type="link" onClick={() => setReviewOrganizationId(row.id)}>{row.status === "rejected" ? "查看退回原因" : row.status === "missing" ? "查看状态" : "查看批次"}</Button>{["missing", "draft", "rejected"].includes(row.status) && <Button type="link" loading={remindingOrganizationId === row.id} onClick={() => remindOrganization(row.id, row.name)}>提醒</Button>}</Space> },
          ]} />
      </Card>
    </>
  );
  const own = (
    <>
      <section className="monthly-filter-card">
        <div className="monthly-filter-fields">
          <label>报送月份<Input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setProjectFilter("all"); setBatchOpen(false); setBatchResult(undefined); }} /></label>
          <label>经营实体<Select value={noFieldOrganizationId} onChange={(value) => { setNoFieldOrg(value); setProjectFilter("all"); setBatchOpen(false); setBatchResult(undefined); }} placeholder="请选择经营实体" options={availableOrganizations.map((org) => ({ value: org.id, label: org.name }))} /></label>
        </div>
        <Space wrap><Button onClick={chooseNoProject}>本月无野外项目</Button><Button type="primary" onClick={() => setBatchOpen(true)} disabled={!noFieldOrganizationId}>核对整批提交</Button></Space>
      </section>
      {summary.data?.period?.deadlineAt && <Alert className="monthly-deadline-alert" showIcon type="info" message={`本月报送截止：${summary.data.period.deadlineAt.slice(0, 10)}`} description={`${noFieldOrganizationId && preflight.data ? `还需处理 ${Math.max(0, preflight.data.expectedCount - preflight.data.completedCount)} 个项目。` : "选择经营实体后显示待处理数量。"} 已提交的月报需按授权流程修订，不会直接覆盖历史。`} />}
      {ownDepartment?.returnReason && <Alert className="monthly-deadline-alert" type="warning" showIcon message="公司已退回，请修改后重新整批提交" description={ownDepartment.returnReason} />}
      <Card className="monthly-list-card" title="本月项目清单" extra={<Typography.Text type="secondary">上月现场数据仅供本月核对</Typography.Text>}>
        {!noFieldOrganizationId && <Alert style={{ marginBottom: 16 }} type="info" message="请选择经营实体" description="选择后将从服务端核对该实体本月应报项目。" />}
        {noFieldOrganizationId && preflight.isLoading && <Typography.Text type="secondary">正在核对项目清单…</Typography.Text>}
        {preflight.isError && <Alert style={{ marginBottom: 16 }} type="error" showIcon message="项目清单核对失败" description={<Button onClick={() => void preflight.refetch()}>重试</Button>} />}
        {(projects.isError || workbenchReports.isError) && <Alert style={{ marginBottom: 16 }} type="error" showIcon message="草稿资料加载失败，暂不能编辑" description={<Button onClick={() => { void projects.refetch(); void workbenchReports.refetch(); }}>重新加载</Button>} />}
        {preflight.data?.expectedCount === 0 && <Alert type="info" style={{ marginBottom: 16 }} message="当前经营实体本月没有在建或暂停项目" description="请核实范围后，通过“本月无野外项目”确认；正式结果以服务端核对为准。" />}
        <Space wrap className="monthly-status-tabs">
          {([
            ["all", `全部 ${projectItems.length}`],
            ["todo", `待更新 ${projectItems.filter((row) => !row.report && !voidedByProject.has(row.id)).length}`],
            ["draft", `草稿 ${projectItems.filter((row) => ["draft", "withdrawn"].includes(row.report?.status ?? "")).length}`],
            ["submitted", `已提交 ${projectItems.filter((row) => row.report?.status === "submitted").length}`],
            ["voided", `已作废 ${projectItems.filter((row) => !row.report && voidedByProject.has(row.id)).length}`],
          ] as const).map(([key, label]) => <Button key={key} size="small" type={projectFilter === key ? "primary" : "text"} onClick={() => setProjectFilter(key)}>{label}</Button>)}
        </Space>
        <Table className="monthly-project-table" rowKey="id" loading={preflight.isLoading || projects.isLoading || workbenchReports.isLoading || voidedReports.isLoading} dataSource={visibleProjectItems} pagination={{ pageSize: 10, showSizeChanger: true }} scroll={{ x: 900 }}
          columns={[
            { title: "项目 / 月份", render: (_: unknown, row: NonNullable<typeof preflight.data>["items"][number]) => <><strong>{row.name}</strong><br /><Typography.Text type="secondary">{month} · {selectedOrganizationName}</Typography.Text></> },
            { title: "报送状态", render: (_: unknown, row: NonNullable<typeof preflight.data>["items"][number]) => <Tag color={!row.report ? voidedByProject.has(row.id) ? "red" : "orange" : row.report.status === "submitted" ? "blue" : row.report.status === "withdrawn" ? "gold" : "green"}>{!row.report ? voidedByProject.has(row.id) ? "已作废" : "待填报" : row.report.status === "submitted" ? "已提交" : row.report.status === "withdrawn" ? "已撤回" : "草稿"}</Tag> },
            { title: "时效", render: () => summary.data?.period?.deadlineAt ? summary.data.period.deadlineAt.slice(0, 10) : "未设置截止时间" },
            { title: "最近记录", render: (_: unknown, row: NonNullable<typeof preflight.data>["items"][number]) => row.report ? `已保存 · ${row.report.updatedAt.slice(0, 16).replace("T", " ")}` : voidedByProject.get(row.id)?.voidedAt?.slice(0, 16).replace("T", " ") ?? "尚未填写" },
            { title: "操作", render: (_: unknown, row: NonNullable<typeof preflight.data>["items"][number]) => {
              const project = projects.data?.find((item) => item.id === row.id);
              const report = reportByProject.get(row.id);
              const writable = ["open", "review"].includes(preflight.data?.periodStatus ?? "") && !["submitted", "confirmed", "locked"].includes(ownDepartment?.status ?? "");
              const canEdit = writable && !!project && (!row.report || !!report) && (row.report?.status === undefined || ["draft", "withdrawn"].includes(row.report.status));
              return <Space><Button type="link" disabled={row.report?.status === "submitted" ? !report : !canEdit} onClick={() => row.report?.status === "submitted" ? setDetail(report) : openForm(report, project)}>{!row.report ? voidedByProject.has(row.id) ? "重新填报" : "填写月报" : row.report.status === "withdrawn" ? "查看并重新提交" : row.report.status === "submitted" ? "查看月报" : "编辑草稿"}</Button>{report && row.report?.status !== "submitted" && <Button type="link" onClick={() => setDetail(report)}>详情</Button>}{!report && voidedByProject.has(row.id) && <Button type="link" onClick={() => setDetail(voidedByProject.get(row.id))}>作废记录</Button>}</Space>;
            } },
          ]} />
        <div className="monthly-list-footer"><Typography.Text type="secondary">提交后即完成本月报送，公司发现问题时可退回修改。</Typography.Text><Button type="primary" disabled={!noFieldOrganizationId} onClick={() => setBatchOpen(true)}>整批提交前核对</Button></div>
        {!!preflight.data?.reasons.length && <Alert style={{ marginTop: 16 }} type="warning" showIcon message="暂不能整批提交" description={preflight.data.reasons.join("；")} />}
      </Card>
      <Card title="历史报送记录" className="monthly-history-card">
        <Space wrap style={{ marginBottom: 12 }}><Checkbox checked={allMonths} onChange={(event) => setAllMonths(event.target.checked)}>查看本年度其他月份</Checkbox><Input.Search placeholder="项目名称、类型或地点" allowClear onSearch={setKeyword} style={{ width: 260 }} /></Space>
        {reports.isError && <Alert style={{ marginBottom: 12 }} type="error" showIcon message="历史报送记录加载失败" description={<Button onClick={() => void reports.refetch()}>重新加载</Button>} />}
        <Table rowKey="id" loading={reports.isLoading} dataSource={(reports.data ?? []).filter((row) => row.reportingOrganizationId === noFieldOrganizationId)} pagination={{ pageSize: 10 }} scroll={{ x: 1200 }} columns={reportColumns} />
      </Card>
    </>
  );
  const completedView = (
    <>
      <div className="monthly-manage-filter monthly-completed-filter"><label>统计月份<Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><label>报送主体<Select allowClear placeholder="全部主体" value={completedOrg} onChange={setCompletedOrg} options={(config.data?.organizations ?? []).map((row) => ({ value: row.id, label: row.name }))} /></label><label>项目类型<Select allowClear placeholder="全部类型" value={completedType} onChange={setCompletedType} options={(config.data?.types ?? []).map((row) => ({ value: row.id, label: row.name }))} /></label><Button href={`/api/monthly-reports.csv?year=${year}&month=${Number(number)}&completed=true${completedOrg ? `&organizationId=${completedOrg}` : ""}${completedType ? `&projectTypeId=${completedType}` : ""}`}>导出 CSV</Button></div>
      {completed.isError && <Alert type="error" message="完工项目加载失败" description={<Button onClick={() => void completed.refetch()}>重试</Button>} />}
      <Card className="monthly-manage-table"><Table rowKey="id" loading={completed.isLoading} dataSource={completedRows} pagination={{ pageSize: 10 }} scroll={{ x: 900 }} columns={[
        { title: "项目名称", render: (_: unknown, row: MonthlyReport) => <><strong>{row.project.name}</strong><br /><Typography.Text type="secondary">项目编号：{row.project.code}</Typography.Text></> },
        { title: "报送主体", render: (_: unknown, row: MonthlyReport) => row.reportingOrganization.name },
        { title: "项目类型", render: (_: unknown, row: MonthlyReport) => row.projectType?.name ?? "—" },
        { title: "完工月份 / 关联月报", render: (_: unknown, row: MonthlyReport) => `${row.reportMonth.slice(0, 7)} · 月报 v${row.revision}` },
        { title: "操作", render: (_: unknown, row: MonthlyReport) => <Button type="link" onClick={() => setDetail(row)}>查看相关月报</Button> },
      ]} /></Card>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>当前筛选下 {completedRows.length} 个完工项目。项目状态与月报内容以服务端业务记录为准。</Typography.Paragraph>
    </>
  );
  const configuration = (
    <Tabs className="monthly-config-tabs" items={[
      { key: "deadline", label: "报送时限", children: <Card title="报送时限">
        <Space wrap>
          <Typography.Text>每月报送截止日</Typography.Text>
          <InputNumber
            min={1}
            max={28}
            value={config.data?.settings.deadlineDay ?? 5}
            onChange={async (value) => {
              if (!value) return;
              await api(
                "/api/report-config/settings",
                json("PATCH", { deadlineDay: value }),
              );
              message.success("报送截止日已保存");
              void config.refetch();
            }}
          />
          <Typography.Text type="secondary">
            临近截止提醒一次，逾期按周汇总提醒。
          </Typography.Text>
        </Space>
      </Card> },
      { key: "organizations", label: "报送主体", children: <Card title="报送主体">
        <Typography.Paragraph type="secondary">仅启用的经营实体纳入月报范围；变更由服务端校验权限。</Typography.Paragraph>
        <Table size="small" rowKey="id" pagination={{ pageSize: 10 }} dataSource={config.data?.organizations ?? []} columns={[
          { title: "经营实体", dataIndex: "name" },
          { title: "报送状态", render: (_: unknown, row: ReportConfig["organizations"][number]) => <Tag color={row.reportingEnabled ? "green" : "default"}>{row.reportingEnabled ? "已纳入" : "未纳入"}</Tag> },
          { title: "操作", render: (_: unknown, row: ReportConfig["organizations"][number]) => <Button type="link" onClick={async () => { try { await api(`/api/report-config/organizations/${row.id}`, json("PATCH", { reportingEnabled: !row.reportingEnabled })); message.success("报送主体设置已保存"); void config.refetch(); } catch (error) { message.error((error as Error).message); } }}>{row.reportingEnabled ? "停用报送" : "启用报送"}</Button> },
        ]} />
      </Card> },
      { key: "types", label: "项目类型", children: <Card title="项目类型">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={config.data?.types ?? []}
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "排序", dataIndex: "sortOrder" },
            {
              title: "状态",
              dataIndex: "active",
              render: (v: boolean) => (v ? "启用" : "停用"),
            },
            {
              title: "操作",
              render: (_: unknown, row: ReportConfig["types"][number]) => (
                <Space><Button type="link" onClick={() => { setEditingType(row); typeEditForm.setFieldsValue({ name: row.name, sortOrder: row.sortOrder }); }}>编辑</Button><Button
                  size="small"
                  onClick={async () => {
                    await api(
                      `/api/report-config/types/${row.id}`,
                      json("PATCH", { active: !row.active }),
                    );
                    void config.refetch();
                  }}
                >
                  {row.active ? "停用" : "启用"}
                </Button></Space>
              ),
            },
          ]}
        />
        <Form
          form={typeForm}
          layout="inline"
          style={{ marginTop: 12 }}
          onFinish={async (values) => {
            await api("/api/report-config/types", json("POST", values));
            typeForm.resetFields();
            void config.refetch();
          }}
        >
          <Form.Item name="name" rules={[{ required: true }]}>
            <Input placeholder="项目类型名称" />
          </Form.Item>
          <Form.Item name="sortOrder" initialValue={0}>
            <InputNumber min={0} placeholder="排序" />
          </Form.Item>
          <Button htmlType="submit">新增</Button>
        </Form>
      </Card> },
      { key: "fields", label: "字段与选项", children: <Card title="字段与选项">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={config.data?.fields ?? []}
          columns={[
            { title: "字段", dataIndex: "label" },
            { title: "类型", dataIndex: "fieldType" },
            {
              title: "内置",
              dataIndex: "builtin",
              render: (v: boolean) => (v ? "是" : "否"),
            },
            {
              title: "必填",
              render: (_: unknown, row: ReportConfig["fields"][number]) => (
                <Checkbox
                  checked={row.required}
                  onChange={async (event) => {
                    await api(
                      `/api/report-config/fields/${row.id}`,
                      json("PATCH", { required: event.target.checked }),
                    );
                    void config.refetch();
                  }}
                />
              ),
            },
            {
              title: "启用",
              render: (_: unknown, row: ReportConfig["fields"][number]) => (
                <Checkbox
                  checked={row.active}
                  onChange={async (event) => {
                    await api(
                      `/api/report-config/fields/${row.id}`,
                      json("PATCH", { active: event.target.checked }),
                    );
                    void config.refetch();
                  }}
                />
              ),
            },
            { title: "操作", render: (_: unknown, row: ReportConfig["fields"][number]) => <Button type="link" onClick={() => { setEditingField(row); fieldEditForm.setFieldsValue({ label: row.label, fieldType: row.fieldType, options: row.options.join("，"), required: row.required, active: row.active, sortOrder: row.sortOrder }); }}>编辑</Button> },
          ]}
        />
        <Form
          form={fieldForm}
          layout="inline"
          style={{ marginTop: 12 }}
          onFinish={async (values) => {
            await api(
              "/api/report-config/fields",
              json("POST", {
                ...values,
                options: String(values.options ?? "")
                  .split(/[，,]/)
                  .map((item) => item.trim())
                  .filter(Boolean),
                required: false,
                active: true,
              }),
            );
            fieldForm.resetFields();
            void config.refetch();
          }}
        >
          <Form.Item name="label" rules={[{ required: true }]}>
            <Input placeholder="自定义字段名称" />
          </Form.Item>
          <Form.Item name="fieldType" rules={[{ required: true }]}>
            <Select
              style={{ width: 130 }}
              options={["text", "number", "textarea", "select", "date"].map(
                (value) => ({
                  value,
                  label: (
                    {
                      text: "文本",
                      number: "数字",
                      textarea: "多行文本",
                      select: "下拉选择",
                      date: "日期",
                    } as Record<string, string>
                  )[value],
                }),
              )}
            />
          </Form.Item>
          <Form.Item name="options">
            <Input placeholder="下拉选项，逗号分隔" />
          </Form.Item>
          <Form.Item name="sortOrder" initialValue={200}>
            <InputNumber min={0} />
          </Form.Item>
          <Button htmlType="submit">新增字段</Button>
        </Form>
      </Card> },
    ]} />
  );
  const reviewDepartment = summary.data?.departments.find((row) => row.id === reviewOrganizationId);
  const reviewReports = (summary.data?.reports ?? []).filter((row) => row.reportingOrganizationId === reviewOrganizationId);
  const comparedReport = history.find((row) => row.id === historyReportId) ?? history.at(-1);
  const previousSnapshot = comparedReport?.revisions?.[0]?.beforeSnapshot;
  const readSnapshotField = (source: Record<string, unknown> | undefined, key: string) => {
    if (!source) return undefined;
    const names: Record<string, string> = { project_type_id: "projectTypeId", construction_location: "constructionLocation", contract_amount: "contractAmount", duration_months: "durationMonths", department_entity: "departmentEntity", project_manager: "projectManager", contact_info: "contactInfo", overall_progress: "overallProgress", monthly_construction_status: "monthlyConstructionStatus", equipment_models: "equipmentModels", onsite_count: "onsiteCount", onsite_vehicles: "onsiteVehicles", safety_inspection: "safetyInspection", safety_hazards: "safetyHazards", safety_hazard_detail: "safetyHazardDetail" };
    if (key === "project_name") return (source.projectSnapshot as { name?: string } | undefined)?.name ?? (source.project as { name?: string } | undefined)?.name;
    return source[names[key] ?? key] ?? (source.customData as Record<string, unknown> | undefined)?.[key];
  };
  const historicalFields = (comparedReport?.fieldSnapshot ?? []).map((field) => {
    const before = readSnapshotField(previousSnapshot, field.key);
    const after = readSnapshotField(comparedReport as unknown as Record<string, unknown>, field.key);
    return { key: field.key, label: field.label, before, after, changed: JSON.stringify(before ?? null) !== JSON.stringify(after ?? null) };
  });
  const confirmNoProjectDialog = async () => {
    if (noProjectDialog === "confirm") {
      if (await submitBatch()) setNoProjectDialog(null);
      return;
    }
    if (noProjectDialog !== "select") { setNoProjectDialog(null); return; }
    if (!noFieldOrganizationId) { message.warning("请选择报送主体"); return; }
    try {
      const latest = await api<typeof preflight.data>(`/api/monthly-reports/submissions/preflight?organizationId=${noFieldOrganizationId}&month=${month}`);
      qc.setQueryData(["monthly-report-preflight", month, noFieldOrganizationId], latest);
      setNoProjectDialog(latest?.ready && latest.expectedCount === 0 ? "confirm" : "blocked");
    } catch (error) { message.error((error as Error).message); setNoProjectDialog("blocked"); }
  };
  const allowedView = view === "config" ? !!capabilities.data?.canConfigure : view === "manage" ? !!capabilities.data?.canReview : view === "mine" ? !!capabilities.data?.canSubmit : view === "completed";
  const pageTitles: Record<string, string> = { mine: "经营实体月报", manage: "公司月报查看", completed: "完工项目台账", config: "月报配置" };
  return (
    <div className="admin-workspace monthly-report-page">
      <div className="monthly-page-heading">
        <div><Typography.Text type="secondary">野外项目月报 / {pageTitles[view] ?? "月报"}</Typography.Text><Typography.Title level={3}>{history.length ? "月报历史对比" : detail ? "项目月报详情" : batchResult ? "整批报送已完成" : open ? editing ? "修订项目草稿" : voidedByProject.has(selectedDraftProjectId ?? "") ? "作废后重新填报" : "更新项目草稿" : batchOpen ? "经营实体整批提交核对" : reviewOrganizationId ? "公司查看经营实体批次" : pageTitles[view] ?? "野外项目月报"}</Typography.Title><Typography.Text type="secondary">{batchOpen ? "逐项核对项目草稿；草稿未齐时由服务端阻止提交" : open ? "核实上月带入数据，只保存本月实际变化" : reviewOrganizationId ? "公司直接查看报送，发现问题时退回" : view === "mine" ? "更新项目草稿，核对后由经营实体整批提交" : view === "manage" ? "查看各经营实体报送情况，发现问题时退回修改" : view === "config" ? "管理月份规则、报送范围、项目类型与字段" : "查看已完工项目的历史报送"}</Typography.Text></div>
        {view !== "mine" && capabilities.data?.canSubmit && <Button onClick={() => setView("mine")}>返回经营实体月报</Button>}
      </div>
      {!open && !batchOpen && !reviewOrganizationId && !batchResult && !detail && !history.length && (capabilities.isLoading ? <Card loading /> : capabilities.isError ? <Alert type="error" message="权限信息加载失败" description={<Button onClick={() => void capabilities.refetch()}>重试</Button>} /> : !allowedView ? <Alert type="warning" showIcon message="无权访问此月报页面" /> : view === "mine" ? own : view === "manage" ? manage : view === "completed" ? completedView : configuration)}
      {batchResult && <Card className="monthly-result-card"><Typography.Title level={4}>报送成功</Typography.Title><Typography.Paragraph>经营实体：{selectedOrganizationName} · 月份：{month}</Typography.Paragraph><Descriptions column={1} items={[{ key: "batch", label: "服务端批次编号", children: batchResult.id }, { key: "status", label: "当前状态", children: batchResult.status === "submitted" ? "已提交，公司可直接查看" : batchResult.status }, { key: "type", label: "报送类型", children: batchResult.reportType === "no_projects" ? "无项目报送" : "项目整批报送" }]} /><Button type="primary" onClick={() => setBatchResult(undefined)}>返回月报工作台</Button></Card>}
      <Modal title={noProjectDialog === "select" ? "选择经营实体" : noProjectDialog === "blocked" ? "暂不能进行无项目报送" : "确认本月无野外项目"} open={!!noProjectDialog} onCancel={() => setNoProjectDialog(null)} onOk={confirmNoProjectDialog} okText={noProjectDialog === "confirm" ? "确认并提交" : noProjectDialog === "select" ? "继续核对" : "知道了"} confirmLoading={submittingBatch}>
        {noProjectDialog === "select" ? <><p>先选择本次报送的经营实体，系统将核对该月项目范围。</p><Select style={{ width: "100%" }} placeholder="请选择经营实体" value={noFieldOrganizationId} onChange={setNoFieldOrg} options={availableOrganizations.map((org) => ({ value: org.id, label: org.name }))} /></> : noProjectDialog === "blocked" ? <Alert type="warning" showIcon message="服务端核对未通过" description={preflight.isError ? "核对请求失败，请重试。" : preflight.data?.expectedCount ? `该实体本月有 ${preflight.data.expectedCount} 个应报项目，不能按无项目报送。` : preflight.data?.reasons.join("；") || "请先核对月份和报送范围。"} /> : <p>服务端确认 {selectedOrganizationName} 在 {month} 没有应报项目。提交后将生成该月的无项目报送记录，请核实后确认。</p>}
      </Modal>
      <Drawer title="编辑自定义字段" open={!!editingField} onClose={() => setEditingField(undefined)} width={520} destroyOnClose>
        {editingField && <Form form={fieldEditForm} layout="vertical" onFinish={async (values) => {
          setSavingField(true);
          try {
            await api(`/api/report-config/fields/${editingField.id}`, json("PATCH", { ...values, options: String(values.options ?? "").split(/[，,]/).map((item) => item.trim()).filter(Boolean) }));
            message.success("字段设置已保存");
            setEditingField(undefined);
            void config.refetch();
          } catch (error) { message.error((error as Error).message); }
          finally { setSavingField(false); }
        }}>
          <Alert style={{ marginBottom: 20 }} type="info" showIcon message={editingField.builtin ? "内置字段类型不能修改，历史月报仍使用原字段快照。" : "编辑仅影响后续填写；历史月报保留原字段快照。"} />
          <Form.Item name="label" label="字段名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="fieldType" label="字段类型"><Select disabled={editingField.builtin} options={["text", "number", "textarea", "select", "date"].map((value) => ({ value, label: { text: "文本", number: "数字", textarea: "多行文本", select: "下拉选择", date: "日期" }[value as ReportConfig["fields"][number]["fieldType"]] }))} /></Form.Item>
          <Form.Item name="options" label="下拉选项（逗号分隔）"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="sortOrder" label="排序"><InputNumber min={0} /></Form.Item>
          <Form.Item name="required" valuePropName="checked"><Checkbox>必填</Checkbox></Form.Item>
          <Form.Item name="active" valuePropName="checked"><Checkbox>启用</Checkbox></Form.Item>
          <Space><Button onClick={() => setEditingField(undefined)}>取消</Button><Button type="primary" htmlType="submit" loading={savingField}>保存字段</Button></Space>
        </Form>}
      </Drawer>
      <Modal title="编辑项目类型" open={!!editingType} onCancel={() => setEditingType(undefined)} onOk={() => typeEditForm.submit()}>
        <Form form={typeEditForm} layout="vertical" onFinish={async (values) => {
          if (!editingType) return;
          try { await api(`/api/report-config/types/${editingType.id}`, json("PATCH", values)); message.success("项目类型已保存"); setEditingType(undefined); void config.refetch(); }
          catch (error) { message.error((error as Error).message); }
        }}><Form.Item name="name" label="项目类型" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="sortOrder" label="排序"><InputNumber min={0} /></Form.Item></Form>
      </Modal>
      {batchOpen && <section className="monthly-batch-page">
        <Steps size="small" current={1} style={{ marginBottom: 24 }} items={[{ title: "更新项目草稿" }, { title: "经营实体整批提交" }, { title: "公司查看 / 问题退回" }]} />
        {preflight.isLoading ? <Typography.Text>正在核对服务端数据…</Typography.Text> : preflight.isError ? <Alert type="error" message="核对失败" description={<Button onClick={() => void preflight.refetch()}>重试</Button>} /> : <>
          <Alert type={preflight.data?.ready ? "success" : "warning"} showIcon message={preflight.data?.ready ? "草稿已齐，可以整批提交" : "项目草稿未齐，整批提交已阻断"} description={preflight.data?.reasons.join("；") || `应报 ${preflight.data?.expectedCount ?? 0} 个项目，已保存 ${preflight.data?.completedCount ?? 0} 个草稿。`} />
          <div className="monthly-batch-grid">
            <Card title="本次项目草稿"><Table size="small" rowKey="id" pagination={false} dataSource={preflight.data?.items ?? []}
              columns={[{ title: "项目", render: (_: unknown, row: NonNullable<typeof preflight.data>["items"][number]) => <><strong>{row.name}</strong><br /><Typography.Text type="secondary">{row.code}</Typography.Text></> }, { title: "草稿状态", render: (_: unknown, row: NonNullable<typeof preflight.data>["items"][number]) => row.report ? <Tag color="green">v{row.report.revision} 已保存</Tag> : <Tag color="orange">未填写</Tag> }, { title: "操作", render: (_: unknown, row: NonNullable<typeof preflight.data>["items"][number]) => !row.report && <Button type="link" onClick={() => { const project = projects.data?.find((item) => item.id === row.id); if (project) { setBatchOpen(false); openForm(undefined, project); } }}>去填写</Button> }]} /></Card>
            <Card title="整批核对摘要"><Descriptions size="small" column={1} items={[{ key: "month", label: "报送月份", children: month }, { key: "org", label: "经营实体", children: selectedOrganizationName }, { key: "expected", label: "应报项目", children: preflight.data?.expectedCount ?? 0 }, { key: "completed", label: "已保存草稿", children: preflight.data?.completedCount ?? 0 }, { key: "pending", label: "待完成", children: Math.max(0, (preflight.data?.expectedCount ?? 0) - (preflight.data?.completedCount ?? 0)) }]} />{preflight.data?.reportType === "no_projects" && <Alert type="info" message="该月由服务端确认为无项目" />}</Card>
          </div>
        </>}
        <div className="monthly-page-actions"><Button onClick={() => setBatchOpen(false)}>返回项目清单</Button><Button type="primary" loading={submittingBatch} disabled={!preflight.data?.ready} onClick={() => Modal.confirm({ title: `${ownDepartment?.status === "rejected" ? "确认整批重提" : "确认整批提交"} ${selectedOrganizationName} ${month} 月报？`, content: `本次将整批提交 ${preflight.data?.expectedCount ?? 0} 个项目。提交后公司可查看；如有问题会退回，提交后不能自行修改。`, onOk: async () => { if (!await submitBatch()) throw new Error("服务端核对未通过"); } })}>{ownDepartment?.status === "rejected" ? "整批重提" : "确认整批提交"}</Button></div>
      </section>}
      {reviewOrganizationId && !detail && !history.length && <section className="monthly-review-page">
        <div className="monthly-review-header"><Typography.Title level={4}>{month} · {reviewDepartment?.name ?? "经营实体"}</Typography.Title><Button onClick={() => setReviewOrganizationId(undefined)}>返回公司月报</Button></div>
        {capabilities.data?.canReview && reviewDepartment?.status === "submitted" && reviewDepartment.submissionId && <div className="monthly-page-actions"><Button danger onClick={() => {
            let reason = "";
            Modal.confirm({ title: `退回 ${reviewDepartment.name} 的整批月报？`, content: <Input.TextArea rows={3} placeholder="填写退回原因（至少两个字）" onChange={(event) => { reason = event.target.value; }} />, onOk: async () => {
              if (reason.trim().length < 2) { message.error("请填写至少两个字的退回原因"); throw new Error("退回原因不足"); }
              try { await api(`/api/monthly-reports/submissions/${reviewDepartment.submissionId}/review`, json("POST", { action: "reject", reason: reason.trim() })); message.success("整批月报已退回"); setReviewOrganizationId(undefined); refresh(); } catch (error) { message.error((error as Error).message); throw error; }
            } });
          }}>退回修改</Button>
        </div>}
        {reviewDepartment && <>
          {reviewDepartment.status === "submitted" && <Alert style={{ marginBottom: 16 }} type="info" showIcon message="已完成报送，无需逐批确认" description="公司可直接查看；发现问题时填写原因并退回。" />}
          <Descriptions bordered size="small" column={2} items={[
            { key: "org", label: "经营实体", children: reviewDepartment.name },
            { key: "status", label: "状态", children: { draft: "草稿中", submitted: "已提交", rejected: "已退回", confirmed: "已确认（历史）", locked: "已锁定", missing: "未报送" }[reviewDepartment.status] },
            { key: "type", label: "报送类型", children: reviewDepartment.reportType === "no_projects" ? "无在建项目" : "项目月报" },
            { key: "count", label: "项目数", children: reviewDepartment.reportCount },
            ...(reviewDepartment.returnReason ? [{ key: "reason", label: "退回原因", children: reviewDepartment.returnReason, span: 2 as const }] : []),
          ]} />
          <Table style={{ marginTop: 20 }} size="small" rowKey="id" dataSource={reviewReports} pagination={{ pageSize: 10 }} columns={[
            { title: "项目", render: (_: unknown, row: MonthlyReport) => <Button type="link" onClick={() => setDetail(row)}>{row.project.name}</Button> },
            { title: "现场人数", dataIndex: "onsiteCount" }, { title: "车辆", dataIndex: "onsiteVehicles" },
            { title: "隐患", render: (_: unknown, row: MonthlyReport) => row.safetyHazards ? "有" : "无" },
            { title: "提交时间", dataIndex: "submittedAt", render: (value?: string) => value ? value.slice(0, 16).replace("T", " ") : "—" },
          ]} />
          {reviewDepartment.reportType === "no_projects" && <Alert type="info" message="该经营实体提交了无项目报送" description="仅在服务端核实本月没有在建或暂停项目后允许提交。" />}
        </>}
      </section>}
      {open && <section className="monthly-draft-page">
        <div className="monthly-draft-heading"><Steps size="small" current={0} items={[{ title: "更新项目草稿" }, { title: "经营实体整批提交" }, { title: "公司查看 / 问题退回" }]} /><Button onClick={closeDraftForm}>返回项目清单</Button></div>
        <Form
          form={form}
          layout="vertical"
          onValuesChange={() => setDraftDirty(true)}
          onFinish={(values) => save.mutate(values)}
        >
          <div className="monthly-draft-grid"><div className="monthly-draft-main">
          <Typography.Title level={5}>项目概况</Typography.Title>
          <Typography.Paragraph type="secondary">项目和报送月份由清单确定，不在月报草稿中修改。</Typography.Paragraph>
          {!editing && selectedDraftProject && <Alert style={{ marginBottom: 18 }} type="info" showIcon message="已带入项目主档与上月现场数据" description={selectedDraftProject.previousDefaults ? `上月总体进度：${selectedDraftProject.previousDefaults.overallProgress || "未填"}；现场人数：${selectedDraftProject.previousDefaults.onsiteCount ?? "未填"}；车辆：${selectedDraftProject.previousDefaults.onsiteVehicles ?? "未填"}。请核实并填写本月施工情况。` : "该项目暂无可带入的上月现场数据，请填写本月实际情况。"} />}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="projectId"
                label="项目"
                rules={[{ required: true }]}
              >
                <Select
                  disabled
                  showSearch
                  optionFilterProp="label"
                  onChange={(projectId) => {
                    const selected = (projects.data ?? []).find((row) => row.id === projectId);
                    if (selected) form.setFieldsValue({
                      constructionLocation: selected.location ?? undefined,
                      contractAmount: selected.contractAmount ?? 0,
                      projectManager: selected.managerName ?? undefined,
                      contactInfo: selected.managerPhone ?? undefined,
                      ...(selected.previousDefaults ?? {}),
                    });
                  }}
                  options={(projects.data ?? [])
                    .filter((row) => row.status !== "ended")
                    .map((row) => ({
                      value: row.id,
                      label: `${row.name}（${row.code}）· ${row.responsibleOrganization.name}`,
                    }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="reportMonth"
                label="报送月份"
                rules={[{ required: true }]}
              >
                <Input disabled type="month" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="projectTypeId" label="项目类型">
                <Select
                  allowClear
                  options={(config.data?.types ?? [])
                    .filter((row) => row.active)
                    .map((row) => ({ value: row.id, label: row.name }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="constructionLocation"
                label="施工地点"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="contractAmount" label="合同额（万元）">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="durationMonths" label="工期（月）">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="departmentEntity" label="归属实体">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="projectManager"
                label="项目负责人"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contactInfo" label="联系方式">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Title level={5}>本月更新</Typography.Title>
          <Typography.Paragraph type="secondary">上月数据仅供参考；本月施工情况、安全自检和隐患请按实际填写。</Typography.Paragraph>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="overallProgress" label="项目总体进度">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="monthlyConstructionStatus"
                label="本月施工情况"
                rules={[{ required: true }]}
              >
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="equipmentModels" label="设备型号">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="onsiteCount"
                label="现场人数"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="onsiteVehicles" label="现场车辆数">
                <InputNumber min={0} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="safetyInspection"
                label="已安全自检"
                valuePropName="checked"
              >
                <Checkbox>是</Checkbox>
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="safetyHazards"
                label="存在安全隐患"
                valuePropName="checked"
              >
                <Checkbox>是</Checkbox>
              </Form.Item>
            </Col>
            {Form.useWatch("safetyHazards", form) && (
              <Col span={24}>
                <Form.Item
                  name="safetyHazardDetail"
                  label="安全隐患详情"
                  rules={[{ required: true }]}
                >
                  <Input.TextArea rows={3} />
                </Form.Item>
              </Col>
            )}
            <Col span={8}>
              <Form.Item name="safetyInvestment" label="安全投入（元）">
                <InputNumber min={0} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="incidentCount" label="事故数">
                <InputNumber min={0} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="projectStatus" label="项目状态">
                <Select
                  options={[
                    { value: "active", label: "在建" },
                    { value: "completed", label: "已完工" },
                  ]}
                />
              </Form.Item>
            </Col>
            {customFields.map((field) => (
              <Col
                span={field.fieldType === "textarea" ? 24 : 12}
                key={field.id}
              >
                <Form.Item
                  name={["customData", field.fieldKey]}
                  label={field.label}
                  rules={[{ required: field.required }]}
                >
                  {field.fieldType === "number" ? (
                    <InputNumber min={0} style={{ width: "100%" }} />
                  ) : field.fieldType === "textarea" ? (
                    <Input.TextArea rows={3} />
                  ) : field.fieldType === "select" ? (
                    <Select
                      options={field.options.map((value) => ({
                        value,
                        label: value,
                      }))}
                    />
                  ) : (
                    <Input
                      type={field.fieldType === "date" ? "date" : "text"}
                    />
                  )}
                </Form.Item>
              </Col>
            ))}
            <Col span={24}>
              <Form.Item name="notes" label="备注">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            {!editing && (
              <Col span={24}>
                <Form.Item label="补充材料（可选，最多 20 个附件）">
                  <Upload
                    multiple
                    fileList={reportFiles}
                    beforeUpload={(file) => {
                      setReportFiles((current) => [...current, file]);
                      return false;
                    }}
                    onRemove={(file) => {
                      setReportFiles((current) =>
                        current.filter((item) => item.uid !== file.uid),
                      );
                    }}
                  >
                    <Button>选择月报附件</Button>
                  </Upload>
                </Form.Item>
              </Col>
            )}
          </Row>
          </div><aside className="monthly-draft-reference"><Card title="项目与上月参考">
            <Descriptions size="small" column={1} items={[
              { key: "month", label: "本次月份", children: month },
              { key: "project", label: "项目", children: selectedDraftProject?.name ?? editing?.project.name ?? "—" },
              { key: "organization", label: "经营实体", children: selectedOrganizationName },
              { key: "progress", label: "上月进度", children: selectedDraftProject?.previousDefaults?.overallProgress || "无上月记录" },
              { key: "people", label: "上月现场人数", children: selectedDraftProject?.previousDefaults?.onsiteCount ?? "—" },
              { key: "vehicles", label: "上月车辆", children: selectedDraftProject?.previousDefaults?.onsiteVehicles ?? "—" },
            ]} />
            <Alert style={{ marginTop: 18 }} type="info" showIcon message="上月数据仅供核实" description="本月情况需要按照实际施工、人员和安全自检结果更新。" />
          </Card></aside></div>
          <div className="monthly-page-actions"><Button onClick={closeDraftForm}>取消</Button><Button type="primary" htmlType="submit" loading={save.isPending}>保存项目月报草稿</Button></div>
        </Form>
      </section>}
      {detail && !history.length && <section className="monthly-detail-page"><div className="monthly-review-header"><Typography.Title level={4}>{detail.project.name} · {detail.reportMonth.slice(0, 7)}</Typography.Title><Space><Button onClick={() => void showHistory(detail.projectId, detail.id)}>历史对比</Button><Button onClick={() => setDetail(undefined)}>返回列表</Button></Space></div>
        {(
          <>
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                {
                  key: "project",
                  label: "项目",
                  children: detail.project.name,
                },
                {
                  key: "month",
                  label: "报送月份",
                  children: detail.reportMonth.slice(0, 7),
                },
                {
                  key: "org",
                  label: "报送部门",
                  children: detail.reportingOrganization.name,
                },
                {
                  key: "location",
                  label: "施工地点",
                  children: detail.constructionLocation || "—",
                },
                {
                  key: "manager",
                  label: "负责人",
                  children: [detail.projectManager, detail.contactInfo]
                    .filter(Boolean)
                    .join(" / "),
                },
                {
                  key: "onsite",
                  label: "现场人员/车辆",
                  children: `${detail.onsiteCount} / ${detail.onsiteVehicles}`,
                },
                {
                  key: "progress",
                  label: "总体进度",
                  children: detail.overallProgress || "—",
                  span: 2,
                },
                {
                  key: "monthly",
                  label: "本月施工",
                  children:
                    detail.monthlyConstructionStatus || detail.progressSummary,
                  span: 2,
                },
                {
                  key: "hazard",
                  label: "安全隐患",
                  children: detail.safetyHazards
                    ? detail.safetyHazardDetail || "有"
                    : "无",
                  span: 2,
                },
                ...Object.entries(detail.customData ?? {}).map(
                  ([key, value]) => ({
                    key,
                    label:
                      config.data?.fields.find(
                        (field) => field.fieldKey === key,
                      )?.label ?? key,
                    children: String(value ?? "—"),
                  }),
                ),
              ]}
            />
            <Typography.Title level={5} style={{ marginTop: 20 }}>
              附件
            </Typography.Title>
            <Space wrap>
              {detail.attachments?.length
                ? detail.attachments.map((item) => (
                    <Button
                      key={item.id}
                      href={`/api/files/${item.file.id}`}
                      target="_blank"
                    >
                      {item.file.originalName}
                    </Button>
                  ))
                : "暂无附件"}
            </Space>
          </>
        )}
      </section>}
      {!!history.length && <section className="monthly-history-page"><div className="monthly-review-header"><Typography.Title level={4}>月报历史对比</Typography.Title><Button onClick={() => setHistory([])}>返回详情</Button></div>
        <Space className="monthly-history-select" wrap><label>月报月份<Select style={{ width: 200 }} value={comparedReport?.id} onChange={setHistoryReportId} options={history.map((row) => ({ value: row.id, label: `${row.reportMonth.slice(0, 7)} · ${row.status === "voided" ? "已作废" : `第 ${row.revision} 版`}` }))} /></label><Typography.Text type="secondary">历史内容只读，字段名称与选项使用记录保存时的含义。</Typography.Text></Space>
        {comparedReport?.revisions?.length ? <><Alert type="info" style={{ marginBottom: 16 }} message={`当前第 ${comparedReport.revision} 版 · 与第 ${comparedReport.revisions[0]!.revision} 版对比`} description={`本次有 ${historicalFields.filter((row) => row.changed).length} 项字段发生变化，原版不会被覆盖。`} /><Table rowKey="key" pagination={false} dataSource={historicalFields} scroll={{ x: 900 }} columns={[{ title: "字段 / 变更", render: (_: unknown, row: typeof historicalFields[number]) => <><strong>{row.label}</strong><br /><Typography.Text type="secondary">{row.changed ? "已修改" : "未修改"}</Typography.Text></>, width: 240 }, { title: `第 ${comparedReport.revisions[0]!.revision} 版`, render: (_: unknown, row: typeof historicalFields[number]) => String(row.before ?? "无") }, { title: `当前第 ${comparedReport.revision} 版`, render: (_: unknown, row: typeof historicalFields[number]) => String(row.after ?? "无") }]} /></> : <Alert type="info" message="该月报尚无修订版本" description="可以通过上方月份选择查看该项目其他月份的报送记录。" />}
      </section>}
    </div>
  );
}
